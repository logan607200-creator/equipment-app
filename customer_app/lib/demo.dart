import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

/// 체험판(데모) 빌드: --dart-define=DEMO=true. 서버 없이 앱 안의 가짜 서버가 응답하고,
/// 호출하면 가상의 이용자가 배정되어 다가오고 작업을 마치는 과정이 자동으로 흘러간다.
/// 주소 검색과 도로 거리는 공개 지도 서버(OpenStreetMap, OSRM)를 쓰고, 안 되면 직선 거리로 어림한다.
const demoMode = bool.fromEnvironment('DEMO');

typedef Json = Map<String, dynamic>;

class DemoError implements Exception {
  DemoError(this.status, this.message, {this.code});
  final int status;
  final String message;
  final String? code;
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

  /// 장비별 가상 이용자 위치. 처음 요금을 볼 때 그 근처에 흩어 놓고, 다른 지역이면 그곳에 따로 둔다.
  final _fleets = <String, List<({double lat, double lng, List<(double, double)> cars})>>{};
  final _routes = <String, _Route>{};
  static const _ua = {'User-Agent': 'equipment-call-demo/1.0 (github.com/logan607200-creator/equipment-app)'};
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
        return _estimate(b);
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
        return {'pgEnabled': false, 'cardRequired': true, 'methods': _cards};
      case ('POST', ['payments', 'billing', 'session']):
        // 체험판은 결제사 창 대신 앱 안의 체험용 카드 입력 화면을 연다
        return {'url': demoCardUrl};
      case ('POST', ['payments', 'billing', 'demo-card']):
        return _registerCard(b);
      case ('DELETE', ['payments', 'methods', final id]):
        _cards.removeWhere((c) => c['id'] == id);
        return null;
      case ('POST', ['payments', 'jobs', final id, 'retry']):
        _charge(id, _job(id)['payment']['amount'] as int, 'FARE');
        return {'ok': true};
      case ('GET', ['geo', 'search']):
        return {'enabled': true, 'places': await _searchPlaces(uri.queryParameters)};
      case ('GET', ['geo', 'reverse']):
        return {'address': await _reverse(double.parse(uri.queryParameters['lat']!), double.parse(uri.queryParameters['lng']!))};
    }
    throw DemoError(404, '체험판에서는 쓸 수 없는 기능이에요');
  }

  Json _job(String id) => _jobs[id] ?? (throw DemoError(404, '호출을 찾을 수 없어요'));

  Future<Json> _create(Json b) async {
    if (_cards.isEmpty) throw DemoError(400, '결제 카드를 먼저 등록해 주세요', code: 'CARD_REQUIRED');
    final type = types.firstWhere((t) => t['code'] == b['typeCode']);
    final estimate = await _estimate(b);
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
      'estimate': estimate,
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
    final lat = (b['lat'] as num).toDouble(), lng = (b['lng'] as num).toDouble();
    final start = _nearestCar(b['typeCode'] as String, lat, lng);
    _run(id, type, await _route(start.$1, start.$2, lat, lng));
    return job;
  }

  /// 배정 → 출발 → 도로를 따라 다가옴 → 도착 → 작업 → 완료를 자동으로 진행한다
  void _run(String id, Json type, _Route approach) {
    final job = _jobs[id]!;
    final (startLat, startLng) = approach.points.first;
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
        final (pLat, pLng) = approach.at(i / steps);
        final p = {'lat': pLat, 'lng': pLng};
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
    _update(id, {'status': 'COMPLETED', 'finalFare': fare, 'completedAt': _now(), 'providerLocation': null});
    _charge(id, fare, 'FARE');
  }

  /// 등록한 카드로 결제한다. 승인까지 잠깐 걸리고, 0000으로 끝나는 카드는 거절된다.
  void _charge(String id, int amount, String kind) {
    final card = _cards.isEmpty ? null : _cards.first;
    _update(id, {'payment': {'status': 'PENDING', 'amount': amount, 'kind': kind, 'method': 'CARD', 'failReason': null}});
    Timer(const Duration(seconds: 2), () {
      if (card == null || card['last4'] == '0000') {
        _update(id, {'payment': {'status': 'FAILED', 'amount': amount, 'kind': kind, 'method': 'CARD',
          'failReason': card == null ? '등록한 카드가 없어요' : '카드 한도를 초과했어요 (체험용 거절 카드)'}});
        return;
      }
      _update(id, {'payment': {
        'status': 'CAPTURED', 'amount': amount, 'kind': kind, 'method': 'CARD', 'failReason': null,
        'card': '${card['cardCompany']} ${card['cardNumber']}',
        'approvalNo': '${10000000 + _rand.nextInt(89999999)}',
        'paidAt': _now(),
      }});
    });
  }

  Json _registerCard(Json b) {
    final number = '${b['number'] ?? ''}'.replaceAll(RegExp(r'\D'), '');
    final expiry = RegExp(r'^(\d{2})/?(\d{2})$').firstMatch('${b['expiry'] ?? ''}'.trim());
    if (number.length < 15 || number.length > 16) throw DemoError(400, '카드 번호 15~16자리를 넣어 주세요');
    final month = expiry == null ? 0 : int.parse(expiry.group(1)!);
    if (expiry == null || month < 1 || month > 12) throw DemoError(400, '유효기간을 월/년(MM/YY)으로 넣어 주세요');
    final now = DateTime.now();
    if (DateTime(2000 + int.parse(expiry.group(2)!), month + 1).isBefore(now)) throw DemoError(400, '유효기간이 지난 카드예요');
    if ('${b['birth'] ?? ''}'.length != 6 || '${b['pin2'] ?? ''}'.length != 2) throw DemoError(400, '생년월일 6자리와 비밀번호 앞 2자리를 넣어 주세요');
    final brand = switch (number[0]) { '4' => 'VISA', '5' => 'Mastercard', '3' => 'AMEX', _ => '국내전용' };
    final last4 = number.substring(number.length - 4);
    final card = {'id': _id('card'), 'cardCompany': '체험카드($brand)', 'cardNumber': '${number.substring(0, 4)}-****-****-$last4', 'last4': last4};
    _cards
      ..clear()
      ..add(card);
    emit('payment.method.updated', {});
    return card;
  }

  Json _cancel(String id) {
    final job = _job(id);
    for (final t in _timers.remove(id) ?? const <Timer>[]) {
      t.cancel();
    }
    final type = types.firstWhere((t) => t['code'] == job['typeCode']);
    final fee = job['status'] == 'REQUESTED' ? 0 : (type['rates']['cancelFee'] as int? ?? 0);
    final res = _update(id, {'status': 'CANCELLED', 'cancelFee': fee, 'providerLocation': null});
    if (fee > 0) _charge(id, fee, 'CANCEL_FEE');
    return res;
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

  Future<List<Json>> _searchPlaces(Map<String, String> qs) async {
    final q = (qs['q'] ?? '').trim();
    final lat = double.tryParse(qs['lat'] ?? '') ?? 37.4979, lng = double.tryParse(qs['lng'] ?? '') ?? 127.0276;
    if (q.isNotEmpty) {
      try {
        final res = await http.get(Uri.https('nominatim.openstreetmap.org', '/search', {
          'q': q, 'format': 'jsonv2', 'addressdetails': '1', 'countrycodes': 'kr', 'accept-language': 'ko', 'limit': '8',
          'viewbox': '${lng - 0.4},${lat + 0.3},${lng + 0.4},${lat - 0.3}',
        }), headers: _ua).timeout(const Duration(seconds: 5));
        final found = [
          for (final e in jsonDecode(res.body) as List)
            {
              'name': (e['name'] as String?)?.isNotEmpty == true ? e['name'] : q,
              'address': _address(e['address'] as Map?) ?? e['display_name'],
              'roadAddress': null,
              'lat': double.parse(e['lat'] as String),
              'lng': double.parse(e['lon'] as String),
            },
        ];
        if (found.isNotEmpty) return found;
      } catch (_) {}
    }
    final hits = [
      for (final p in _places)
        if (q.isEmpty || p.$1.contains(q) || p.$2.contains(q) || p.$3.contains(q) || q.contains(p.$1))
          {'name': p.$1, 'address': p.$2, 'roadAddress': p.$3, 'lat': p.$4, 'lng': p.$5},
    ];
    if (hits.isNotEmpty || q.isEmpty) return hits;
    // 지도 서버에 못 닿고 목록에도 없는 검색어는 근처 아무 곳으로 보여 준다
    return [
      {'name': q, 'address': '$q 근처', 'roadAddress': null, 'lat': lat + 0.008, 'lng': lng + 0.006},
    ];
  }

  Future<String?> _reverse(double lat, double lng) async {
    try {
      final res = await http.get(Uri.https('nominatim.openstreetmap.org', '/reverse', {
        'lat': '$lat', 'lon': '$lng', 'format': 'jsonv2', 'accept-language': 'ko', 'zoom': '18',
      }), headers: _ua).timeout(const Duration(seconds: 5));
      return _address((jsonDecode(res.body) as Map)['address'] as Map?);
    } catch (_) {
      return null;
    }
  }

  /// OpenStreetMap 주소 조각을 '경기 수원시 팔달구 매산로1가 덕영대로 924' 순서로 붙인다
  static String? _address(Map? a) {
    if (a == null) return null;
    final parts = <String>[];
    for (final k in ['province', 'city', 'county', 'borough', 'city_district', 'town', 'suburb', 'quarter', 'village', 'neighbourhood', 'road']) {
      final v = a[k] as String?;
      if (v != null && v.isNotEmpty && !parts.contains(v)) parts.add(v);
    }
    if (parts.isEmpty) return null;
    final no = a['house_number'] as String?;
    return [...parts, ?no].join(' ');
  }

  /// 장비별 가상 이용자 다섯 명을 호출 위치 1.5~14km 안에 흩어 둔다
  List<(double, double)> _carsNear(String code, double lat, double lng) {
    final fleets = _fleets.putIfAbsent(code, () => []);
    for (final f in fleets) {
      if (_km(f.lat, f.lng, lat, lng) < 15) return f.cars;
    }
    final cars = [
      for (var i = 0; i < 5; i++)
        () {
          final d = 1.5 + _rand.nextDouble() * 12.5, b = _rand.nextDouble() * 2 * pi;
          return (lat + d / 111 * cos(b), lng + d / (111 * cos(lat * pi / 180)) * sin(b));
        }(),
    ];
    fleets.add((lat: lat, lng: lng, cars: cars));
    return cars;
  }

  (double, double) _nearestCar(String code, double lat, double lng) =>
      _carsNear(code, lat, lng).reduce((a, b) => _km(a.$1, a.$2, lat, lng) <= _km(b.$1, b.$2, lat, lng) ? a : b);

  /// 실제 도로 경로 (OSRM 공개 서버). 못 받으면 직선 × 도로 계수로 어림한다.
  Future<_Route> _route(double aLat, double aLng, double bLat, double bLng) async {
    final key = [aLat, aLng, bLat, bLng].map((v) => v.toStringAsFixed(4)).join(',');
    final cached = _routes[key];
    if (cached != null) return cached;
    try {
      final res = await http
          .get(Uri.parse('https://router.project-osrm.org/route/v1/driving/$aLng,$aLat;$bLng,$bLat?overview=simplified&geometries=geojson'), headers: _ua)
          .timeout(const Duration(seconds: 5));
      final r = (jsonDecode(res.body)['routes'] as List).first as Map;
      final pts = [for (final c in r['geometry']['coordinates'] as List) ((c[1] as num).toDouble(), (c[0] as num).toDouble())];
      return _routes[key] = _Route((r['distance'] as num) / 1000, pts.length < 2 ? [(aLat, aLng), (bLat, bLng)] : pts);
    } catch (_) {
      return _routes[key] = _Route(_km(aLat, aLng, bLat, bLng) * 1.35, [(aLat, aLng), (bLat, bLng)]);
    }
  }

  /// 도로 거리를 구한 뒤 요금을 계산한다: 견인은 현장→목적지, 출동 거리 요금은 가장 가까운 이용자→현장
  Future<Json> _estimate(Json b) async {
    final type = types.firstWhere((t) => t['code'] == b['typeCode']);
    final lat = (b['lat'] as num).toDouble(), lng = (b['lng'] as num).toDouble();
    double? towKm, dispatchKm;
    final towing = type['pricingModel'] == 'DISTANCE' && ((b['options'] as Map?)?['serviceKind'] ?? 'TOW') == 'TOW';
    if (towing && b['destLat'] != null) {
      towKm = (await _route(lat, lng, (b['destLat'] as num).toDouble(), (b['destLng'] as num).toDouble())).km;
    }
    if (type['rates']['dispatch'] != null) {
      final car = _nearestCar(b['typeCode'] as String, lat, lng);
      dispatchKm = (await _route(car.$1, car.$2, lat, lng)).km;
    }
    return estimate(b, towKm: towKm, dispatchKm: dispatchKm);
  }

  // ── 요금 계산 (서버 server/src/catalog/fare.ts 와 같은 규칙) ──
  static Json estimate(Json b, {double? towKm, double? dispatchKm}) {
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
        distanceKm = ((towKm ?? _km(b['lat'], b['lng'], b['destLat'], b['destLng']) * 1.35) * 10).round() / 10;
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
    final d = r['dispatch'] as Map?;
    final dKm = dispatchKm == null ? null : (dispatchKm * 10).round() / 10;
    if (dKm != null && d != null) {
      final extraKm = max(0.0, dKm - (d['freeKm'] as num));
      if (extraKm > 0) lines.add({'label': '출동 거리 요금 ${extraKm.toStringAsFixed(1)}km (무료 ${d['freeKm']}km 초과)', 'amount': round100(extraKm * (d['perKm'] as num))});
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
      'dispatchKm': dKm,
    };
  }

  static double _km(dynamic lat1, dynamic lng1, dynamic lat2, dynamic lng2) {
    double rad(dynamic d) => (d as num) * pi / 180;
    final dLat = rad(lat2) - rad(lat1), dLng = rad(lng2) - rad(lng1);
    final a = pow(sin(dLat / 2), 2) + cos(rad(lat1)) * cos(rad(lat2)) * pow(sin(dLng / 2), 2);
    return 6371 * 2 * atan2(sqrt(a), sqrt(1 - a));
  }
}

