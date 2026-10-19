import 'dart:async';

import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/map_view.dart';
import 'payment.dart';

/// 호출 이후 화면: 찾는 중 → 배정·이동 → 작업 → 완료(영수증·평가)
class TrackingScreen extends StatefulWidget {
  const TrackingScreen({super.key, required this.jobId});
  final String jobId;
  @override
  State<TrackingScreen> createState() => _TrackingScreenState();
}

class _TrackingScreenState extends State<TrackingScreen> {
  Job? _job;
  LatLng? _providerAt;
  StreamSubscription<SocketEvent>? _sub;
  Timer? _poll;
  bool _adjustmentDialogOpen = false;

  @override
  void initState() {
    super.initState();
    _load();
    _sub = Api.instance.events.listen(_onEvent);
    // 소켓이 끊겨도 화면이 멈추지 않도록 가끔 다시 불러온다.
    _poll = Timer.periodic(const Duration(seconds: 15), (_) => _load());
  }

  @override
  void dispose() {
    _sub?.cancel();
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final j = await Api.instance.job(widget.jobId);
      if (!mounted) return;
      setState(() {
        _job = j;
        final loc = j.providerLocation;
        if (loc != null) _providerAt = LatLng((loc['lat'] as num).toDouble(), (loc['lng'] as num).toDouble());
      });
      _maybeAskAdjustment();
    } catch (_) {}
  }

  void _onEvent(SocketEvent e) {
    if (e.data['jobId'] != widget.jobId && e.data['id'] != widget.jobId) return;
    switch (e.name) {
      case 'provider.location':
        setState(() => _providerAt = LatLng((e.data['lat'] as num).toDouble(), (e.data['lng'] as num).toDouble()));
      case 'job.updated':
      case 'adjustment.requested':
      case 'payment.failed':
        _load();
    }
  }

  void _maybeAskAdjustment() {
    final pending = _job?.adjustments.where((a) => a.status == 'PENDING').firstOrNull;
    if (pending == null || _adjustmentDialogOpen) return;
    _adjustmentDialogOpen = true;
    showModalBottomSheet<bool>(
      context: context,
      isDismissible: false,
      backgroundColor: Colors.white,
      builder: (c) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('추가 요금 요청', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          Text(pending.reason, style: const TextStyle(fontSize: 16)),
          const SizedBox(height: 8),
          Text('${pending.amount >= 0 ? '+' : ''}${won(pending.amount)}', style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          const Text('승인하지 않으면 청구되지 않아요. 거절하면 이용자와 현장에서 다시 이야기해 주세요.', style: TextStyle(color: Colors.black54)),
          const SizedBox(height: 20),
          Row(children: [
            Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(c, false), child: const Text('거절'))),
            const SizedBox(width: 12),
            Expanded(child: FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('승인'))),
          ]),
        ]),
      ),
    ).then((approve) async {
      if (approve != null) {
        try {
          await Api.instance.decideAdjustment(widget.jobId, pending.id, approve);
        } catch (_) {}
      }
      _adjustmentDialogOpen = false;
      _load();
    });
  }

  Future<void> _cancel() async {
    final job = _job!;
    final free = job.status == 'REQUESTED';
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('호출을 취소할까요?'),
        content: Text(free ? '아직 배정 전이라 무료로 취소돼요.' : '배정 후 3분이 지났거나 이용자가 출발했다면 출동비가 나올 수 있어요.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('계속 기다리기')),
          TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('취소하기')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      final j = await Api.instance.cancel(job.id);
      setState(() => _job = j);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final job = _job;
    return Scaffold(
      appBar: AppBar(title: Text(job == null ? '' : statusLabels[job.status] ?? '')),
      body: job == null
          ? const Center(child: CircularProgressIndicator())
          : switch (job.status) {
              'REQUESTED' => _Searching(job: job, onCancel: _cancel),
              'COMPLETED' => _Receipt(job: job, onRated: _load),
              'CANCELLED' => _Cancelled(job: job),
              _ => _OnTheWay(job: job, providerAt: _providerAt, onCancel: _cancel),
            },
    );
  }
}

class _Searching extends StatelessWidget {
  const _Searching({required this.job, required this.onCancel});
  final Job job;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final scheduled = job.scheduledAt != null;
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(children: [
        const Spacer(),
        if (!job.unassignedAlert) const _Pulse() else const Icon(Icons.support_agent, size: 72, color: ink),
        const SizedBox(height: 32),
        Text(
          job.unassignedAlert ? '운영팀이 직접 연결해 드릴게요' : scheduled ? '예약을 받을 이용자를 찾고 있어요' : '가까운 이용자를 찾고 있어요',
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: ink),
        ),
        const SizedBox(height: 8),
        Text(
          job.unassignedAlert
              ? '근처에 바로 받을 수 있는 이용자가 없어요. 연결되면 바로 알려드릴게요.'
              : '가장 빨리 올 수 있는 분께 차례로 요청하고 있어요.',
          textAlign: TextAlign.center,
          style: const TextStyle(color: Colors.black54, fontSize: 15),
        ),
        if (scheduled) Padding(padding: const EdgeInsets.only(top: 8), child: Text('예약 ${dateTime(job.scheduledAt!)}')),
        const SizedBox(height: 24),
        Card(
          child: ListTile(
            title: const Text('예상 요금'),
            trailing: Text(wonRange(job.estimate.min, job.estimate.max), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          ),
        ),
        const Spacer(),
        OutlinedButton(onPressed: onCancel, child: const Text('호출 취소')),
      ]),
    );
  }
}

