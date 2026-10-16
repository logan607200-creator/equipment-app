import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';

/// 정산: 기간별 완료 건수, 매출, 수수료, 지급 예정액
class EarningsScreen extends StatefulWidget {
  const EarningsScreen({super.key});
  @override
  State<EarningsScreen> createState() => _EarningsScreenState();
}

class _EarningsScreenState extends State<EarningsScreen> {
  String _range = 'week';
  Json? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  DateTime get _from {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    return switch (_range) {
      'today' => today,
      'week' => today.subtract(Duration(days: today.weekday - 1)),
      _ => DateTime(now.year, now.month),
    };
  }

  Future<void> _load() async {
    final d = await Api.instance.earnings(from: _from);
    if (mounted) setState(() => _data = d);
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final payments = [for (final p in (d?['payments'] as List? ?? const [])) Json.from(p as Map)];
    return Scaffold(
      appBar: AppBar(title: const Text('정산')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'today', label: Text('오늘')),
            ButtonSegment(value: 'week', label: Text('이번 주')),
            ButtonSegment(value: 'month', label: Text('이번 달')),
          ],
          selected: {_range},
          onSelectionChanged: (s) { setState(() => _range = s.first); _load(); },
        ),
        const SizedBox(height: 16),
        if (d == null)
          const Center(child: CircularProgressIndicator())
        else ...[
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('지급 예정', style: TextStyle(color: Colors.black54)),
                Text(won(d['payout']), style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w900)),
                const SizedBox(height: 12),
                _row('완료', '${d['count']}건'),
                _row('매출', won(d['gross'])),
                _row('수수료', '-${won(d['commission'])}'),
              ]),
            ),
          ),
          const SizedBox(height: 16),
          for (final p in payments)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(dateTime(DateTime.parse(p['createdAt']).toLocal())),
              subtitle: Text('매출 ${won(p['amount'])} · 수수료 ${won(p['commission'])}'),
              trailing: Text(won(p['providerPayout']), style: const TextStyle(fontWeight: FontWeight.w800)),
            ),
        ],
      ]),
    );
  }

  Widget _row(String a, String b) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(children: [Expanded(child: Text(a)), Text(b, style: const TextStyle(fontWeight: FontWeight.w600))]),
      );
}
