import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../location.dart';
import '../models.dart';
import '../theme.dart';

/// 업체 정보와 장비 등록. 서류 사진 업로드는 다음 단계에서 붙인다.
class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key, required this.me});
  final Json me;
  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  late final _company = TextEditingController(text: widget.me['companyName'] ?? '');
  late final _bizNo = TextEditingController(text: widget.me['bizRegNo'] ?? '');
  late bool _hasBase = widget.me['baseLat'] != null;
  double? _baseLat, _baseLng;

  List<Json>? _types;
  String? _typeCode;
  final _plate = TextEditingController();
  final _spec = <String, TextEditingController>{};
  final _towClasses = <String>{'CAR', 'SUV'};
  bool _busy = false;

  late List<Json> _equipment = [for (final e in (widget.me['equipment'] as List? ?? const [])) Json.from(e as Map)];

  @override
  void initState() {
    super.initState();
    Api.instance.equipmentTypes().then((t) => setState(() => _types = t));
  }

  Json? get _type => _types?.where((t) => t['code'] == _typeCode).firstOrNull;

  Future<void> _useHereAsBase() async {
    final p = await currentLocation();
    setState(() { _baseLat = p.latitude; _baseLng = p.longitude; _hasBase = true; });
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await Api.instance.updateProfile({
        if (_company.text.trim().isNotEmpty) 'companyName': _company.text.trim(),
        if (_bizNo.text.trim().isNotEmpty) 'bizRegNo': _bizNo.text.trim(),
        if (_baseLat != null) 'baseLat': _baseLat,
        if (_baseLng != null) 'baseLng': _baseLng,
      });
      if (_typeCode != null) {
        final e = await Api.instance.addEquipment({
          'typeCode': _typeCode,
          if (_plate.text.trim().isNotEmpty) 'plateNo': _plate.text.trim(),
          'spec': {
            for (final s in _spec.entries)
              if (num.tryParse(s.value.text) != null) s.key: num.parse(s.value.text),
          },
          if (_typeCode == 'TOW') 'towClasses': _towClasses.toList(),
        });
        setState(() {
          _equipment = [..._equipment, e];
          _typeCode = null;
          _plate.clear();
          _spec.clear();
        });
      }
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('저장했어요')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('내 정보·장비')),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 120), children: [
        const _Title('업체 정보'),
        TextField(controller: _company, decoration: const InputDecoration(labelText: '업체명 (개인이면 이름)')),
        const SizedBox(height: 10),
        TextField(controller: _bizNo, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: '사업자등록번호')),
        const SizedBox(height: 10),
        Card(
          child: ListTile(
            leading: const Icon(Icons.garage_outlined),
            title: const Text('차고지 위치'),
            subtitle: Text(_hasBase ? '등록됨 · 예약 호출을 이 위치 기준으로 받아요' : '등록하면 퇴근 중에도 예약 호출을 받을 수 있어요'),
            trailing: TextButton(onPressed: _useHereAsBase, child: Text(_hasBase ? '다시 지정' : '지금 위치로')),
          ),
        ),
        const SizedBox(height: 24),
        const _Title('등록한 장비'),
        if (_equipment.isEmpty) const Text('아직 없어요', style: TextStyle(color: Colors.black54)),
        for (final e in _equipment)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Card(
              child: ListTile(
                leading: Icon(equipmentIcon(e['typeCode'])),
                title: Text(_types?.where((t) => t['code'] == e['typeCode']).firstOrNull?['name'] ?? e['typeCode']),
                subtitle: Text([
                  if (e['plateNo'] != null) e['plateNo'],
                  for (final s in Json.from(e['spec'] ?? {}).entries) '${specLabels[s.key]?.$1 ?? s.key} ${s.value}${specLabels[s.key]?.$2 ?? ''}',
                ].join(' · ')),
              ),
            ),
          ),
        const SizedBox(height: 16),
        const _Title('장비 추가'),
        if (_types == null)
          const Center(child: CircularProgressIndicator())
        else
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final t in _types!)
              ChoiceChip(
                avatar: Icon(equipmentIcon(t['code']), size: 18),
                label: Text(t['name']),
                selected: _typeCode == t['code'],
                selectedColor: brand,
                onSelected: (_) => setState(() {
                  _typeCode = t['code'];
                  _spec
                    ..clear()
                    ..addAll({for (final k in (t['specKeys'] as List)) k as String: TextEditingController()});
                }),
              ),
          ]),
        if (_type != null) ...[
          const SizedBox(height: 12),
          TextField(controller: _plate, decoration: const InputDecoration(labelText: '차량번호')),
          for (final s in _spec.entries) ...[
            const SizedBox(height: 10),
            TextField(
              controller: s.value,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
              decoration: InputDecoration(labelText: specLabels[s.key]?.$1 ?? s.key, suffixText: specLabels[s.key]?.$2),
            ),
          ],
          if (_typeCode == 'TOW') ...[
            const SizedBox(height: 12),
            const Text('견인 가능한 차종', style: TextStyle(fontWeight: FontWeight.w700)),
            Wrap(spacing: 8, children: [
              for (final c in vehicleClassLabels.entries)
                FilterChip(
                  label: Text(c.value),
                  selected: _towClasses.contains(c.key),
                  selectedColor: brand,
                  onSelected: (on) => setState(() => on ? _towClasses.add(c.key) : _towClasses.remove(c.key)),
                ),
            ]),
          ],
        ],
        const SizedBox(height: 24),
        const Card(
          color: Color(0xFFFFF4D6),
          child: Padding(
            padding: EdgeInsets.all(14),
            child: Text('운전면허증, 차량등록증, 사업자등록증, 보험증권은 운영팀이 따로 받아 확인해요. 앱 안 서류 제출은 곧 추가됩니다.'),
          ),
        ),
      ]),
      bottomSheet: Container(
        color: Colors.white,
        padding: const EdgeInsets.all(16),
        child: SafeArea(top: false, child: FilledButton(onPressed: _busy ? null : _save, child: Text(_typeCode == null ? '저장' : '장비 등록하고 저장'))),
      ),
    );
  }
}

class _Title extends StatelessWidget {
  const _Title(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Text(text, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: ink)),
      );
}
