import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:latlong2/latlong.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/map_view.dart';
import '../widgets/place_search.dart';
import 'payment.dart';
import 'tracking.dart';

/// 호출 작성. 렉카는 상황·차종·목적지, 나머지 장비는 일정·대여 시간·규격을 받는다.
class RequestScreen extends StatefulWidget {
  const RequestScreen({super.key, required this.type, required this.origin});
  final EquipmentType type;
  final LatLng origin;
  @override
  State<RequestScreen> createState() => _RequestScreenState();
}

class _RequestScreenState extends State<RequestScreen> {
  late LatLng _pickup = widget.origin;
  final _address = TextEditingController();
  final _memo = TextEditingController();

  // 렉카
  String _serviceKind = 'TOW';
  String _vehicleClass = 'CAR';
  bool _highway = false;
  bool _injury = false;
  LatLng? _dest;
  final _destAddress = TextEditingController();

  // 그 외 장비
  DateTime? _scheduledAt;
  String _unit = 'HOUR';
  int _qty = 2;
  final _spec = <String, TextEditingController>{};

  Estimate? _estimate;
  String? _estimateError;
  bool _submitting = false;
  Timer? _debounce;

  EquipmentType get t => widget.type;

  @override
  void initState() {
    super.initState();
    for (final k in t.specKeys) {
      _spec[k] = TextEditingController();
    }
    _refreshEstimate();
    _fillAddress(_pickup, _address);
  }

  /// 좌표의 주소를 칸에 채운다 (비어 있을 때만). 카카오 키가 없으면 그대로 둔다.
  Future<void> _fillAddress(LatLng p, TextEditingController c, {bool force = false}) async {
    final a = await Api.instance.addressAt(p.latitude, p.longitude);
    if (a != null && mounted && (force || c.text.trim().isEmpty)) setState(() => c.text = a);
  }

