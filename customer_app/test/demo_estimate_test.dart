import 'package:customer_app/demo.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('견적과 호출 요금이 같고, 먼 기사는 출동 거리 요금이 붙는다', () async {
    final d = DemoBackend((_, _) {});
    final body = {'typeCode': 'CRANE', 'lat': 37.2664, 'lng': 127.0001, 'options': {'durationUnit': 'HOUR', 'durationQty': 2}};
    await d.handle('POST', '/payments/billing/demo-card', {'number': '4111222233334444', 'expiry': '12/29', 'birth': '900101', 'pin2': '12'});
    final e1 = await d.handle('POST', '/jobs/estimate', body);
    final e2 = await d.handle('POST', '/jobs/estimate', body);
    final job = await d.handle('POST', '/jobs', body);
    expect(e2['amount'], e1['amount']);
    expect(job['estimate']['amount'], e1['amount']);
    await d.handle('POST', '/jobs/${job['id']}/cancel', {});
  });
}
