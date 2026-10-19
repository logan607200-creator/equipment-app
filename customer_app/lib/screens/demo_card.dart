import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../theme.dart';

/// 체험판 카드 등록 화면. 실제 결제사 창처럼 카드 정보를 받지만 어디에도 보내지 않고 돈도 나가지 않는다.
class DemoCardScreen extends StatefulWidget {
  const DemoCardScreen({super.key});
  @override
  State<DemoCardScreen> createState() => _DemoCardScreenState();
}

class _DemoCardScreenState extends State<DemoCardScreen> {
  final _number = TextEditingController();
  final _expiry = TextEditingController();
  final _birth = TextEditingController();
  final _pin2 = TextEditingController();
  bool _agree = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_number, _expiry, _birth, _pin2]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() { _busy = true; _error = null; });
    try {
      // 카드사 확인을 흉내 내 잠깐 기다린다
      await Future<void>.delayed(const Duration(milliseconds: 1200));
      await Api.instance.registerDemoCard({'number': _number.text, 'expiry': _expiry.text, 'birth': _birth.text, 'pin2': _pin2.text});
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _fillSample() {
    _number.text = '4111 2222 3333 4444';
    _expiry.text = '12/29';
    _birth.text = '900101';
    _pin2.text = '12';
    setState(() => _agree = true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('카드 등록 (체험)')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: const Color(0xFFFFF4D6), borderRadius: BorderRadius.circular(12)),
          child: const Text(
            '체험판이라 실제 카드사로 보내지 않고 돈도 나가지 않아요. 아무 번호나 넣어도 돼요.\n0000으로 끝나는 번호를 넣으면 결제 거절도 체험할 수 있어요.',
            style: TextStyle(fontSize: 13, height: 1.5),
          ),
        ),
        const SizedBox(height: 20),
        _field('카드 번호', _number, '0000 0000 0000 0000', [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(16), _GroupFormatter(4, ' ')]),
        Row(children: [
          Expanded(child: _field('유효기간', _expiry, 'MM/YY', [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(4), _GroupFormatter(2, '/')])),
          const SizedBox(width: 12),
          Expanded(child: _field('비밀번호 앞 2자리', _pin2, '••', [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(2)], obscure: true)),
        ]),
        _field('생년월일 6자리', _birth, '예) 900101', [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)]),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          value: _agree,
          onChanged: (v) => setState(() => _agree = v ?? false),
          controlAffinity: ListTileControlAffinity.leading,
          title: const Text('작업이 끝나면 이 카드로 자동 결제되는 것에 동의해요', style: TextStyle(fontSize: 14)),
        ),
        if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: const TextStyle(color: Color(0xFFB42318)))),
        const SizedBox(height: 8),
        FilledButton(
          onPressed: _busy || !_agree ? null : _submit,
          child: _busy
              ? const Row(mainAxisSize: MainAxisSize.min, children: [
                  SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)),
                  SizedBox(width: 10),
                  Text('카드사 확인 중…'),
                ])
              : const Text('카드 등록'),
        ),
        const SizedBox(height: 8),
        TextButton(onPressed: _busy ? null : _fillSample, child: const Text('예시 카드로 채우기', style: TextStyle(color: ink))),
      ]),
    );
  }

  Widget _field(String label, TextEditingController c, String hint, List<TextInputFormatter> f, {bool obscure = false}) => Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: TextField(
          controller: c,
          obscureText: obscure,
          keyboardType: TextInputType.number,
          inputFormatters: f,
          decoration: InputDecoration(labelText: label, hintText: hint),
        ),
      );
}

/// 숫자를 n자리마다 끊어 보여 준다 (카드 번호 4자리, 유효기간 MM/YY)
class _GroupFormatter extends TextInputFormatter {
  _GroupFormatter(this.size, this.sep);
  final int size;
  final String sep;

  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final digits = newValue.text.replaceAll(RegExp(r'\D'), '');
    final b = StringBuffer();
    for (var i = 0; i < digits.length; i++) {
      if (i > 0 && i % size == 0 && (sep == ' ' || i == size)) b.write(sep);
      b.write(digits[i]);
    }
    final text = b.toString();
    return TextEditingValue(text: text, selection: TextSelection.collapsed(offset: text.length));
  }
}
