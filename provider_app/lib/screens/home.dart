import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../location.dart';
import '../models.dart';
import '../theme.dart';
import 'earnings.dart';
import 'job.dart';
import 'login.dart';
import 'offer.dart';
import 'setup.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Json? _me;
  Json? _activeJob;
  Json? _today;
  String? _selectedEquipment;
  String? _error;
  bool _busy = false;
  bool _offerOpen = false;
  Timer? _locationTimer;
  Timer? _offerPoll;
  StreamSubscription<SocketEvent>? _sub;

  bool get _online => _me?['online'] == true;
  List<Json> get _equipment => [for (final e in (_me?['equipment'] as List? ?? const [])) Json.from(e as Map)];

  @override
  void initState() {
    super.initState();
    _load();
    _sub = Api.instance.events.listen((e) {
      if (e.name == 'offer.created') _showOffer(e.data);
      if (e.name == 'job.updated') _load();
    });
    // 소켓이 끊겼을 때를 대비해 제안을 가끔 직접 확인한다.
    _offerPoll = Timer.periodic(const Duration(seconds: 4), (_) => _pollOffers());
  }

  @override
  void dispose() {
    _sub?.cancel();
    _locationTimer?.cancel();
    _offerPoll?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final me = await Api.instance.me();
      final jobs = await Api.instance.jobs();
      final now = DateTime.now();
      final today = await Api.instance.earnings(from: DateTime(now.year, now.month, now.day));
      if (!mounted) return;
      setState(() {
        _me = me;
        _today = today;
        _activeJob = jobs.where((j) => activeStatuses.contains(j['status'])).firstOrNull;
        _selectedEquipment ??= me['activeEquipmentId'] ?? _equipment.firstOrNull?['id'];
        _error = null;
      });
      _syncLocationTimer();
    } on ApiException catch (e) {
      if (e.status == 401) return _logout();
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = '서버에 연결할 수 없어요');
    }
  }

  void _syncLocationTimer() {
    if (_online && _locationTimer == null) {
      _sendLocation();
      _locationTimer = Timer.periodic(const Duration(seconds: 5), (_) => _sendLocation());
    } else if (!_online) {
      _locationTimer?.cancel();
      _locationTimer = null;
    }
  }

  Future<void> _sendLocation() async {
    final p = await currentLocation();
    try {
      await Api.instance.sendLocation(p.latitude, p.longitude);
    } catch (_) {}
  }

  Future<void> _pollOffers() async {
    if (!_online || _offerOpen) return;
    try {
      final offers = await Api.instance.offers();
      if (offers.isNotEmpty) _showOffer(offers.first);
    } catch (_) {}
  }

  Future<void> _showOffer(Json data) async {
    if (_offerOpen || !mounted) return;
    _offerOpen = true;
    // 소켓 이벤트는 offerId, 목록 조회는 id 로 온다.
    final offerId = (data['offerId'] ?? data['id']) as String;
    final jobId = data['jobId'] as String;
    final accepted = await Navigator.of(context).push<bool>(MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => OfferScreen(offerId: offerId, offer: data),
    ));
    _offerOpen = false;
    if (accepted == true && mounted) {
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => JobScreen(jobId: jobId)));
    }
    _load();
  }

  Future<void> _toggleOnline() async {
    setState(() => _busy = true);
    try {
      if (_online) {
        await Api.instance.offline();
      } else {
        final p = await currentLocation();
        await Api.instance.sendLocation(p.latitude, p.longitude);
        await Api.instance.online(_selectedEquipment!);
      }
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _logout() async {
    await Api.instance.logout();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const LoginScreen()));
  }

  Future<void> _open(Widget screen) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final me = _me;
    return Scaffold(
      appBar: AppBar(
        title: Text(me?['companyName'] ?? '장비 호출 파트너', style: const TextStyle(fontWeight: FontWeight.w800)),
        actions: [
          IconButton(tooltip: '정산', icon: const Icon(Icons.account_balance_wallet_outlined), onPressed: () => _open(const EarningsScreen())),
          PopupMenuButton<String>(
            onSelected: (v) => v == 'setup' ? _open(SetupScreen(me: me!)) : _logout(),
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'setup', child: Text('내 정보·장비')),
              PopupMenuItem(value: 'logout', child: Text('로그아웃')),
            ],
          ),
        ],
      ),
      body: me == null
          ? Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!))
          : RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(16), children: _body(me))),
    );
  }

  List<Widget> _body(Json me) {
    if (_equipment.isEmpty) {
      return [
        const SizedBox(height: 40),
        const Icon(Icons.precision_manufacturing_outlined, size: 64, color: ink),
        const SizedBox(height: 16),
        const Text('장비를 먼저 등록해 주세요', textAlign: TextAlign.center, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        const Text('업체 정보와 장비를 등록하면 운영팀이 확인한 뒤 호출을 받을 수 있어요.', textAlign: TextAlign.center, style: TextStyle(color: Colors.black54)),
        const SizedBox(height: 24),
        FilledButton(onPressed: () => _open(SetupScreen(me: me)), child: const Text('등록 시작')),
      ];
    }
    final verified = me['verified'] == true;
    return [
      if (!verified)
        Card(
          color: const Color(0xFFFFF4D6),
          child: const ListTile(
            leading: Icon(Icons.hourglass_top, color: ink),
            title: Text('운영팀이 서류를 확인하고 있어요', style: TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text('승인되면 출근해서 호출을 받을 수 있어요.'),
          ),
        ),
      if (_activeJob != null) ...[
        Material(
          color: ink,
          borderRadius: BorderRadius.circular(16),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () => _open(JobScreen(jobId: _activeJob!['id'])),
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Row(children: [
                Icon(equipmentIcon(_activeJob!['typeCode']), color: brand, size: 30),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('진행 중인 작업 · ${statusLabels[_activeJob!['status']]}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16)),
                    Text(_activeJob!['address'] ?? jobSummary(_activeJob!), style: const TextStyle(color: Colors.white70)),
                  ]),
                ),
                const Icon(Icons.chevron_right, color: Colors.white),
              ]),
            ),
          ),
        ),
      ],
      const SizedBox(height: 16),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('오늘 운행할 장비', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 8),
            RadioGroup<String>(
              groupValue: _selectedEquipment,
              onChanged: (v) { if (!_online) setState(() => _selectedEquipment = v); },
              child: Column(children: [
                for (final e in _equipment)
                  RadioListTile<String>(
                    contentPadding: EdgeInsets.zero,
                    value: e['id'],
                    enabled: !_online,
                    secondary: Icon(equipmentIcon(e['typeCode'])),
                    title: Text(_equipmentName(e)),
                    subtitle: Text(e['plateNo'] ?? ''),
                  ),
              ]),
            ),
          ]),
        ),
      ),
      const SizedBox(height: 16),
      _OnlineButton(online: _online, enabled: verified && !_busy && _selectedEquipment != null, onPressed: _toggleOnline),
      const SizedBox(height: 8),
      Text(
        _online ? '출근 중이에요. 가까운 호출이 오면 바로 알려드릴게요.' : '퇴근 상태에서는 즉시 호출을 받지 않아요. 예약 호출은 차고지 기준으로 받아요.',
        textAlign: TextAlign.center,
        style: const TextStyle(color: Colors.black54),
      ),
      const SizedBox(height: 20),
      if (_today != null)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(children: [
              _stat('오늘 완료', '${_today!['count']}건'),
              _stat('매출', won(_today!['gross'])),
              _stat('지급 예정', won(_today!['payout'])),
            ]),
          ),
        ),
      const SizedBox(height: 8),
      Text('평점 ★ ${(me['rating'] as num).toStringAsFixed(1)} · 수락률 ${((me['acceptanceRate'] as num) * 100).round()}%',
          textAlign: TextAlign.center, style: const TextStyle(color: Colors.black54)),
    ];
  }

  String _equipmentName(Json e) {
    final spec = Json.from(e['spec'] ?? {});
    final type = _typeNames[e['typeCode']] ?? e['typeCode'];
    final specText = spec.entries.map((s) => '${s.value}${specLabels[s.key]?.$2 ?? ''}').join(' ');
    return specText.isEmpty ? type : '$type $specText';
  }

  static const _typeNames = {
    'TOW': '렉카', 'FORKLIFT': '지게차', 'DUMP': '덤프', 'EXCAVATOR': '포크레인',
    'CRANE': '크레인', 'RENTAL': '렌탈', 'LADDER': '사다리차', 'SKY': '스카이',
  };

  Widget _stat(String label, String value) => Expanded(
        child: Column(children: [
          Text(label, style: const TextStyle(color: Colors.black54, fontSize: 13)),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
        ]),
      );
}

class _OnlineButton extends StatelessWidget {
  const _OnlineButton({required this.online, required this.enabled, required this.onPressed});
  final bool online;
  final bool enabled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 84,
      child: FilledButton.icon(
        style: FilledButton.styleFrom(
          backgroundColor: online ? ink : brand,
          foregroundColor: online ? Colors.white : ink,
          textStyle: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
        ),
        onPressed: enabled ? onPressed : null,
        icon: Icon(online ? Icons.power_settings_new : Icons.play_arrow_rounded, size: 32),
        label: Text(online ? '퇴근하기' : '출근하기'),
      ),
    );
  }
}
