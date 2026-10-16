import 'package:flutter_test/flutter_test.dart';
import 'package:provider_app/models.dart';

void main() {
  test('호출 요약 문구', () {
    expect(jobSummary({'typeCode': 'TOW', 'options': {'serviceKind': 'TOW', 'vehicleClass': 'SUV', 'highway': true}}), '견인 · SUV · 고속도로');
    expect(jobSummary({'typeCode': 'CRANE', 'options': {'durationUnit': 'HALF_DAY', 'durationQty': 1}, 'requiredSpec': {'tonnage': 25}}), '반나절 ×1 · 25톤 이상');
    expect(jobSummary({'typeCode': 'LADDER', 'options': {'durationUnit': 'HOUR', 'durationQty': 3}}), '3시간');
  });
}
