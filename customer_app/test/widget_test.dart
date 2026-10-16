import 'package:customer_app/screens/login.dart';
import 'package:customer_app/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('번호를 10자리 이상 넣어야 인증번호 버튼이 켜진다', (tester) async {
    await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: const LoginScreen()));
    final button = find.widgetWithText(FilledButton, '인증번호 받기');
    expect(tester.widget<FilledButton>(button).onPressed, isNull);
    await tester.enterText(find.byType(TextField), '01012345678');
    await tester.pump();
    expect(tester.widget<FilledButton>(button).onPressed, isNotNull);
  });
}
