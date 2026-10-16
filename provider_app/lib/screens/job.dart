import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';

/// 수락한 작업 진행: 내비 → 출발 → 도착 → (추가 요금) → 작업 → 완료
class JobScreen extends StatefulWidget {
  const JobScreen({super.key, required this.jobId});
  final String jobId;
  @override
  State<JobScreen> createState() => _JobScreenState();
}

class _JobScreenState extends State<JobScreen> {
  Json? _job;
  bool _busy = false;
  StreamSubscription<SocketEvent>? _sub;

  @override
  void initState() {
    super.initState();
    _load();
    _sub = Api.instance.events.listen((e) {
      if (e.name == 'job.updated' && (e.data['id'] == widget.jobId)) _load();
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final j = await Api.instance.job(widget.jobId);
      if (mounted) setState(() => _job = j);
    } catch (_) {}
  }

  Future<void> _run(Future<void> Function() fn) async {
    setState(() => _busy = true);
    try {
      await fn();
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _navigate({bool toDest = false}) async {
    final j = _job!;
    final lat = toDest ? j['destLat'] : j['lat'];
    final lng = toDest ? j['destLng'] : j['lng'];
    final name = Uri.encodeComponent((toDest ? j['destAddress'] : j['address']) ?? '현장');
    // T맵 앱이 있으면 T맵, 없으면 카카오맵 길찾기
    final tmap = Uri.parse('tmap://route?goalname=$name&goalx=$lng&goaly=$lat');
    if (await canLaunchUrl(tmap)) {
      await launchUrl(tmap);
    } else {
      await launchUrl(Uri.parse('https://map.kakao.com/link/to/$name,$lat,$lng'), mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _requestAdjustment() async {
    final amount = TextEditingController();
    final reason = TextEditingController();
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      builder: (c) => Padding(
        padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.of(c).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('추가 요금 요청', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          const Text('사용자가 앱에서 승인해야 청구돼요. 사유를 구체적으로 적어 주세요.', style: TextStyle(color: Colors.black54)),
          const SizedBox(height: 16),
          TextField(
            controller: amount,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: const InputDecoration(labelText: '금액', suffixText: '원'),
          ),
          const SizedBox(height: 12),
          TextField(controller: reason, decoration: const InputDecoration(labelText: '사유 (예: 도로 이탈 차량 구난, 작업 1시간 연장)')),
          const SizedBox(height: 16),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('요청 보내기')),
        ]),
      ),
    );
    final v = int.tryParse(amount.text);
    if (ok != true || v == null || reason.text.trim().isEmpty) return;
    await _run(() => Api.instance.requestAdjustment(widget.jobId, v, reason.text.trim()));
  }

  Future<void> _cancel() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('배정을 취소할까요?'),
        content: const Text('사용자에게는 다른 이용자를 다시 찾아 드려요. 취소 기록이 남아 다음 배차 순위에 영향을 줄 수 있어요.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('돌아가기')),
          TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('취소하기')),
        ],
      ),
    );
    if (ok != true) return;
    await _run(() => Api.instance.cancelJob(widget.jobId));
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final j = _job;
    if (j == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final status = j['status'] as String;
    final est = Json.from(j['estimate']);
    final adjustments = [for (final a in (j['adjustments'] as List? ?? const [])) Json.from(a as Map)];
    final approved = adjustments.where((a) => a['status'] == 'APPROVED').fold<int>(0, (s, a) => s + (a['amount'] as int));
    final hasPending = adjustments.any((a) => a['status'] == 'PENDING');
    final next = nextAction[status];
    final scheduled = j['scheduledAt'] != null ? DateTime.parse(j['scheduledAt']).toLocal() : null;
    final towing = j['typeCode'] == 'TOW' && j['destLat'] != null;

    return Scaffold(
      appBar: AppBar(title: Text(statusLabels[status] ?? status)),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Icon(equipmentIcon(j['typeCode']), size: 28),
                const SizedBox(width: 10),
                Expanded(child: Text(jobSummary(j), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800))),
              ]),
              if (scheduled != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('예약 ${dateTime(scheduled)}', style: const TextStyle(fontWeight: FontWeight.w700))),
              const Divider(height: 24),
              _row(Icons.location_on_outlined, j['address'] ?? '위치 (지도 참고)'),
              if (j['destAddress'] != null) _row(Icons.flag_outlined, '목적지 ${j['destAddress']}'),
              if (j['memo'] != null) _row(Icons.chat_bubble_outline, j['memo']),
            ]),
          ),
        ),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: OutlinedButton.icon(onPressed: () => _navigate(), icon: const Icon(Icons.navigation_outlined), label: const Text('현장 길안내'))),
          if (towing) ...[
            const SizedBox(width: 8),
            Expanded(child: OutlinedButton.icon(onPressed: () => _navigate(toDest: true), icon: const Icon(Icons.flag_outlined), label: const Text('목적지 길안내'))),
          ],
        ]),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(children: [
              _money('예상 요금', won(est['amount'])),
              for (final a in adjustments)
                _money(
                  '추가 · ${a['reason']}',
                  '${won(a['amount'])} ${switch (a['status']) { 'APPROVED' => '승인', 'REJECTED' => '거절', _ => '승인 대기' }}',
                  muted: a['status'] == 'REJECTED',
                ),
              const Divider(height: 20),
              _money(status == 'COMPLETED' ? '최종 요금' : '현재 청구 금액', won(j['finalFare'] ?? (est['amount'] as int) + approved), bold: true),
            ]),
          ),
        ),
        if (hasPending)
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text('사용자가 추가 요금을 확인하고 있어요. 승인 전에는 완료할 수 없어요.', style: TextStyle(color: Color(0xFFB87A00))),
          ),
        const SizedBox(height: 20),
        if (next != null)
          SizedBox(
            height: 76,
            child: FilledButton(
              style: FilledButton.styleFrom(textStyle: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
              onPressed: _busy || (next.$1 == 'COMPLETED' && hasPending) ? null : () => _run(() => Api.instance.setStatus(widget.jobId, next.$1)),
              child: Text(next.$2),
            ),
          ),
        if (status == 'ARRIVED' && j['typeCode'] != 'TOW') ...[
          const SizedBox(height: 4),
          const Text('작업을 시작한 뒤 끝나면 완료를 눌러 주세요.', textAlign: TextAlign.center, style: TextStyle(color: Colors.black54)),
        ],
        if (status == 'ARRIVED' && j['typeCode'] == 'TOW' && j['destLat'] == null) ...[
          const SizedBox(height: 8),
          OutlinedButton(onPressed: _busy ? null : () => _run(() => Api.instance.setStatus(widget.jobId, 'COMPLETED')), child: const Text('현장 출동 완료')),
        ],
        if (status == 'ARRIVED' || status == 'IN_PROGRESS') ...[
          const SizedBox(height: 8),
          OutlinedButton.icon(onPressed: _busy ? null : _requestAdjustment, icon: const Icon(Icons.add_card), label: const Text('추가 요금 요청')),
        ],
        if (status == 'COMPLETED')
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text('수고하셨어요. 정산 화면에서 지급 예정 금액을 확인할 수 있어요.', textAlign: TextAlign.center),
          ),
        if (['MATCHED', 'EN_ROUTE', 'ARRIVED'].contains(status)) ...[
          const SizedBox(height: 20),
          TextButton(onPressed: _busy ? null : _cancel, child: const Text('배정 취소')),
        ],
      ]),
    );
  }

  Widget _row(IconData icon, String text) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, size: 20, color: Colors.black54),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 15))),
        ]),
      );

  Widget _money(String label, String value, {bool bold = false, bool muted = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          Expanded(child: Text(label, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w400, color: muted ? Colors.black38 : null))),
          Text(value, style: TextStyle(fontWeight: bold ? FontWeight.w900 : FontWeight.w600, fontSize: bold ? 18 : 14, color: muted ? Colors.black38 : null)),
        ]),
      );
}
