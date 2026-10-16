import 'package:flutter/material.dart';

class EquipmentType {
  EquipmentType({required this.code, required this.name, required this.pricingModel, required this.specKeys});
  final String code;
  final String name;
  final String pricingModel;
  final List<String> specKeys;

  bool get isTow => code == 'TOW';

  factory EquipmentType.fromJson(Map<String, dynamic> j) => EquipmentType(
        code: j['code'],
        name: j['name'],
        pricingModel: j['pricingModel'],
        specKeys: List<String>.from(j['specKeys'] ?? const []),
      );

  IconData get icon => switch (code) {
        'TOW' => Icons.car_crash_outlined,
        'FORKLIFT' => Icons.forklift,
        'DUMP' => Icons.local_shipping_outlined,
        'EXCAVATOR' => Icons.construction,
        'CRANE' => Icons.precision_manufacturing_outlined,
        'RENTAL' => Icons.handyman_outlined,
        'LADDER' => Icons.stairs_outlined,
        'SKY' => Icons.height,
        _ => Icons.build_outlined,
      };
}

/// 규격 항목 이름과 단위
const specLabels = {'tonnage': ('톤수', '톤'), 'heightM': ('작업 높이', 'm')};

class FareLine {
  FareLine(this.label, this.amount);
  final String label;
  final int amount;
}

class Estimate {
  Estimate({required this.amount, required this.min, required this.max, required this.lines, this.distanceKm});
  final int amount;
  final int min;
  final int max;
  final List<FareLine> lines;
  final double? distanceKm;

  factory Estimate.fromJson(Map<String, dynamic> j) => Estimate(
        amount: j['amount'],
        min: j['min'],
        max: j['max'],
        distanceKm: (j['distanceKm'] as num?)?.toDouble(),
        lines: [for (final l in (j['lines'] as List)) FareLine(l['label'], l['amount'])],
      );
}

class Adjustment {
  Adjustment({required this.id, required this.amount, required this.reason, required this.status});
  final String id;
  final int amount;
  final String reason;
  final String status;
  factory Adjustment.fromJson(Map<String, dynamic> j) =>
      Adjustment(id: j['id'], amount: j['amount'], reason: j['reason'], status: j['status']);
}

class Job {
  Job(this.raw);
  final Map<String, dynamic> raw;

  String get id => raw['id'];
  String get typeCode => raw['typeCode'];
  String get status => raw['status'];
  bool get unassignedAlert => raw['unassignedAlert'] == true;
  double get lat => (raw['lat'] as num).toDouble();
  double get lng => (raw['lng'] as num).toDouble();
  String? get address => raw['address'];
  String? get destAddress => raw['destAddress'];
  DateTime? get scheduledAt => raw['scheduledAt'] == null ? null : DateTime.parse(raw['scheduledAt']).toLocal();
  DateTime get createdAt => DateTime.parse(raw['createdAt']).toLocal();
  Estimate get estimate => Estimate.fromJson(Map<String, dynamic>.from(raw['estimate']));
  int? get finalFare => raw['finalFare'];
  int get cancelFee => raw['cancelFee'] ?? 0;
  String? get safetyNotice => raw['safetyNotice'];
  Map<String, dynamic>? get provider => raw['provider'];
  Map<String, dynamic>? get equipment => raw['equipment'];
  Map<String, dynamic>? get providerLocation => raw['providerLocation'];
  List<Adjustment> get adjustments =>
      [for (final a in (raw['adjustments'] as List? ?? const [])) Adjustment.fromJson(Map<String, dynamic>.from(a))];

  bool get isActive => !['COMPLETED', 'CANCELLED'].contains(status);

  factory Job.fromJson(dynamic j) => Job(Map<String, dynamic>.from(j as Map));

  Job merge(Map<String, dynamic> patch) => Job({...raw, ...patch});
}

const statusLabels = {
  'REQUESTED': '찾는 중',
  'MATCHED': '배정됨',
  'EN_ROUTE': '오는 중',
  'ARRIVED': '도착',
  'IN_PROGRESS': '작업 중',
  'COMPLETED': '완료',
  'CANCELLED': '취소됨',
};
