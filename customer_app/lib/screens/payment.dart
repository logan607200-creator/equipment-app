import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';

/// 결제 카드 등록·확인. 카드 정보는 토스페이먼츠 결제창에서 넣고 앱에는 가린 번호만 보인다.
class PaymentScreen extends StatefulWidget {
  const PaymentScreen({super.key});
  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> with WidgetsBindingObserver {
  PaymentMethods? _data;
  String? _error;
  bool _opening = false;
  StreamSubscription<SocketEvent>? _sub;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    _sub = Api.instance.events.listen((e) {
      if (e.name == 'payment.method.updated') {
        _load();
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('카드를 등록했어요')));
      }
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _sub?.cancel();
    super.dispose();
  }

  // 카드 등록 창을 닫고 돌아오면 다시 불러온다
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.paymentMethods();
      if (mounted) setState(() { _data = d; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = '서버에 연결할 수 없어요');
    }
  }

  Future<void> _register() async {
    setState(() => _opening = true);
    try {
      final url = await Api.instance.startCardRegistration();
      await launchUrl(Uri.parse(url), mode: LaunchMode.inAppBrowserView, webOnlyWindowName: '_blank');
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  Future<void> _remove(SavedCard c) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('카드를 지울까요?'),
        content: Text(c.label),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('아니요')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('지우기')),
        ],
      ),
    );
    if (ok != true) return;
    await Api.instance.removeCard(c.id);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    return Scaffold(
      appBar: AppBar(title: const Text('결제 카드')),
      body: d == null
          ? Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(16), children: [
                if (d.cards.isEmpty)
                  const Card(
                    child: Padding(
                      padding: EdgeInsets.all(20),
                      child: Column(children: [
                        Icon(Icons.credit_card_off_outlined, size: 40, color: Colors.black38),
                        SizedBox(height: 8),
                        Text('등록한 카드가 없어요', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                        SizedBox(height: 4),
                        Text('카드를 등록하면 작업이 끝났을 때 자동으로 결제돼요.', textAlign: TextAlign.center, style: TextStyle(color: Colors.black54)),
                      ]),
                    ),
                  ),
                for (final c in d.cards)
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.credit_card, color: ink),
                      title: Text(c.company ?? '카드', style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text(c.number ?? ''),
                      trailing: IconButton(tooltip: '지우기', icon: const Icon(Icons.delete_outline), onPressed: () => _remove(c)),
                    ),
                  ),
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: _opening ? null : _register,
                  icon: const Icon(Icons.add_card),
                  label: Text(d.cards.isEmpty ? '카드 등록하기' : '다른 카드로 바꾸기'),
                ),
                const SizedBox(height: 12),
                Text(
                  d.pgEnabled
                      ? '카드 번호는 토스페이먼츠가 보관하고, 이 앱과 서버에는 저장되지 않아요.'
                      : '지금은 결제사 연동 전이라 시연용 카드로 등록돼요. 돈은 나가지 않아요.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 12, color: Colors.black54),
                ),
              ]),
            ),
    );
  }
}
