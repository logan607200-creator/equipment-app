import { estimateFare, kstFlags } from './fare';
import { EQUIPMENT_SEED } from './seed';

const type = (code: string) => ({ ...EQUIPMENT_SEED.find((t) => t.code === code)!, active: true });
// 2026-10-14(수) 14:00 KST = 05:00 UTC, 평일 낮
const weekdayNoon = new Date('2026-10-14T05:00:00Z');
const seoul = { lat: 37.5665, lng: 126.978 };

describe('estimateFare', () => {
  it('렉카 견인: 기본료 + 초과 거리', () => {
    const dest = { lat: 37.5665, lng: 127.1 }; // 약 10.7km 직선
    const e = estimateFare(type('TOW'), { pickup: seoul, destination: dest, at: weekdayNoon, options: { vehicleClass: 'SUV' } });
    expect(e.lines[0]).toEqual({ label: '기본료 (10km 포함)', amount: 90000 });
    expect(e.distanceKm).toBeGreaterThan(14);
    expect(e.amount).toBeGreaterThan(90000);
    expect(e.min).toBeLessThan(e.amount);
    expect(e.max).toBeGreaterThan(e.amount);
  });

  it('렉카 긴급출동은 정액이고 목적지가 필요 없다', () => {
    const e = estimateFare(type('TOW'), { pickup: seoul, at: weekdayNoon, options: { serviceKind: 'BATTERY' } });
    expect(e.amount).toBe(40000);
  });

  it('렉카 견인은 목적지가 없으면 거절', () => {
    expect(() => estimateFare(type('TOW'), { pickup: seoul, at: weekdayNoon, options: {} })).toThrow('목적지');
  });

  it('크레인 시간 대여는 최소 시간을 적용', () => {
    const e = estimateFare(type('CRANE'), { pickup: seoul, at: weekdayNoon, options: { durationUnit: 'HOUR', durationQty: 1 } });
    expect(e.amount).toBe(300000);
    expect(e.lines[0].label).toContain('최소 시간');
  });

  it('포크레인 일 대여 2일', () => {
    const e = estimateFare(type('EXCAVATOR'), { pickup: seoul, at: weekdayNoon, options: { durationUnit: 'DAY', durationQty: 2 } });
    expect(e.amount).toBe(1_200_000);
  });

  it('야간·주말 할증', () => {
    // 2026-10-17(토) 23:00 KST
    const satNight = new Date('2026-10-17T14:00:00Z');
    expect(kstFlags(satNight)).toEqual({ night: true, holiday: true });
    const e = estimateFare(type('SKY'), { pickup: seoul, at: satNight, options: { durationUnit: 'HALF_DAY' } });
    expect(e.amount).toBe(300000 + 60000 + 30000);
  });
});
