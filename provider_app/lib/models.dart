import 'package:flutter/material.dart';

IconData equipmentIcon(String code) => switch (code) {
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

const specLabels = {'tonnage': ('톤수', '톤'), 'heightM': ('작업 높이', 'm')};

const statusLabels = {
  'REQUESTED': '배정 대기',
  'MATCHED': '배정됨',
  'EN_ROUTE': '이동 중',
  'ARRIVED': '현장 도착',
  'IN_PROGRESS': '작업 중',
  'COMPLETED': '완료',
  'CANCELLED': '취소됨',
};

const activeStatuses = ['MATCHED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];

/// 다음 단계 버튼 문구
const nextAction = {
  'MATCHED': ('EN_ROUTE', '출발했어요'),
  'EN_ROUTE': ('ARRIVED', '현장에 도착했어요'),
  'ARRIVED': ('IN_PROGRESS', '작업 시작'),
  'IN_PROGRESS': ('COMPLETED', '작업 완료'),
};

const serviceKindLabels = {'TOW': '견인', 'BATTERY': '배터리 방전', 'TIRE': '타이어 펑크', 'LOCKOUT': '문 잠김'};
const vehicleClassLabels = {'CAR': '승용', 'SUV': 'SUV', 'TRUCK_1T': '1톤 이하 화물'};
const unitLabels = {'HOUR': '시간', 'HALF_DAY': '반나절', 'DAY': '일'};

/// 호출 내용을 한 줄로 (예: "견인 · SUV", "반나절 ×1 · 25톤 이상")
String jobSummary(Map<String, dynamic> j) {
  final o = Map<String, dynamic>.from(j['options'] ?? {});
  final spec = Map<String, dynamic>.from(j['requiredSpec'] ?? {});
  final parts = <String>[
    if (j['typeCode'] == 'TOW') ...[
      serviceKindLabels[o['serviceKind']] ?? '견인',
      if (o['vehicleClass'] != null) vehicleClassLabels[o['vehicleClass']] ?? o['vehicleClass'],
      if (o['highway'] == true) '고속도로',
    ] else ...[
      if (o['durationUnit'] == 'HOUR') '${o['durationQty'] ?? 1}시간' else '${unitLabels[o['durationUnit']] ?? ''} ×${o['durationQty'] ?? 1}',
    ],
    for (final e in spec.entries) '${e.value}${specLabels[e.key]?.$2 ?? ''} 이상',
  ];
  return parts.join(' · ');
}
