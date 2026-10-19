import 'dart:async';
import 'dart:convert';
import 'dart:math';

/// 체험판(데모) 빌드: --dart-define=DEMO=true. 서버 없이 앱 안의 가짜 서버가 응답하고,
/// 호출하면 가상의 이용자가 배정되어 다가오고 작업을 마치는 과정이 자동으로 흘러간다.
const demoMode = bool.fromEnvironment('DEMO');

typedef Json = Map<String, dynamic>;

class DemoError implements Exception {
  DemoError(this.status, this.message);
  final int status;
  final String message;
}

class DemoBackend {
  DemoBackend(this.emit);

  /// 실시간 이벤트를 앱에 흘려보낸다 (서버 소켓 대신)
  final void Function(String name, Json data) emit;

  static final types = [for (final t in jsonDecode(_typesJson) as List) Json.from(t as Map)];
  final _jobs = <String, Json>{};
  final _timers = <String, List<Timer>>{};
  final _cards = <Json>[];
  final _rand = Random();
  int _seq = 0;

  String _id(String p) => '$p-${DateTime.now().millisecondsSinceEpoch}-${_seq++}';
  String _now() => DateTime.now().toUtc().toIso8601String();

  Future<dynamic> handle(String method, String path, Json? body) async {
    await Future<void>.delayed(const Duration(milliseconds: 250));
    final uri = Uri.parse(path);
    final b = body ?? const <String, dynamic>{};
    switch ((method, uri.pathSegments)) {
      case ('POST', ['auth', 'otp', 'request']):
        return {'sent': true, 'ttlSec': 180};
      case ('POST', ['auth', 'otp', 'verify']):
        return {'token': 'demo'};
      case (_, ['me', 'push-tokens']):
        return null;
      case ('GET', ['equipment-types']):
        return types;
      case ('POST', ['jobs', 'estimate']):
        return estimate(b);
      case ('POST', ['jobs']):
        return _create(b);
      case ('GET', ['jobs']):
        return _jobs.values.toList()..sort((x, y) => (y['createdAt'] as String).compareTo(x['createdAt'] as String));
      case ('GET', ['jobs', final id]):
        return _job(id);
      case ('POST', ['jobs', final id, 'cancel']):
        return _cancel(id);
      case ('POST', ['jobs', final id, 'adjustments', final adjId, final decision]):
        final a = (_job(id)['adjustments'] as List).firstWhere((a) => a['id'] == adjId) as Json;
        a['status'] = decision == 'approve' ? 'APPROVED' : 'REJECTED';
        a['decidedAt'] = _now();
        _update(id, {});
        return a;
      case ('POST', ['jobs', final id, 'rating']):
        _job(id)['rated'] = b['score'];
        return {'ok': true};
      case ('GET', ['payments', 'methods']):
        return {'pgEnabled': false, 'cardRequired': false, 'methods': _cards};
      case ('POST', ['payments', 'billing', 'session']):
        // 체험판은 결제창 없이 바로 시연용 카드를 붙인다
        _cards
          ..clear()
          ..add({'id': _id('card'), 'cardCompany': '체험카드', 'cardNumber': '1234-****-****-5678'});
        emit('payment.method.updated', {});
        return {'url': ''};
      case ('DELETE', ['payments', 'methods', final id]):
        _cards.removeWhere((c) => c['id'] == id);
        return null;
      case ('POST', ['payments', 'jobs', _, 'retry']):
        return {'ok': true};
      case ('GET', ['geo', 'search']):
        return {'enabled': true, 'places': _searchPlaces(uri.queryParameters)};
      case ('GET', ['geo', 'reverse']):
        return {'address': null};
    }
    throw DemoError(404, '체험판에서는 쓸 수 없는 기능이에요');
  }

  Json _job(String id) => _jobs[id] ?? (throw DemoError(404, '호출을 찾을 수 없어요'));

