import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import 'push.dart';

/// 서버 주소. 빌드할 때 --dart-define=API_URL=https://api.example.com 으로 바꾼다.
const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:3000');

class ApiException implements Exception {
  ApiException(this.status, this.message);
  final int status;
  final String message;
  @override
  String toString() => message;
}

class SocketEvent {
  SocketEvent(this.name, this.data);
  final String name;
  final Map<String, dynamic> data;
}

typedef Json = Map<String, dynamic>;

/// 이용자(공급자) 앱의 서버 API와 실시간 채널
class Api {
  Api._();
  static final Api instance = Api._();

  String? _token;
  io.Socket? _socket;
  final _events = StreamController<SocketEvent>.broadcast();

  /// offer.created, offer.closed, job.updated
  Stream<SocketEvent> get events => _events.stream;
  bool get loggedIn => _token != null;

  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('token');
    if (_token != null) _afterLogin();
  }

  /// 앱이 꺼져 있거나 화면이 잠겨 있어도 호출 제안을 받도록 푸시를 켠다.
  /// 알림을 눌러 앱을 열면 첫 화면이 대기 중인 제안을 바로 띄운다.
  void _afterLogin() {
    _connectSocket();
    Push.start(register: (token, platform) => _send('POST', '/me/push-tokens', {'token': token, 'platform': platform}));
  }

  Future<void> logout() async {
    if (Push.token != null) {
      try { await _send('DELETE', '/me/push-tokens', {'token': Push.token, 'platform': pushPlatform}); } catch (_) {}
    }
    Push.stop();
    (await SharedPreferences.getInstance()).remove('token');
    _token = null;
    _socket?.dispose();
    _socket = null;
  }

  Future<void> requestOtp(String phone) => _send('POST', '/auth/otp/request', {'phone': phone});

  Future<void> verifyOtp(String phone, String code) async {
    final res = await _send('POST', '/auth/otp/verify', {'phone': phone, 'code': code, 'role': 'PROVIDER'});
    _token = res['token'] as String;
    (await SharedPreferences.getInstance()).setString('token', _token!);
    _afterLogin();
  }

  Future<List<Json>> equipmentTypes() async => _list(await _send('GET', '/equipment-types'));
  Future<Json> me() async => Json.from(await _send('GET', '/provider/me'));
  Future<Json> updateProfile(Json body) async => Json.from(await _send('PUT', '/provider/me', body));
  Future<Json> addEquipment(Json body) async => Json.from(await _send('POST', '/provider/equipment', body));
  Future<void> online(String equipmentId) => _send('POST', '/provider/online', {'equipmentId': equipmentId});
  Future<void> offline() => _send('POST', '/provider/offline');

  /// 출근 중에는 몇 초마다 위치를 보낸다. 소켓이 연결돼 있으면 소켓으로, 아니면 HTTP로.
  Future<void> sendLocation(double lat, double lng) async {
    final s = _socket;
    if (s != null && s.connected) {
      s.emit('location', {'lat': lat, 'lng': lng});
    } else {
      await _send('POST', '/provider/location', {'lat': lat, 'lng': lng});
    }
  }

  Future<List<Json>> offers() async => _list(await _send('GET', '/provider/offers'));
  Future<Json> accept(String offerId) async => Json.from(await _send('POST', '/provider/offers/$offerId/accept'));
  Future<void> reject(String offerId) => _send('POST', '/provider/offers/$offerId/reject');
  Future<List<Json>> jobs() async => _list(await _send('GET', '/provider/jobs'));
  Future<Json> job(String id) async => Json.from(await _send('GET', '/jobs/$id'));
  Future<Json> setStatus(String id, String status) async =>
      Json.from(await _send('POST', '/provider/jobs/$id/status', {'status': status}));
  Future<void> cancelJob(String id) => _send('POST', '/provider/jobs/$id/cancel');
  Future<void> requestAdjustment(String id, int amount, String reason) =>
      _send('POST', '/provider/jobs/$id/adjustments', {'amount': amount, 'reason': reason});
  Future<Json> earnings({DateTime? from}) async =>
      Json.from(await _send('GET', '/provider/earnings${from == null ? '' : '?from=${from.toUtc().toIso8601String()}'}'));

  List<Json> _list(dynamic v) => [for (final e in v as List) Json.from(e as Map)];

  Future<dynamic> _send(String method, String path, [Json? body]) async {
    final uri = Uri.parse('$apiUrl$path');
    final headers = {'Content-Type': 'application/json', 'Authorization': ?(_token == null ? null : 'Bearer $_token')};
    final res = switch (method) {
      'GET' => await http.get(uri, headers: headers),
      'PUT' => await http.put(uri, headers: headers, body: jsonEncode(body ?? {})),
      'DELETE' => await http.delete(uri, headers: headers, body: body == null ? null : jsonEncode(body)),
      _ => await http.post(uri, headers: headers, body: jsonEncode(body ?? {})),
    };
    final text = utf8.decode(res.bodyBytes);
    final data = text.isEmpty ? null : jsonDecode(text);
    if (res.statusCode >= 400) {
      final msg = data is Map ? data['message'] : null;
      throw ApiException(res.statusCode, msg is List ? msg.join('\n') : (msg?.toString() ?? '잠시 후 다시 시도해 주세요'));
    }
    return data;
  }

  void _connectSocket() {
    _socket?.dispose();
    final s = io.io('$apiUrl/ws', io.OptionBuilder().setTransports(['websocket']).setAuth({'token': _token}).disableAutoConnect().build());
    for (final name in ['offer.created', 'offer.closed', 'job.updated']) {
      s.on(name, (data) => _events.add(SocketEvent(name, Json.from(data as Map))));
    }
    s.connect();
    _socket = s;
  }
}
