import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import 'models.dart';

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

  /// job.updated, provider.location, adjustment.requested 이벤트
  Stream<SocketEvent> get events => _events.stream;
  bool get loggedIn => _token != null;

  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('token');
    if (_token != null) _connectSocket();
  }

  Future<void> logout() async {
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
    _connectSocket();
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

  Future<dynamic> _send(String method, String path, [Map<String, dynamic>? body]) async {
    final uri = Uri.parse('$apiUrl$path');
    final headers = {
      'Content-Type': 'application/json',
      'Authorization': ?(_token == null ? null : 'Bearer $_token'),
    };
    final res = method == 'GET'
        ? await http.get(uri, headers: headers)
        : await http.post(uri, headers: headers, body: jsonEncode(body ?? {}));
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
    for (final name in ['job.updated', 'provider.location', 'adjustment.requested']) {
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