  Json _create(Json b) {
    final type = types.firstWhere((t) => t['code'] == b['typeCode']);
    final id = _id('job');
    final job = <String, dynamic>{
      'id': id,
      'typeCode': b['typeCode'],
      'options': b['options'] ?? {},
      'requiredSpec': b['requiredSpec'] ?? {},
      'lat': b['lat'],
      'lng': b['lng'],
      'address': b['address'] ?? '선택한 위치',
      'destLat': b['destLat'],
      'destLng': b['destLng'],
      'destAddress': b['destAddress'],
      'memo': b['memo'],
      'scheduledAt': b['scheduledAt'],
      'status': 'REQUESTED',
      'estimate': estimate(b),
      'finalFare': null,
      'cancelFee': 0,
      'unassignedAlert': false,
      'createdAt': _now(),
      'adjustments': <Json>[],
      'provider': null,
      'equipment': null,
      'providerLocation': null,
      'payment': null,
      if ((b['options'] as Map?)?['highway'] == true) 'safetyNotice': '차 밖으로 나와 가드레일 바깥으로 대피하세요. 2차 사고가 가장 위험합니다.',
    };
    _jobs[id] = job;
    _run(id, type);
    return job;
  }

  /// 배정 → 출발 → 다가옴 → 도착 → 작업 → 완료를 자동으로 진행한다
  void _run(String id, Json type) {
    final job = _jobs[id]!;
    final lat = (job['lat'] as num).toDouble(), lng = (job['lng'] as num).toDouble();
    final angle = _rand.nextDouble() * 2 * pi;
    final startLat = lat + 0.012 * sin(angle), startLng = lng + 0.015 * cos(angle);
    final timers = _timers[id] = [];
    void at(int sec, void Function() f) => timers.add(Timer(Duration(seconds: sec), f));
    int ts() => DateTime.now().millisecondsSinceEpoch;

    at(4, () => _update(id, {
          'status': 'MATCHED',
          'provider': {'id': 'demo-provider', 'companyName': _companyFor(type['code'] as String), 'rating': 4.8},
          'equipment': {'typeCode': type['code'], 'plateNo': '서울85바${1000 + _rand.nextInt(8999)}', 'spec': job['requiredSpec'] ?? {}},
          'providerLocation': {'lat': startLat, 'lng': startLng, 'heading': null, 'ts': ts()},
        }));
    if (job['scheduledAt'] != null) return; // 예약은 배정까지만
    at(7, () => _update(id, {'status': 'EN_ROUTE'}));
    const steps = 12;
    for (var i = 1; i <= steps; i++) {
      at(7 + i * 2, () {
        final f = i / steps;
        final p = {'lat': startLat + (lat - startLat) * f, 'lng': startLng + (lng - startLng) * f};
        _jobs[id]!['providerLocation'] = {...p, 'heading': null, 'ts': ts()};
        emit('provider.location', {'jobId': id, ...p, 'ts': ts()});
      });
    }
    const arrive = 7 + steps * 2 + 1;
    at(arrive, () => _update(id, {'status': 'ARRIVED', 'arrivedAt': _now()}));
    at(arrive + 4, () => _update(id, {'status': 'IN_PROGRESS'}));
    at(arrive + 12, () => _complete(id));
  }

  void _complete(String id) {
    final job = _jobs[id]!;
    if (job['status'] != 'IN_PROGRESS') return;
    final extra = [
      for (final a in job['adjustments'] as List)
        if (a['status'] == 'APPROVED') a['amount'] as int,
    ].fold(0, (s, v) => s + v);
    final fare = (job['estimate']['amount'] as int) + extra;
    _update(id, {
      'status': 'COMPLETED',
      'finalFare': fare,
      'completedAt': _now(),
      'providerLocation': null,
      'payment': {'status': 'CAPTURED', 'amount': fare, 'kind': 'FARE', 'method': 'MOCK', 'failReason': null},
    });
  }

  Json _cancel(String id) {
    final job = _job(id);
    for (final t in _timers.remove(id) ?? const <Timer>[]) {
      t.cancel();
    }
    final type = types.firstWhere((t) => t['code'] == job['typeCode']);
    final fee = job['status'] == 'REQUESTED' ? 0 : (type['rates']['cancelFee'] as int? ?? 0);
    return _update(id, {'status': 'CANCELLED', 'cancelFee': fee, 'providerLocation': null});
  }

  Json _update(String id, Json patch) {
    final job = _jobs[id]!..addAll(patch);
    emit('job.updated', job);
    return job;
  }

  String _companyFor(String code) => switch (code) {
        'TOW' => '한빛 렉카',
        'FORKLIFT' => '대성 지게차',
        'DUMP' => '우진 덤프',
        'EXCAVATOR' => '태양 중기',
        'CRANE' => '동방 크레인',
        'LADDER' => '하늘 사다리차',
        'SKY' => '스카이 중장비',
        _ => '믿음 장비렌탈',
      };

