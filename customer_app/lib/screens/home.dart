import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import '../api.dart';
import '../location.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/map_view.dart';
import 'history.dart';
import 'login.dart';
import 'request.dart';
import 'tracking.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<EquipmentType>? _types;
  Job? _active;
  LatLng _here = fallbackLocation;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
    currentLocation().then((p) { if (mounted) setState(() => _here = p); });
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([Api.instance.equipmentTypes(), Api.instance.myJobs()]);
      if (!mounted) return;
      setState(() {
        _types = results[0] as List<EquipmentType>;
        _active = (results[1] as List<Job>).where((j) => j.isActive).firstOrNull;
        _error = null;
      });
    } on ApiException catch (e) {
      if (e.status == 401) return _logout();
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = '서버에 연결할 수 없어요');
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
    return Scaffold(
      appBar: AppBar(
        title: const Text('장비 호출', style: TextStyle(fontWeight: FontWeight.w800)),
        actions: [
          IconButton(tooltip: '이용 내역', icon: const Icon(Icons.receipt_long_outlined), onPressed: () => _open(const HistoryScreen())),
          PopupMenuButton<String>(
            onSelected: (_) => _logout(),
            itemBuilder: (_) => const [PopupMenuItem(value: 'logout', child: Text('로그아웃'))],
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_active != null) ...[_ActiveBanner(job: _active!, onTap: () => _open(TrackingScreen(jobId: _active!.id))), const SizedBox(height: 16)],
            ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: SizedBox(
                height: 160,
                child: MapView(center: _here, pins: [MapPin(_here, Icons.my_location, color: const Color(0xFF2F6FED), label: '내 위치')]),
              ),
            ),
            const SizedBox(height: 24),
            const Text('어떤 장비가 필요하세요?', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: ink)),
            const SizedBox(height: 12),
            if (_error != null)
              Card(child: ListTile(leading: const Icon(Icons.wifi_off), title: Text(_error!), trailing: TextButton(onPressed: _load, child: const Text('다시 시도'))))
            else if (_types == null)
              const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
            else
              GridView.count(
                crossAxisCount: 4,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 10,
                crossAxisSpacing: 10,
                childAspectRatio: 0.82,
                children: [for (final t in _types!) _TypeTile(type: t, onTap: () => _open(RequestScreen(type: t, origin: _here)))],
              ),
            const SizedBox(height: 24),
            Card(
              child: ListTile(
                leading: const Icon(Icons.health_and_safety_outlined, color: Color(0xFFD64545)),
                title: const Text('사고가 났나요?', style: TextStyle(fontWeight: FontWeight.w700)),
                subtitle: const Text('다친 사람이 있으면 먼저 119에 신고하세요.\n고속도로에서는 가드레일 밖으로 대피하세요.'),
                isThreeLine: true,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TypeTile extends StatelessWidget {
  const _TypeTile({required this.type, required this.onTap});
  final EquipmentType type;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Ink(
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE6E4DF))),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Container(
              width: 44, height: 44,
              decoration: BoxDecoration(color: brand.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(12)),
              child: Icon(type.icon, color: ink),
            ),
            const SizedBox(height: 8),
            Text(type.name, style: const TextStyle(fontWeight: FontWeight.w700, color: ink)),
          ]),
        ),
      ),
    );
  }
}

class _ActiveBanner extends StatelessWidget {
  const _ActiveBanner({required this.job, required this.onTap});
  final Job job;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: ink,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(children: [
            const Icon(Icons.radar, color: brand),
            const SizedBox(width: 12),
            Expanded(
              child: Text('진행 중인 호출 · ${statusLabels[job.status]}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
            ),
            const Icon(Icons.chevron_right, color: Colors.white),
          ]),
        ),
      ),
    );
  }
}