  Future<void> _search({required bool dest}) async {
    final place = await searchPlace(context, title: dest ? '목적지 찾기' : '장비가 올 위치 찾기', near: _pickup);
    if (place == null) return;
    final at = LatLng(place.lat, place.lng);
    _changed(() {
      if (dest) {
        _dest = at;
        _destAddress.text = place.name == place.label ? place.label : '${place.name} (${place.label})';
      } else {
        _pickup = at;
        _address.text = place.name == place.label ? place.label : '${place.label} ${place.name}';
      }
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Map<String, dynamic> _body() {
    final requiredSpec = <String, num>{
      for (final e in _spec.entries)
        if (num.tryParse(e.value.text) != null) e.key: num.parse(e.value.text),
    };
    return {
      'typeCode': t.code,
      'lat': _pickup.latitude,
      'lng': _pickup.longitude,
      if (_address.text.trim().isNotEmpty) 'address': _address.text.trim(),
      if (t.isTow && _serviceKind == 'TOW' && _dest != null) ...{
        'destLat': _dest!.latitude,
        'destLng': _dest!.longitude,
        if (_destAddress.text.trim().isNotEmpty) 'destAddress': _destAddress.text.trim(),
      },
      if (!t.isTow && _scheduledAt != null) 'scheduledAt': _scheduledAt!.toUtc().toIso8601String(),
      'options': t.isTow
          ? {'serviceKind': _serviceKind, 'vehicleClass': _vehicleClass, 'highway': _highway}
          : {'durationUnit': _unit, 'durationQty': _qty},
      if (requiredSpec.isNotEmpty) 'requiredSpec': requiredSpec,
      if (_memo.text.trim().isNotEmpty) 'memo': _memo.text.trim(),
      if (t.isTow) 'injury': _injury,
    };
  }

  bool get _needsDest => t.isTow && _serviceKind == 'TOW';

  void _changed(VoidCallback fn) {
    setState(fn);
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), _refreshEstimate);
  }

  Future<void> _refreshEstimate() async {
    if (_needsDest && _dest == null) {
      setState(() { _estimate = null; _estimateError = '목적지를 고르면 예상 요금이 나와요'; });
      return;
    }
    try {
      final e = await Api.instance.estimate(_body()..remove('injury'));
      if (mounted) setState(() { _estimate = e; _estimateError = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _estimate = null; _estimateError = e.message; });
    }
  }

  Future<void> _pickOnMap({required bool dest}) async {
    final picked = await Navigator.of(context).push<LatLng>(MaterialPageRoute(
      builder: (_) => _MapPicker(initial: dest ? (_dest ?? _pickup) : _pickup, title: dest ? '어디로 옮길까요?' : '장비가 올 위치'),
    ));
    if (picked == null) return;
    _changed(() => dest ? _dest = picked : _pickup = picked);
    _fillAddress(picked, dest ? _destAddress : _address, force: true);
  }

  Future<void> _pickSchedule() async {
    final now = DateTime.now();
    final date = await showDatePicker(context: context, firstDate: now, lastDate: now.add(const Duration(days: 60)), initialDate: _scheduledAt ?? now);
    if (date == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: const TimeOfDay(hour: 8, minute: 0));
    if (time == null) return;
    _changed(() => _scheduledAt = DateTime(date.year, date.month, date.day, time.hour, time.minute));
  }

  Future<void> _submit() async {
    if (_injury) {
      await showDialog(
        context: context,
        builder: (c) => AlertDialog(
          icon: const Icon(Icons.local_hospital, color: Color(0xFFD64545), size: 40),
          title: const Text('먼저 119에 신고해 주세요'),
          content: const Text('다친 사람이 있으면 구조가 가장 먼저입니다. 신고한 뒤에 다시 호출해 주세요.'),
          actions: [FilledButton(onPressed: () => Navigator.pop(c), child: const Text('확인'))],
        ),
      );
      return;
    }
    setState(() => _submitting = true);
    try {
      final job = await Api.instance.createJob(_body());
      if (!mounted) return;
      if (job.safetyNotice != null) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(job.safetyNotice!), duration: const Duration(seconds: 6)));
      }
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => TrackingScreen(jobId: job.id)));
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'CARD_REQUIRED') {
        setState(() => _submitting = false);
        return _askCard();
      }
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  /// 카드가 없으면 등록 화면으로 보내고, 등록하고 돌아오면 바로 다시 호출한다.
  Future<void> _askCard() async {
    final go = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        icon: const Icon(Icons.credit_card, size: 40),
        title: const Text('결제 카드를 등록해 주세요'),
        content: const Text('작업이 끝나면 등록한 카드로 자동 결제돼요. 한 번만 등록하면 돼요.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('나중에')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('카드 등록')),
        ],
      ),
    );
    if (go != true || !mounted) return;
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PaymentScreen()));
    if (!mounted) return;
    final m = await Api.instance.paymentMethods();
    if (m.cards.isNotEmpty && mounted) _submit();
  }

  @override
  Widget build(BuildContext context) {
    final canSubmit = !_submitting && _estimate != null;
    return Scaffold(
      appBar: AppBar(title: Text('${t.name} 부르기')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 120),
        children: [
          _Section(
            title: '장비가 올 위치',
            child: Column(children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: SizedBox(
                  height: 140,
                  child: MapView(
                    key: ValueKey(_pickup),
                    center: _pickup,
                    pins: [MapPin(_pickup, Icons.location_on, color: const Color(0xFFD64545))],
                    onTap: (_) => _pickOnMap(dest: false),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Row(children: [
                Expanded(child: OutlinedButton.icon(onPressed: () => _search(dest: false), icon: const Icon(Icons.search), label: const Text('주소로 찾기'))),
                const SizedBox(width: 8),
                Expanded(child: OutlinedButton.icon(onPressed: () => _pickOnMap(dest: false), icon: const Icon(Icons.map_outlined), label: const Text('지도에서 고르기'))),
              ]),
              const SizedBox(height: 8),
              TextField(controller: _address, decoration: const InputDecoration(hintText: '자세한 위치 (예: 강남역 3번 출구 앞, 현장 정문)')),
            ]),
          ),
          if (t.isTow) ..._towFields() else ..._rentalFields(),
          _Section(
            title: '요청 사항',
            child: TextField(controller: _memo, maxLines: 2, decoration: const InputDecoration(hintText: '현장 상황이나 이용자에게 전할 말')),
          ),
          _EstimateCard(estimate: _estimate, message: _estimateError),
        ],
      ),
      bottomSheet: Container(
        color: Colors.white,
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        child: SafeArea(
          top: false,
          child: FilledButton(
            onPressed: canSubmit ? _submit : null,
            child: _submitting
                ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                : Text(_scheduledAt != null ? '${t.name} 예약하기' : '${t.name} 지금 부르기'),
          ),
        ),
      ),
    );
  }

  List<Widget> _towFields() => [
        _Section(
          title: '어떤 상황인가요?',
          child: _Choices(
            value: _serviceKind,
            options: const {'TOW': '견인', 'BATTERY': '배터리 방전', 'TIRE': '타이어 펑크', 'LOCKOUT': '문 잠김'},
            onChanged: (v) => _changed(() => _serviceKind = v),
          ),
        ),
        _Section(
          title: '차종',
          child: _Choices(
            value: _vehicleClass,
            options: const {'CAR': '승용', 'SUV': 'SUV', 'TRUCK_1T': '1톤 이하 화물'},
            onChanged: (v) => _changed(() => _vehicleClass = v),
          ),
        ),
        if (_needsDest)
          _Section(
            title: '어디로 옮길까요?',
            child: Column(children: [
              Row(children: [
                Expanded(child: OutlinedButton.icon(onPressed: () => _search(dest: true), icon: const Icon(Icons.search), label: const Text('주소로 찾기'))),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _pickOnMap(dest: true),
                    icon: const Icon(Icons.flag_outlined),
                    label: Text(_dest == null ? '지도에서 고르기' : '지도에서 다시'),
                  ),
                ),
              ]),
              const SizedBox(height: 8),
              TextField(controller: _destAddress, decoration: const InputDecoration(hintText: '정비소·집·서비스센터 이름')),
            ]),
          ),
        Card(
          child: Column(children: [
            SwitchListTile(
              title: const Text('고속도로·자동차전용도로예요'),
              value: _highway,
              onChanged: (v) => _changed(() => _highway = v),
            ),
            const Divider(height: 1),
            SwitchListTile(
              title: const Text('다친 사람이 있어요'),
              value: _injury,
              onChanged: (v) => setState(() => _injury = v),
            ),
          ]),
        ),
        const SizedBox(height: 16),
      ];

  List<Widget> _rentalFields() => [
        _Section(
          title: '언제 필요하세요?',
          trailing: _scheduledAt == null ? null : Text(dateTime(_scheduledAt!), style: const TextStyle(fontWeight: FontWeight.w600)),
          child: _Choices(
            value: _scheduledAt == null ? 'NOW' : 'LATER',
            options: const {'NOW': '지금 바로', 'LATER': '예약'},
            onChanged: (v) => v == 'NOW' ? _changed(() => _scheduledAt = null) : _pickSchedule(),
          ),
        ),
        _Section(
          title: '얼마나 쓰세요?',
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _Choices(
              value: _unit,
              options: const {'HOUR': '시간 단위', 'HALF_DAY': '반나절', 'DAY': '하루'},
              onChanged: (v) => _changed(() { _unit = v; _qty = v == 'HOUR' ? 2 : 1; }),
            ),
            const SizedBox(height: 8),
            Row(children: [
              IconButton.outlined(onPressed: _qty > 1 ? () => _changed(() => _qty--) : null, icon: const Icon(Icons.remove)),
              SizedBox(
                width: 96,
                child: Text(
                  '$_qty${_unit == 'HOUR' ? '시간' : _unit == 'DAY' ? '일' : '회'}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                ),
              ),
              IconButton.outlined(onPressed: _qty < 30 ? () => _changed(() => _qty++) : null, icon: const Icon(Icons.add)),
            ]),
          ]),
        ),
        for (final k in t.specKeys)
          _Section(
            title: '필요한 ${specLabels[k]?.$1 ?? k} (선택)',
            child: TextField(
              controller: _spec[k],
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
              decoration: InputDecoration(hintText: '이 이상만 받기', suffixText: specLabels[k]?.$2),
              onChanged: (_) => _changed(() {}),
            ),
          ),
      ];
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child, this.trailing});
  final String title;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: ink))),
          ?trailing,
        ]),
        const SizedBox(height: 10),
        child,
      ]),
    );
  }
}