  static const _places = [
    ('강남역', '서울 강남구 역삼동 858', '서울 강남구 강남대로 396', 37.4979, 127.0276),
    ('서울역', '서울 용산구 동자동 43-205', '서울 용산구 한강대로 405', 37.5547, 126.9707),
    ('잠실종합운동장', '서울 송파구 잠실동 10', '서울 송파구 올림픽로 25', 37.5152, 127.0731),
    ('여의도공원', '서울 영등포구 여의도동 2', '서울 영등포구 여의공원로 68', 37.5256, 126.9227),
    ('판교역', '경기 성남시 분당구 백현동 534', '경기 성남시 분당구 판교역로 160', 37.3948, 127.1112),
    ('수원역', '경기 수원시 팔달구 매산로1가 18', '경기 수원시 팔달구 덕영대로 924', 37.2664, 127.0001),
    ('현대자동차 강남 서비스센터', '서울 강남구 대치동 1003', '서울 강남구 영동대로 320', 37.5011, 127.0632),
    ('기아 오토큐 성수점', '서울 성동구 성수동2가 280', '서울 성동구 아차산로 113', 37.5444, 127.0560),
  ];

  List<Json> _searchPlaces(Map<String, String> qs) {
    final q = (qs['q'] ?? '').trim();
    final hits = [
      for (final p in _places)
        if (q.isEmpty || p.$1.contains(q) || p.$2.contains(q) || p.$3.contains(q) || q.contains(p.$1))
          {'name': p.$1, 'address': p.$2, 'roadAddress': p.$3, 'lat': p.$4, 'lng': p.$5},
    ];
    if (hits.isNotEmpty || q.isEmpty) return hits;
    // 목록에 없는 검색어는 근처 아무 곳으로 보여 준다
    final lat = double.tryParse(qs['lat'] ?? '') ?? 37.4979, lng = double.tryParse(qs['lng'] ?? '') ?? 127.0276;
    return [
      {'name': q, 'address': '$q 근처', 'roadAddress': null, 'lat': lat + 0.008, 'lng': lng + 0.006},
    ];
  }

  // ── 요금 계산 (서버 server/src/catalog/fare.ts 와 같은 규칙) ──
  static Json estimate(Json b) {
    final type = types.firstWhere((t) => t['code'] == b['typeCode']);
    final r = Json.from(type['rates'] as Map);
    final o = Json.from((b['options'] as Map?) ?? {});
    final lines = <Json>[];
    double? distanceKm;
    int round100(num n) => (n / 100).round() * 100;
    if (type['pricingModel'] == 'DISTANCE') {
      final kind = o['serviceKind'] ?? 'TOW';
      if (kind == 'TOW') {
        final base = (r['base'] as Map)[o['vehicleClass'] ?? 'CAR'] as int;
        if (b['destLat'] == null) throw DemoError(400, '견인은 목적지가 필요합니다');
        distanceKm = (_km(b['lat'], b['lng'], b['destLat'], b['destLng']) * 1.35 * 10).round() / 10;
        lines.add({'label': '기본료 (${r['includedKm']}km 포함)', 'amount': base});
        final extra = max(0.0, distanceKm - (r['includedKm'] as num));
        if (extra > 0) lines.add({'label': '거리 요금 ${extra.toStringAsFixed(1)}km', 'amount': round100(extra * (r['perKm'] as num))});
      } else {
        lines.add({'label': '긴급출동', 'amount': (r['emergency'] as Map)[kind]});
      }
    } else {
      final unit = o['durationUnit'] ?? 'HOUR';
      final qty = max(1, ((o['durationQty'] ?? 1) as num).floor());
      if (unit == 'HOUR') {
        final hours = max(qty, (r['minHours'] ?? 1) as int);
        lines.add({'label': '시간 대여 $hours시간${hours > qty ? ' (최소 시간)' : ''}', 'amount': (r['hourly'] as int) * hours});
      } else if (unit == 'HALF_DAY') {
        lines.add({'label': '반일 대여 ×$qty', 'amount': (r['halfDay'] as int) * qty});
      } else {
        lines.add({'label': '일 대여 ×$qty', 'amount': (r['day'] as int) * qty});
      }
    }
    final subtotal = lines.fold<int>(0, (s, l) => s + (l['amount'] as int));
    final at = b['scheduledAt'] != null ? DateTime.parse(b['scheduledAt'] as String) : DateTime.now();
    final kst = at.toUtc().add(const Duration(hours: 9));
    final s = Json.from((r['surcharge'] as Map?) ?? {});
    String pct(num v) => '${(v * 100).round()}%';
    if ((kst.hour >= 22 || kst.hour < 6) && s['night'] != null) {
      lines.add({'label': '야간 할증 ${pct(s['night'])}', 'amount': round100(subtotal * s['night'])});
    }
    if ((kst.weekday == DateTime.saturday || kst.weekday == DateTime.sunday) && s['holiday'] != null) {
      lines.add({'label': '주말 할증 ${pct(s['holiday'])}', 'amount': round100(subtotal * s['holiday'])});
    }
    if (o['highway'] == true && s['highway'] != null) {
      lines.add({'label': '고속도로 할증 ${pct(s['highway'])}', 'amount': round100(subtotal * s['highway'])});
    }
    final amount = lines.fold<int>(0, (s, l) => s + (l['amount'] as int));
    final rp = (r['rangePct'] ?? 0) as num;
    return {
      'pricingModel': type['pricingModel'],
      'amount': amount,
      'min': round100(amount * (1 - rp)),
      'max': round100(amount * (1 + rp)),
      'lines': lines,
      'distanceKm': distanceKm,
    };
  }

