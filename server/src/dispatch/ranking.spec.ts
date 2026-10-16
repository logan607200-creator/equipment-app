import { jobWindow, meetsSpec, rankCandidates } from './ranking';

const c = (id: string, etaSec: number, rating = 4.5, acceptanceRate = 0.5) =>
  ({ providerId: id, equipmentId: id, distanceKm: 1, etaSec, rating, acceptanceRate });

describe('rankCandidates', () => {
  it('ETA가 빠른 순', () => {
    expect(rankCandidates([c('a', 900), c('b', 300), c('c', 600)], 60).map((x) => x.providerId)).toEqual(['b', 'c', 'a']);
  });

  it('ETA가 비슷하면 평점, 그다음 수락률', () => {
    const r = rankCandidates([c('a', 305, 4.0), c('b', 310, 4.9), c('c', 300, 4.9, 0.9)], 60);
    expect(r.map((x) => x.providerId)).toEqual(['c', 'b', 'a']);
  });
});

describe('meetsSpec', () => {
  it('필요 규격 이상만 통과', () => {
    expect(meetsSpec({ tonnage: 25 }, { tonnage: 25 })).toBe(true);
    expect(meetsSpec({ tonnage: 10 }, { tonnage: 25 })).toBe(false);
    expect(meetsSpec({}, { heightM: 30 })).toBe(false);
    expect(meetsSpec({ heightM: 30 }, {})).toBe(true);
  });
});

describe('jobWindow', () => {
  it('일 대여는 9시간, 반일은 4시간 단위', () => {
    const at = new Date('2026-10-20T00:00:00Z');
    const day = jobWindow({ scheduledAt: at, typeCode: 'CRANE', options: { durationUnit: 'DAY', durationQty: 2 } });
    expect(day.end - day.start).toBe(18 * 3600_000);
    const half = jobWindow({ scheduledAt: at, typeCode: 'CRANE', options: { durationUnit: 'HALF_DAY' } });
    expect(half.end - half.start).toBe(4 * 3600_000);
  });
});