class _Choices extends StatelessWidget {
  const _Choices({required this.value, required this.options, required this.onChanged});
  final String value;
  final Map<String, String> options;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Wrap(spacing: 8, runSpacing: 8, children: [
      for (final e in options.entries)
        ChoiceChip(
          label: Text(e.value),
          selected: value == e.key,
          selectedColor: brand,
          labelStyle: TextStyle(fontWeight: value == e.key ? FontWeight.w700 : FontWeight.w500, color: ink),
          onSelected: (_) => onChanged(e.key),
        ),
    ]);
  }
}

class _EstimateCard extends StatelessWidget {
  const _EstimateCard({required this.estimate, this.message});
  final Estimate? estimate;
  final String? message;

  @override
  Widget build(BuildContext context) {
    final e = estimate;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: e == null
            ? Text(message ?? '예상 요금을 계산하고 있어요', style: const TextStyle(color: Colors.black54))
            : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('예상 요금', style: TextStyle(color: Colors.black54)),
                const SizedBox(height: 4),
                Text(wonRange(e.min, e.max), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: ink)),
                const SizedBox(height: 12),
                for (final l in e.lines)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(children: [Expanded(child: Text(l.label)), Text(won(l.amount))]),
                  ),
                const SizedBox(height: 8),
                const Text('현장에서 요금이 바뀌면 앱에서 승인하셔야만 청구돼요.', style: TextStyle(fontSize: 12, color: Colors.black54)),
              ]),
      ),
    );
  }
}

class _MapPicker extends StatefulWidget {
  const _MapPicker({required this.initial, required this.title});
  final LatLng initial;
  final String title;
  @override
  State<_MapPicker> createState() => _MapPickerState();
}

class _MapPickerState extends State<_MapPicker> {
  late LatLng _p = widget.initial;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Stack(children: [
        MapView(center: widget.initial, pins: [MapPin(_p, Icons.location_on, color: const Color(0xFFD64545))], onTap: (p) => setState(() => _p = p)),
        const Positioned(
          top: 12, left: 12, right: 12,
          child: Card(child: Padding(padding: EdgeInsets.all(12), child: Text('지도를 눌러 위치를 고르세요'))),
        ),
      ]),
      bottomSheet: Container(
        color: Colors.white,
        padding: const EdgeInsets.all(16),
        child: SafeArea(top: false, child: FilledButton(onPressed: () => Navigator.pop(context, _p), child: const Text('이 위치로 정하기'))),
      ),
    );
  }
}
