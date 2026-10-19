import 'dart:async';
import 'dart:convert';
import 'dart:math';

/// 체험판(데모) 빌드: --dart-define=DEMO=true. 서버 없이 앱 안의 가짜 서버가 응답하고,
/// 출근하면 근처에서 가상의 호출이 들어온다. 수락 후 단계 버튼을 누르면 완료·정산까지 이어진다.
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
  final _rand = Random();
  int _seq = 0;
  String _id(String p) => '$p-${DateTime.now().millisecondsSinceEpoch}-${_seq++}';
  String _now() => DateTime.now().toUtc().toIso8601String();

  late final Json _me = {
    'id': 'demo-provider',
    'companyName': '한빛 중장비',
    'bizRegNo': '123-45-67890',
    'verified': true,
    'online': false,
    'activeEquipmentId': null,
    'currentJobId': null,
    'baseLat': null,
    'baseLng': null,
    'rating': 4.8,
    'acceptanceRate': 0.92,
    'equipment': <Json>[
      {'id': 'eq-tow', 'typeCode': 'TOW', 'plateNo': '서울85바1234', 'spec': {}, 'towClasses': ['CAR', 'SUV'], 'active': true},
      {'id': 'eq-crane', 'typeCode': 'CRANE', 'plateNo': '경기90아5678', 'spec': {'tonnage': 25}, 'towClasses': [], 'active': true},
    ],
  };
  final _jobs = <String, Json>{};
  final _payments = <Json>[];
  Json? _offer;
  Timer? _offerTimer;
  Timer? _expireTimer;
  double _lat = 37.4979, _lng = 127.0276;

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
      case ('GET', ['provider', 'me']):
        return _me;
      case ('PUT', ['provider', 'me']):
        return _me..addAll(b);
      case ('POST', ['provider', 'equipment']):
        final e = {'id': _id('eq'), 'spec': {}, 'towClasses': [], ...b, 'active': true};
        (_me['equipment'] as List).add(e);
        return e;
      case ('POST', ['provider', 'location']):
        _lat = (b['lat'] as num).toDouble();
        _lng = (b['lng'] as num).toDouble();
        return null;
      case ('POST', ['provider', 'online']):
        _me['online'] = true;
        _me['activeEquipmentId'] = b['equipmentId'];
        _scheduleOffer(5);
        return _me;
      case ('POST', ['provider', 'offline']):
        _me['online'] = false;
        _offerTimer?.cancel();
        _closeOffer();
        return _me;
      case ('GET', ['provider', 'offers']):
        return [if (_offer != null) _offer];
      case ('POST', ['provider', 'offers', final id, 'accept']):
        return _accept(id);
      case ('POST', ['provider', 'offers', final id, 'reject']):
        if (_offer?['id'] == id) _closeOffer();
        _scheduleOffer(12);
        return null;
      case ('GET', ['provider', 'jobs']):
        return _jobs.values.toList()..sort((x, y) => (y['createdAt'] as String).compareTo(x['createdAt'] as String));
      case ('GET', ['jobs', final id]):
        return _job(id);
      case ('POST', ['provider', 'jobs', final id, 'status']):
        return _setStatus(id, b['status'] as String);
      case ('POST', ['provider', 'jobs', final id, 'cancel']):
        _me['currentJobId'] = null;
        _scheduleOffer(10);
        return _update(id, {'status': 'CANCELLED'});
      case ('POST', ['provider', 'jobs', final id, 'adjustments']):
        final a = {'id': _id('adj'), 'jobId': id, 'amount': b['amount'], 'reason': b['reason'], 'status': 'PENDING', 'createdAt': _now()};
        (_job(id)['adjustments'] as List).add(a);
        _update(id, {});
        // 체험판에서는 사용자가 몇 초 뒤 승인한다
        Timer(const Duration(seconds: 4), () {
          a['status'] = 'APPROVED';
          a['decidedAt'] = _now();
          if (_jobs.containsKey(id)) _update(id, {});
        });
        return a;
      case ('GET', ['provider', 'earnings']):
        final from = DateTime.tryParse(uri.queryParameters['from'] ?? '');
        final list = [
          for (final p in _payments)
            if (from == null || !DateTime.parse(p['createdAt'] as String).isBefore(from)) p,
        ].reversed.toList();
        int sum(String k) => list.fold(0, (s, p) => s + (p[k] as int));
        return {'count': list.length, 'gross': sum('amount'), 'commission': sum('commission'), 'payout': sum('providerPayout'), 'payments': list};
    }
    throw DemoError(404, '체험판에서는 쓸 수 없는 기능이에요');
  }

  Json _job(String id) => _jobs[id] ?? (throw DemoError(404, '호출을 찾을 수 없어요'));

  Json _update(String id, Json patch) {
    final job = _jobs[id]!..addAll(patch);
    emit('job.updated', job);
    return job;
  }

  /// 출근 중이고 진행 중인 일이 없으면 잠시 뒤 근처 호출을 하나 보낸다
  void _scheduleOffer(int sec) {
    _offerTimer?.cancel();
    _offerTimer = Timer(Duration(seconds: sec), () {
      if (_me['online'] != true || _me['currentJobId'] != null || _offer != null) return;
      final eq = (_me['equipment'] as List).cast<Json>().firstWhere((e) => e['id'] == _me['activeEquipmentId'],
          orElse: () => (_me['equipment'] as List).first as Json);
      final code = eq['typeCode'] as String;
      final angle = _rand.nextDouble() * 2 * pi;
      final lat = _lat + 0.01 * sin(angle), lng = _lng + 0.012 * cos(angle);
      final spot = _spots[_rand.nextInt(_spots.length)];
      final Json req = code == 'TOW'
          ? {
              'typeCode': code,
              'lat': lat,
              'lng': lng,
              'destLat': lat + 0.03,
              'destLng': lng + 0.02,
              'options': {'serviceKind': 'TOW', 'vehicleClass': _rand.nextBool() ? 'CAR' : 'SUV'},
              'requiredSpec': {},
            }
          : {
              'typeCode': code,
              'lat': lat,
              'lng': lng,
              'options': {'durationUnit': _rand.nextBool() ? 'HALF_DAY' : 'HOUR', 'durationQty': _rand.nextBool() ? 1 : 3},
              'requiredSpec': Json.from(eq['spec'] as Map? ?? {}),
            };
      final est = estimate(req);
      final dist = (_km(_lat, _lng, lat, lng) * 1.35 * 10).round() / 10;
      final id = _id('offer');
      _offer = {
        'id': id,
        'offerId': id,
        'jobId': _id('job'),
        'status': 'PENDING',
        'expiresAt': DateTime.now().add(const Duration(seconds: 15)).toUtc().toIso8601String(),
        'etaSec': (dist / 30 * 3600).round() + 60,
        'distanceKm': dist,
        ...req,
        'address': spot.$1,
        'destAddress': code == 'TOW' ? spot.$2 : null,
        'scheduledAt': null,
        'memo': code == 'TOW' ? '차가 갓길에 서 있어요' : '오전 작업입니다',
        'estimate': est,
      };
      emit('offer.created', _offer!);
      _expireTimer?.cancel();
      _expireTimer = Timer(const Duration(seconds: 15), () {
        if (_offer?['id'] != id) return;
        _closeOffer();
        _scheduleOffer(10);
      });
    });
  }

  void _closeOffer() {
    _expireTimer?.cancel();
    final o = _offer;
    _offer = null;
    if (o != null) emit('offer.closed', {'offerId': o['id'], 'jobId': o['jobId']});
  }

  Json _accept(String offerId) {
    final o = _offer;
    if (o == null || o['id'] != offerId) throw DemoError(409, '이미 마감된 호출이에요');
    _expireTimer?.cancel();
    _offer = null;
    final id = o['jobId'] as String;
    final job = <String, dynamic>{
      for (final k in ['typeCode', 'options', 'requiredSpec', 'lat', 'lng', 'address', 'destLat', 'destLng', 'destAddress', 'memo', 'scheduledAt', 'estimate']) k: o[k],
      'id': id,
      'status': 'MATCHED',
      'providerId': _me['id'],
      'equipmentId': _me['activeEquipmentId'],
      'finalFare': null,
      'cancelFee': 0,
      'createdAt': _now(),
      'matchedAt': _now(),
      'adjustments': <Json>[],
    };
    _jobs[id] = job;
    _me['currentJobId'] = id;
    return {'offer': {...o, 'status': 'ACCEPTED'}, 'job': job};
  }

  static const _next = {'MATCHED': ['EN_ROUTE', 'COMPLETED'], 'EN_ROUTE': ['ARRIVED', 'COMPLETED'], 'ARRIVED': ['IN_PROGRESS', 'COMPLETED'], 'IN_PROGRESS': ['COMPLETED']};

  Json _setStatus(String id, String status) {
    final job = _job(id);
    if (!(_next[job['status']] ?? const []).contains(status)) throw DemoError(409, '지금 단계에서는 바꿀 수 없어요');
    if (status != 'COMPLETED') return _update(id, {'status': status, if (status == 'ARRIVED') 'arrivedAt': _now()});
    if ((job['adjustments'] as List).any((a) => a['status'] == 'PENDING')) throw DemoError(409, '사용자가 추가 요금을 승인하기 전이에요');
    final extra = [
      for (final a in job['adjustments'] as List)
        if (a['status'] == 'APPROVED') a['amount'] as int,
    ].fold(0, (s, v) => s + v);
    final fare = (job['estimate']['amount'] as int) + extra;
    final commission = (fare * 0.05).round();
    _payments.add({
      'id': _id('pay'),
      'jobId': id,
      'amount': fare,
      'commission': commission,
      'providerPayout': fare - commission,
      'status': 'CAPTURED',
      'createdAt': _now(),
    });
    _me['currentJobId'] = null;
    _scheduleOffer(15);
    return _update(id, {'status': 'COMPLETED', 'finalFare': fare, 'completedAt': _now()});
  }

  static const _spots = [
    ('서울 강남구 테헤란로 152', '현대자동차 강남 서비스센터'),
    ('서울 서초구 서초대로 397', '기아 오토큐 서초점'),
    ('서울 송파구 올림픽로 300', '송파 공업사'),
    ('서울 성동구 아차산로 113', '성수 정비소'),
    ('경기 성남시 분당구 판교역로 160', '판교 자동차정비'),
  ];

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
