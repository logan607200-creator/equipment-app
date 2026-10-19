import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'api.dart';
import 'demo.dart';
import 'screens/home.dart';
import 'screens/login.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('ko');
  await Api.instance.restore();
  runApp(const CustomerApp());
}

/// 사용자(장비가 필요한 사람) 앱
class CustomerApp extends StatelessWidget {
  const CustomerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '장비 호출',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      locale: const Locale('ko', 'KR'),
      supportedLocales: const [Locale('ko', 'KR')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      // 체험판은 화면 귀퉁이에 표시해 실제 서비스와 헷갈리지 않게 한다
      builder: demoMode ? (context, child) => Banner(message: '체험판', location: BannerLocation.topEnd, child: child!) : null,
      home: Api.instance.loggedIn ? const HomeScreen() : const LoginScreen(),
    );
  }
}
