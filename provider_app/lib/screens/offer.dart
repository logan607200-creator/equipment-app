import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';

/// 호출 제안. 제한 시간 안에 수락하지 않으면 다음 이용자에게 넘어간다.
/// 운전 중에도 누를 수 있게 수락 버튼을 크게 둔다.
class OfferScreen extends StatefulWidget {
  const OfferScreen({super.key, required this.offerId, required this.offer});
  final String offerId;
  final Json offer;
  @override
  State<OfferScreen> createState() => _OfferScreenState();
}

class _OfferScreenState extends State<OfferScreen> {
  late final DateTime _expiresAt = DateTime.parse(widget.offer['expiresAt']).toLocal();
  late final int _totalMs = _expiresAt.difference(DateTime.now()).inMilliseconds.clamp(1, 1 << 30);
  Timer? _tick;
  StreamSubscription<SocketEvent>? _sub;
  bool _busy = false;

  int get _leftMs => _expiresAt.difference(DateTime.now()).inMilliseconds;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(milliseconds: 200), (_) {
      if (_leftMs <= 0) return _close(false, '시간이 지나 다음 이용자에게 넘어갔어요');
      setState(() {});
    });
    _sub = Api.instance.events.listen((e) {
      if (e.name == 'offer.closed' && e.data['offerId'] == widget.offerId) _close(false, '이 호출은 마감됐어요');
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    _sub?.cancel();
    super.dispose();
  }

  void _close(bool accepted, [String? message]) {
    if (!mounted) return;
    _tick?.cancel();
    if (message != null) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    Navigator.of(context).pop(accepted);
  }

  Future<void> _respond(bool accept) async {
    setState(() => _busy = true);
    try {
      if (accept) {
        await Api.instance.accept(widget.offerId);
      } else {
        await Api.instance.reject(widget.offerId);
      }
      _close(accept);
    } on ApiException catch (e) {
      _close(false, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = widget.offer;
    final est = Json.from(o['estimate'] ?? {});
    final etaMin = ((o['etaSec'] as num? ?? 0) / 60).ceil();
    final scheduled = o['scheduledAt'] != null ? DateTime.parse(o['scheduledAt']).toLocal() : null;
    final left = (_leftMs / 1000).ceil().clamp(0, 999);
    return Scaffold(
      backgroundColor: ink,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Icon(equipmentIcon(o['typeCode']), color: brand, size: 32),
              const SizedBox(width: 10),
              Text(scheduled == null ? '새 호출' : '예약 호출', style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w900)),
              const Spacer(),
              Text('$left초', style: const TextStyle(color: brand, fontSize: 22, fontWeight: FontWeight.w900)),
            ]),
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(value: (_leftMs / _totalMs).clamp(0, 1), minHeight: 8, color: brand, backgroundColor: Colors.white12),
            ),
            const SizedBox(height: 28),
            Text(won(est['amount'] ?? 0), style: const TextStyle(color: Colors.white, fontSize: 40, fontWeight: FontWeight.w900)),
            Text('예상 요금 · 수수료 전', style: const TextStyle(color: Colors.white60)),
            const SizedBox(height: 24),
            _info(Icons.near_me, '${(o['distanceKm'] as num).toStringAsFixed(1)}km · 약 $etaMin분 거리'),
            if (scheduled != null) _info(Icons.event, dateTime(scheduled)),
            _info(Icons.assignment_outlined, jobSummary(o)),
            if (o['address'] != null) _info(Icons.location_on_outlined, o['address']),
            if (o['destAddress'] != null) _info(Icons.flag_outlined, '목적지 ${o['destAddress']}${est['distanceKm'] != null ? ' (${est['distanceKm']}km)' : ''}'),
            if (o['memo'] != null) _info(Icons.chat_bubble_outline, o['memo']),
            const Spacer(),
            SizedBox(
              height: 96,
              child: FilledButton(
                style: FilledButton.styleFrom(textStyle: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900)),
                onPressed: _busy ? null : () => _respond(true),
                child: const Text('수락'),
              ),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: _busy ? null : () => _respond(false),
              child: const Text('거절', style: TextStyle(color: Colors.white70, fontSize: 17)),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _info(IconData icon, String text) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, color: Colors.white70, size: 22),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: const TextStyle(color: Colors.white, fontSize: 17))),
        ]),
      );
}