class _Pulse extends StatefulWidget {
  const _Pulse();
  @override
  State<_Pulse> createState() => _PulseState();
}

class _PulseState extends State<_Pulse> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1600))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 160, height: 160,
      child: AnimatedBuilder(
        animation: _c,
        builder: (_, _) => Stack(alignment: Alignment.center, children: [
          for (final offset in [0.0, 0.5])
            Builder(builder: (_) {
              final v = (_c.value + offset) % 1;
              return Container(
                width: 60 + 100 * v, height: 60 + 100 * v,
                decoration: BoxDecoration(shape: BoxShape.circle, color: brand.withValues(alpha: 0.35 * (1 - v))),
              );
            }),
          Container(
            width: 64, height: 64,
            decoration: const BoxDecoration(shape: BoxShape.circle, color: brand),
            child: const Icon(Icons.radar, color: ink, size: 34),
          ),
        ]),
      ),
    );
  }
}

const _steps = ['MATCHED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'];

class _OnTheWay extends StatelessWidget {
  const _OnTheWay({required this.job, required this.providerAt, required this.onCancel});
  final Job job;
  final LatLng? providerAt;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final pickup = LatLng(job.lat, job.lng);
    final p = job.provider;
    final eq = job.equipment;
    final pending = job.adjustments.where((a) => a.status == 'APPROVED').fold<int>(0, (s, a) => s + a.amount);
    return Column(children: [
      Expanded(
        child: MapView(
          key: ValueKey(providerAt),
          center: providerAt ?? pickup,
          zoom: 14,
          pins: [
            MapPin(pickup, Icons.location_on, color: const Color(0xFFD64545), label: '여기'),
            if (providerAt != null) MapPin(providerAt!, Icons.local_shipping, color: ink, label: p?['companyName'] ?? '이용자'),
          ],
        ),
      ),
      Container(
        color: Colors.white,
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
        child: SafeArea(
          top: false,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _Stepper(current: job.status),
            const SizedBox(height: 16),
            Row(children: [
              const CircleAvatar(radius: 24, backgroundColor: brand, child: Icon(Icons.person, color: ink)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(p?['companyName'] ?? '이용자', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                  Text([
                    if (eq?['plateNo'] != null) eq!['plateNo'],
                    if (p?['rating'] != null) '★ ${(p!['rating'] as num).toStringAsFixed(1)}',
                  ].join(' · '), style: const TextStyle(color: Colors.black54)),
                ]),
              ),
              IconButton.filledTonal(
                tooltip: '전화 (안심번호 연동 예정)',
                onPressed: null,
                icon: const Icon(Icons.call),
              ),
            ]),
            const SizedBox(height: 12),
            Row(children: [
              const Text('요금'),
              const Spacer(),
              Text(won(job.estimate.amount + pending), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            ]),
            if (['MATCHED', 'EN_ROUTE', 'ARRIVED'].contains(job.status)) ...[
              const SizedBox(height: 8),
              Align(alignment: Alignment.centerRight, child: TextButton(onPressed: onCancel, child: const Text('호출 취소'))),
            ],
          ]),
        ),
      ),
    ]);
  }
}

class _Stepper extends StatelessWidget {
  const _Stepper({required this.current});
  final String current;

  @override
  Widget build(BuildContext context) {
    final idx = _steps.indexOf(current);
    return Row(children: [
      for (var i = 0; i < _steps.length - 1; i++) ...[
        Expanded(
          child: Column(children: [
            Container(height: 6, decoration: BoxDecoration(color: i <= idx ? brand : const Color(0xFFE6E4DF), borderRadius: BorderRadius.circular(3))),
            const SizedBox(height: 6),
            Text(statusLabels[_steps[i]]!, style: TextStyle(fontSize: 12, fontWeight: i == idx ? FontWeight.w800 : FontWeight.w500, color: i <= idx ? ink : Colors.black38)),
          ]),
        ),
        if (i < _steps.length - 2) const SizedBox(width: 6),
      ],
    ]);
  }
}

class _Receipt extends StatefulWidget {
  const _Receipt({required this.job, required this.onRated});
  final Job job;
  final VoidCallback onRated;
  @override
  State<_Receipt> createState() => _ReceiptState();
}

class _ReceiptState extends State<_Receipt> {
  int _score = 5;
  final _comment = TextEditingController();
  bool _rated = false;

