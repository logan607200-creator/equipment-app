import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import 'tracking.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});
  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  List<Job>? _jobs;
  Map<String, String> _names = {};

  @override
  void initState() {
    super.initState();
    Future.wait([Api.instance.myJobs(), Api.instance.equipmentTypes()]).then((r) {
      if (!mounted) return;
      setState(() {
        _jobs = r[0] as List<Job>;
        _names = {for (final t in r[1] as List<EquipmentType>) t.code: t.name};
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final jobs = _jobs;
    return Scaffold(
      appBar: AppBar(title: const Text('이용 내역')),
      body: jobs == null
          ? const Center(child: CircularProgressIndicator())
          : jobs.isEmpty
              ? const Center(child: Text('아직 이용 내역이 없어요'))
              : ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: jobs.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (_, i) {
                    final j = jobs[i];
                    final amount = j.finalFare ?? (j.status == 'CANCELLED' ? j.cancelFee : j.estimate.amount);
                    return Card(
                      child: ListTile(
                        title: Text('${_names[j.typeCode] ?? j.typeCode} · ${statusLabels[j.status]}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text(dateTime(j.scheduledAt ?? j.createdAt)),
                        trailing: Text(won(amount), style: const TextStyle(fontWeight: FontWeight.w700)),
                        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => TrackingScreen(jobId: j.id))),
                      ),
                    );
                  },
                ),
    );
  }
}
