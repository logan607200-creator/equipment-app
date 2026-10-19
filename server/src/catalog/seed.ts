import type { EquipmentType } from '../entities';

// 첫 실행 때 넣는 장비 목록. 금액은 구조를 보여주기 위한 가정값이며
// 운영 전에 관리자 API(PUT /admin/equipment-types/:code)로 실제 요금표를 넣어야 한다.
const time = (hourly: number, halfDay: number, day: number) => ({
  hourly, minHours: 2, halfDay, day,
  dispatch: { freeKm: 5, perKm: 2000 },
  surcharge: { night: 0.2, holiday: 0.1 },
  cancelFee: Math.round(hourly / 2),
});

export const EQUIPMENT_SEED: Array<Omit<EquipmentType, 'active'>> = [
  {
    code: 'TOW', name: '렉카', pricingModel: 'DISTANCE', specKeys: [], sortOrder: 1,
    rates: {
      base: { CAR: 80000, SUV: 90000, TRUCK_1T: 110000 },
      includedKm: 10, perKm: 2500,
      emergency: { BATTERY: 40000, TIRE: 50000, LOCKOUT: 40000 },
      surcharge: { night: 0.2, holiday: 0.1, highway: 0.1 },
      cancelFee: 30000, rangePct: 0.1,
    },
  },
  { code: 'FORKLIFT', name: '지게차', pricingModel: 'TIME', specKeys: ['tonnage'], sortOrder: 2, rates: time(60000, 200000, 350000) },
  { code: 'DUMP', name: '덤프', pricingModel: 'TIME', specKeys: ['tonnage'], sortOrder: 3, rates: time(90000, 300000, 550000) },
  { code: 'EXCAVATOR', name: '포크레인', pricingModel: 'TIME', specKeys: ['tonnage'], sortOrder: 4, rates: time(100000, 350000, 600000) },
  { code: 'CRANE', name: '크레인', pricingModel: 'TIME', specKeys: ['tonnage'], sortOrder: 5, rates: time(150000, 500000, 900000) },
  { code: 'RENTAL', name: '렌탈', pricingModel: 'TIME', specKeys: [], sortOrder: 6, rates: time(50000, 150000, 250000) },
  { code: 'LADDER', name: '사다리차', pricingModel: 'TIME', specKeys: ['heightM'], sortOrder: 7, rates: time(80000, 200000, 350000) },
  { code: 'SKY', name: '스카이', pricingModel: 'TIME', specKeys: ['heightM'], sortOrder: 8, rates: time(90000, 300000, 500000) },
];