  static double _km(dynamic lat1, dynamic lng1, dynamic lat2, dynamic lng2) {
    double rad(dynamic d) => (d as num) * pi / 180;
    final dLat = rad(lat2) - rad(lat1), dLng = rad(lng2) - rad(lng1);
    final a = pow(sin(dLat / 2), 2) + cos(rad(lat1)) * cos(rad(lat2)) * pow(sin(dLng / 2), 2);
    return 6371 * 2 * atan2(sqrt(a), sqrt(1 - a));
  }
}

const _typesJson = r'''[{"code": "TOW", "name": "렉카", "pricingModel": "DISTANCE", "specKeys": [], "rates": {"base": {"CAR": 80000, "SUV": 90000, "TRUCK_1T": 110000}, "perKm": 2500, "rangePct": 0.1, "cancelFee": 30000, "emergency": {"TIRE": 50000, "BATTERY": 40000, "LOCKOUT": 40000}, "surcharge": {"night": 0.2, "highway": 0.1, "holiday": 0.1}, "includedKm": 10}}, {"code": "FORKLIFT", "name": "지게차", "pricingModel": "TIME", "specKeys": ["tonnage"], "rates": {"day": 350000, "hourly": 60000, "halfDay": 200000, "minHours": 2, "cancelFee": 30000, "surcharge": {"night": 0.2, "holiday": 0.1}}}, {"code": "DUMP", "name": "덤프", "pricingModel": "TIME", "specKeys": ["tonnage"], "rates": {"day": 550000, "hourly": 90000, "halfDay": 300000, "minHours": 2, "cancelFee": 45000, "surcharge": {"night": 0.2, "holiday": 0.1}}}, {"code": "EXCAVATOR", "name": "포크레인", "pricingModel": "TIME", "specKeys": ["tonnage"], "rates": {"day": 600000, "hourly": 100000, "halfDay": 350000, "minHours": 2, "cancelFee": 50000, "surcharge": {"night": 0.2, "holiday": 0.1}}}, {"code": "CRANE", "name": "크레인", "pricingModel": "TIME", "specKeys": ["tonnage"], "rates": {"day": 900000, "hourly": 150000, "halfDay": 500000, "minHours": 2, "cancelFee": 75000, "surcharge": {"night": 0.2, "holiday": 0.1}}}, {"code": "RENTAL", "name": "렌탈", "pricingModel": "TIME", "specKeys": [], "rates": {"day": 250000, "hourly": 50000, "halfDay": 150000, "minHours": 2, "cancelFee": 25000, "surcharge": {"night": 0.2, "holiday": 0.1}}}, {"code": "LADDER", "name": "사다리차", "pricingModel": "TIME", "specKeys": ["heightM"], "rates": {"day": 350000, "hourly": 80000, "halfDay": 200000, "minHours": 2, "cancelFee": 40000, "surcharge": {"night": 0.2, "holiday": 0.1}}}, {"code": "SKY", "name": "스카이", "pricingModel": "TIME", "specKeys": ["heightM"], "rates": {"day": 500000, "hourly": 90000, "halfDay": 300000, "minHours": 2, "cancelFee": 45000, "surcharge": {"night": 0.2, "holiday": 0.1}}}]''';
