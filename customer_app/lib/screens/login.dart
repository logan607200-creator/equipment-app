import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../theme.dart';
import 'home.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  bool _sent = false;
  bool _busy = false;
  String? _error;

  String get _digits => _phone.text.replaceAll(RegExp(r'\D'), '');

  Future<void> _run(Future<void> Function() fn) async {
    setState(() { _busy = true; _error = null; });
    try {
      await fn();
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _request() => _run(() async {
        await Api.instance.requestOtp(_digits);
        setState(() => _sent = true);
      });

  Future<void> _verify() => _run(() async {
        await Api.instance.verifyOtp(_digits, _code.text.trim());
        if (!mounted) return;
        Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const HomeScreen()));
      });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 48, 24, 24),
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: Container(
                width: 56, height: 56,
                decoration: BoxDecoration(color: brand, borderRadius: BorderRadius.circular(16)),
                child: const Icon(Icons.construction, color: ink, size: 32),
              ),
            ),
            const SizedBox(height: 24),
            const Text('필요한 장비를\n가까운 곳에서 바로', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, height: 1.3, color: ink)),
            const SizedBox(height: 8),
            const Text('렉카부터 크레인까지, 휴대폰 번호로 시작하세요.', style: TextStyle(fontSize: 15, color: Colors.black54)),
            const SizedBox(height: 32),
            TextField(
              controller: _phone,
              enabled: !_sent,
              keyboardType: TextInputType.phone,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(11)],
              decoration: const InputDecoration(labelText: '휴대폰 번호', hintText: '01012345678'),
              onChanged: (_) => setState(() {}),
            ),
            if (_sent) ...[
              const SizedBox(height: 12),
              TextField(
                controller: _code,
                autofocus: true,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                decoration: const InputDecoration(labelText: '인증번호 6자리'),
                onChanged: (_) => setState(() {}),
              ),
              TextButton(onPressed: _busy ? null : () => setState(() { _sent = false; _code.clear(); }), child: const Text('번호 다시 입력')),
            ],
            if (_error != null) Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _busy ? null : !_sent ? (_digits.length >= 10 ? _request : null) : (_code.text.length == 6 ? _verify : null),
              child: Text(_sent ? '시작하기' : '인증번호 받기'),
            ),
          ],
        ),
      ),
    );
  }
}