/// 체험판 카드 입력 화면을 여는 표시 (결제사 창 주소 대신)
const demoCardUrl = 'demo:card';

class _Route {
  _Route(this.km, this.points);
  final double km;
  final List<(double, double)> points;

  /// 경로를 따라 f(0~1)만큼 간 지점
  (double, double) at(double f) {
    final seg = [for (var i = 1; i < points.length; i++) DemoBackend._km(points[i - 1].$1, points[i - 1].$2, points[i].$1, points[i].$2)];
    var left = seg.fold<double>(0, (s, v) => s + v) * f.clamp(0, 1);
    for (var i = 0; i < seg.length; i++) {
      if (left <= seg[i] || i == seg.length - 1) {
        final t = seg[i] == 0 ? 1.0 : (left / seg[i]).clamp(0.0, 1.0);
        final (a, b) = (points[i], points[i + 1]);
        return (a.$1 + (b.$1 - a.$1) * t, a.$2 + (b.$2 - a.$2) * t);
      }
      left -= seg[i];
    }
    return points.last;
  }
}

const _typesJson = r'''[{"code": "TOW", "name": "렉카", "pricingModel": "DISTANCE", "specKeys": [], "rates": {"base": {"CAR": 80000, "SUV": 90000, "TRUCK_1T": 110000}, "perKm": 2500, "rangePct": 0.1, "cancelFee": 30000, "emergency": {"TIRE": 50000, "BATTERY": 40000, "LOCKOUT": 40000}, "surcharge": {"night": 0.2, "highway": 0.1, "holiday": 0.1}, "includedKm": 10}}, {"code": "FORKLIFT", "name": "지게차", "pricingModel": "TIME", "specKeys": ["tonnage"], "rates": {"day": 350000, "hourly": 60000, "halfDay": 200000, "minHours": 2, "dispatch": {"freeKm": 5, "perKm": 2000}, "cancelFee": 30000, "surcharge": {"night": 0.2, "holiday": 0.1}}}, {"code": "DUMP", "name": "덤프", "pricingModel": "TIME", "specKeys": ["tonnage"], "rates": {"day": 550000, "hourly": 90000, "halfDay": 300000, "minHours": 2, "dispatch": {"freeKm": 5, "perKm": 2000}, "cancelFee": 45000, "surcharge": {"night": 0.2, "holiday": 0.1}}}, {"code": "EXCAVATOR", "name": "포크레인", "pricingModel": "TIME", "specKeys": ["tonnage"], "rates": {"day": 600000, "hourly": 100000, "halfDay": 350000, "minHours": 2, "dispatch": {"freeKm": 5, "perKm": 2000}, "cancelFee": 50000, "surcharge": {"night": 0.2, "holiday": 0.1}}}, {"code": "CRANE", "name": "크레인", "pricingModel": "TIME", "specKeys": ["tonnage"], "rates": {"day": 900000, "hourly": 150000, "halfDay": 500000, "minHours": 2, "dispatch": {"freeKm": 5, "perKm": 2000}, "cancelFee": 75000, "surcharge": {"night": 0.2, "holiday": 0.1}}}, {"code": "RENTAL", "name": "렌탈", "pricingModel": "TIME", "specKeys": [], "rates": {"day": 250000, "hourly": 50000, "halfDay": 150000, "minHours": 2, "dispatch": {"freeKm": 5, "perKm": 2000}, "cancelFee": 25000, "surcharge": {"night": 0.2, "holiday": 0.1}}}, {"code": "LADDER", "name": "사다리차", "pricingModel": "TIME", "specKeys": ["heightM"], "rates": {"day": 350000, "hourly": 80000, "halfDay": 200000, "minHours": 2, "dispatch": {"freeKm": 5, "perKm": 2000}, "cancelFee": 40000, "surcharge": {"night": 0.2, "holiday": 0.1}}}, {"code": "SKY", "name": "스카이", "pricingModel": "TIME", "specKeys": ["heightM"], "rates": {"day": 500000, "hourly": 90000, "halfDay": 300000, "minHours": 2, "dispatch": {"freeKm": 5, "perKm": 2000}, "cancelFee": 45000, "surcharge": {"night": 0.2, "holiday": 0.1}}}]''';