  Future<void> _submit() async {
    try {
      await Api.instance.rate(widget.job.id, _score, _comment.text.trim());
    } on ApiException catch (e) {
      if (e.status != 409 && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
        return;
      }
    }
    setState(() => _rated = true);
  }

  @override
  Widget build(BuildContext context) {
    final j = widget.job;
    final approved = j.adjustments.where((a) => a.status == 'APPROVED');
    return ListView(padding: const EdgeInsets.all(20), children: [
      const Icon(Icons.check_circle, color: Color(0xFF2E9E5B), size: 56),
      const SizedBox(height: 12),
      const Text('작업이 끝났어요', textAlign: TextAlign.center, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
      const SizedBox(height: 20),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(children: [
            for (final l in j.estimate.lines) _row(l.label, won(l.amount)),
            for (final a in approved) _row('추가 · ${a.reason}', won(a.amount)),
            const Divider(height: 24),
            _row('결제 금액', won(j.finalFare ?? j.estimate.amount), bold: true),
            const SizedBox(height: 4),
            Align(alignment: Alignment.centerLeft, child: Text(_paymentNote(j), style: const TextStyle(fontSize: 12, color: Colors.black54))),
            if (j.payment?['approvalNo'] != null) ...[
              const Divider(height: 24),
              _row('결제 카드', '${j.payment!['card']}'),
              _row('승인번호', '${j.payment!['approvalNo']}'),
              _row('결제 시각', _time(j.payment!['paidAt'] as String)),
            ],
          ]),
        ),
      ),
      if (j.paymentFailed) ...[
        const SizedBox(height: 12),
        _PaymentFailed(job: j, onDone: widget.onRated),
      ],
      const SizedBox(height: 24),
      if (_rated)
        const Text('평가해 주셔서 고마워요.', textAlign: TextAlign.center, style: TextStyle(fontSize: 16))
      else ...[
        const Text('이용자는 어땠나요?', textAlign: TextAlign.center, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          for (var i = 1; i <= 5; i++)
            IconButton(
              iconSize: 40,
              onPressed: () => setState(() => _score = i),
              icon: Icon(i <= _score ? Icons.star_rounded : Icons.star_outline_rounded, color: brand),
            ),
        ]),
        TextField(controller: _comment, maxLines: 2, decoration: const InputDecoration(hintText: '남기고 싶은 말 (선택)')),
        const SizedBox(height: 16),
        FilledButton(onPressed: _submit, child: const Text('평가 보내기')),
      ],
    ]);
  }

  String _paymentNote(Job j) => switch (j.payment?['status']) {
        'PENDING' => '카드 결제를 진행하고 있어요…',
        'CAPTURED' => '등록한 카드로 결제됐어요.',
        'FAILED' => '결제가 안 됐어요. 아래에서 다시 결제해 주세요.',
        'REFUNDED' => '환불됐어요.',
        _ => '등록한 카드로 결제돼요.',
      };

  String _time(String iso) {
    final t = DateTime.parse(iso).toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${t.year}.${two(t.month)}.${two(t.day)} ${two(t.hour)}:${two(t.minute)}';
  }

  Widget _row(String a, String b, {bool bold = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          Expanded(child: Text(a, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w400, fontSize: bold ? 17 : 14))),
          Text(b, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w500, fontSize: bold ? 17 : 14)),
        ]),
      );
}

class _Cancelled extends StatelessWidget {
  const _Cancelled({required this.job});
  final Job job;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.cancel_outlined, size: 56, color: Colors.black45),
          const SizedBox(height: 12),
          const Text('호출이 취소됐어요', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          Text(job.cancelFee > 0 ? '출동비 ${won(job.cancelFee)}이 결제됐어요.' : '요금은 나오지 않았어요.', style: const TextStyle(color: Colors.black54)),
          const SizedBox(height: 24),
          FilledButton(onPressed: () => Navigator.pop(context), child: const Text('처음으로')),
        ]),
      ),
    );
  }
}

/// 자동결제가 거절됐을 때: 카드를 바꾸거나 다시 결제한다
class _PaymentFailed extends StatefulWidget {
  const _PaymentFailed({required this.job, required this.onDone});
  final Job job;
  final VoidCallback onDone;
  @override
  State<_PaymentFailed> createState() => _PaymentFailedState();
}

class _PaymentFailedState extends State<_PaymentFailed> {
  bool _busy = false;

  Future<void> _retry() async {
    setState(() => _busy = true);
    try {
      await Api.instance.retryPayment(widget.job.id);
      widget.onDone();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final reason = widget.job.payment?['failReason'] as String?;
    return Card(
      color: const Color(0xFFFDECEC),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('결제가 안 됐어요', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Color(0xFFB42318))),
          if (reason != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(reason)),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () async {
                  await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PaymentScreen()));
                  widget.onDone();
                },
                child: const Text('카드 바꾸기'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(child: FilledButton(onPressed: _busy ? null : _retry, child: const Text('다시 결제'))),
          ]),
        ]),
      ),
    );
  }
}
