import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import 'demo.dart';
import 'models.dart';
import 'push.dart';

/// 서버 주소. 빌드할 때 --dart-define=API_URL=https://api.example.com 으로 바꾼다.
const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:3000');

class ApiException implements Exception {
  ApiException(this.status, this.message, [this.code]);
  final int status;
  final String message;
  final String? code;
  @override
  String toString() => message;
}

/// 서버 API와 실시간 채널. 앱 전체에서 하나만 쓴다.
class Api {
  Api._();
  static final Api instance = Api._();

  String? _token;
  io.Socket? _socket;
  final _events = StreamController<SocketEvent>.broadcast();

  /// job.updated, provider.location, adjustment.requested, payment.failed, payment.method.updated 이벤트
  Stream<SocketEvent> get events => _events.stream;
  bool get loggedIn => demoMode || _token != null;

  /// 체험판이면 서버 대신 앱 안의 가짜 서버가 응답한다
  late final DemoBackend? _demo = demoMode ? DemoBackend((name, data) => _events.add(SocketEvent(name, Map<String, dynamic>.from(jsonDecode(jsonEncode(data)) as Map)))) : null;

  Future<void> restore() async {
    if (demoMode) return;
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('token');
    if (_token != null) _afterLogin();
  }

  void _afterLogin() {
    if (demoMode) return;
    _connectSocket();
    Push.start(register: registerPushToken);
  }

  Future<void> logout() async {
    if (Push.token != null) {
      try { await _send('DELETE', '/me/push-tokens', {'token': Push.token, 'platform': pushPlatform}); } catch (_) {}
    }
    Push.stop();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('token');
    _token = null;
    _socket?.dispose();
    _socket = null;
  }

  Future<void> requestOtp(String phone) => _send('POST', '/auth/otp/request', {'phone': phone});

  Future<void> verifyOtp(String phone, String code) async {
    final res = await _send('POST', '/auth/otp/verify', {'phone': phone, 'code': code, 'role': 'CUSTOMER'});
    _token = res['token'] as String;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('token', _token!);
    _afterLogin();
  }

  Future<List<EquipmentType>> equipmentTypes() async {
    final list = await _send('GET', '/equipment-types') as List;
    return list.map((e) => EquipmentType.fromJson(e)).toList();
  }

  Future<Estimate> estimate(Map<String, dynamic> body) async => Estimate.fromJson(await _send('POST', '/jobs/estimate', body));

  Future<Job> createJob(Map<String, dynamic> body) async => Job.fromJson(await _send('POST', '/jobs', body));

  Future<List<Job>> myJobs() async {
    final list = await _send('GET', '/jobs') as List;
    return list.map((e) => Job.fromJson(e)).toList();
  }

  Future<Job> job(String id) async => Job.fromJson(await _send('GET', '/jobs/$id'));

  Future<Job> cancel(String id, {String? reason}) async =>
      Job.fromJson(await _send('POST', '/jobs/$id/cancel', {'reason': ?reason}));

  Future<void> decideAdjustment(String jobId, String adjId, bool approve) =>
      _send('POST', '/jobs/$jobId/adjustments/$adjId/${approve ? 'approve' : 'reject'}');

  Future<void> rate(String jobId, int score, String? comment) =>
      _send('POST', '/jobs/$jobId/rating', {'score': score, if (comment != null && comment.isNotEmpty) 'comment': comment});

  // ── 결제 카드 ──
  Future<PaymentMethods> paymentMethods() async => PaymentMethods.fromJson(await _send('GET', '/payments/methods'));

  /// 카드 등록 페이지 주소 (앱 안 브라우저로 연다)
  Future<String> startCardRegistration() async => (await _send('POST', '/payments/billing/session'))['url'] as String;

  /// 체험판 전용: 앱 안의 카드 입력 화면에서 넣은 카드를 등록한다
  Future<void> registerDemoCard(Map<String, String> card) => _send('POST', '/payments/billing/demo-card', card);

  Future<void> removeCard(String id) => _send('DELETE', '/payments/methods/$id');

  Future<void> retryPayment(String jobId) => _send('POST', '/payments/jobs/$jobId/retry');

  // ── 주소 ──
  /// 주소나 장소 이름으로 찾기. 서버에 카카오 키가 없으면 enabled=false.
  Future<({bool enabled, List<Place> places})> searchPlaces(String q, {double? lat, double? lng}) async {
    final qs = Uri(queryParameters: {'q': q, 'lat': ?lat?.toString(), 'lng': ?lng?.toString()}).query;
    final r = await _send('GET', '/geo/search?$qs');
    return (enabled: r['enabled'] == true, places: [for (final p in r['places'] as List) Place.fromJson(p)]);
  }

  Future<String?> addressAt(double lat, double lng) async {
    try {
      final r = await _send('GET', '/geo/reverse?lat=$lat&lng=$lng');
      return r['address'] as String?;
    } catch (_) {
      return null;
    }
  }

  Future<void> registerPushToken(String token, String platform) =>
      _send('POST', '/me/push-tokens', {'token': token, 'platform': platform});

  Future<dynamic> _send(String method, String path, [Map<String, dynamic>? body]) async {
    if (_demo != null) {
      try {
        return jsonDecode(jsonEncode(await _demo.handle(method, path, body)));
      } on DemoError catch (e) {
        throw ApiException(e.status, e.message, e.code);
      }
    }
    final uri = Uri.parse('$apiUrl$path');
    final headers = {
      'Content-Type': 'application/json',
      'Authorization': ?(_token == null ? null : 'Bearer $_token'),
    };
    final res = switch (method) {
      'GET' => await http.get(uri, headers: headers),
      'DELETE' => await http.delete(uri, headers: headers, body: body == null ? null : jsonEncode(body)),
      _ => await http.post(uri, headers: headers, body: jsonEncode(body ?? {})),
    };
    final text = utf8.decode(res.bodyBytes);
    final data = text.isEmpty ? null : jsonDecode(text);
    if (res.statusCode >= 400) {
      final msg = data is Map ? data['message'] : null;
      throw ApiException(
        res.statusCode,
        msg is List ? msg.join('\n') : (msg?.toString() ?? '잠시 후 다시 시도해 주세요'),
        data is Map ? data['code'] as String? : null,
      );
    }
    return data;
  }

  void _connectSocket() {
    _socket?.dispose();
    final s = io.io(
      '$apiUrl/ws',
      io.OptionBuilder().setTransports(['websocket']).setAuth({'token': _token}).disableAutoConnect().build(),
    );
    for (final name in ['job.updated', 'provider.location', 'adjustment.requested', 'payment.failed', 'payment.method.updated']) {
      s.on(name, (data) => _events.add(SocketEvent(name, Map<String, dynamic>.from(data as Map))));
    }
    s.connect();
    _socket = s;
  }
}

class SocketEvent {
  SocketEvent(this.name, this.data);
  final String name;
  final Map<String, dynamic> data;
}
