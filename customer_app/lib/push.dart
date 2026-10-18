import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

// Firebase 콘솔 → 프로젝트 설정 → 내 앱에서 받은 값. 빌드할 때 --dart-define 으로 넣는다.
// 값이 없으면 푸시 없이 동작한다 (앱이 켜져 있을 때는 실시간 채널로 알림을 받는다).
const _apiKey = String.fromEnvironment('FIREBASE_API_KEY');
const _appId = String.fromEnvironment('FIREBASE_APP_ID');
const _senderId = String.fromEnvironment('FIREBASE_SENDER_ID');
const _projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
const _vapidKey = String.fromEnvironment('FIREBASE_VAPID_KEY');

String get pushPlatform => kIsWeb ? 'web' : (defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android');

/// 푸시 알림. 로그인한 뒤 한 번 부른다.
class Push {
  static String? token;
  static bool _started = false;

  /// [register]는 서버에 토큰을 알리는 함수, [onOpen]은 사용자가 알림을 눌렀을 때 받는 데이터.
  static Future<void> start({
    required Future<void> Function(String token, String platform) register,
    void Function(Map<String, dynamic> data)? onOpen,
  }) async {
    if (_apiKey.isEmpty || _started) return;
    _started = true;
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(
          options: const FirebaseOptions(apiKey: _apiKey, appId: _appId, messagingSenderId: _senderId, projectId: _projectId),
        );
      }
      final m = FirebaseMessaging.instance;
      await m.requestPermission();
      // 등록이 끝나면(그리고 값이 바뀔 때마다) 이 기기로 보낼 주소가 온다
      m.onRegistered.listen((t) {
        token = t;
        register(t, pushPlatform);
      });
      await m.register(vapidKey: kIsWeb && _vapidKey.isNotEmpty ? _vapidKey : null);
      FirebaseMessaging.onMessageOpenedApp.listen((msg) => onOpen?.call(msg.data));
      final initial = await m.getInitialMessage();
      if (initial != null) onOpen?.call(initial.data);
    } catch (e) {
      _started = false;
      debugPrint('푸시를 켜지 못했어요: $e');
    }
  }

  static void stop() => _started = false;
}
