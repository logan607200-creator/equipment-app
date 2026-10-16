export interface Candidate {
  providerId: string;
  equipmentId: string;
  distanceKm: number;
  etaSec: number;
  rating: number;
  acceptanceRate: number;
}

/** ETA가 빠른 순. ETA 차이가 tieSec 안이면 평점, 수락률이 높은 이용자를 앞에 둔다. */
export function rankCandidates(cands: Candidate[], tieSec: number): Candidate[] {
  const bucket = (c: Candidate) => Math.floor(c.etaSec / Math.max(1, tieSec));
  return [...cands].sort(
    (a, b) => bucket(a) - bucket(b) || b.rating - a.rating || b.acceptanceRate - a.acceptanceRate || a.etaSec - b.etaSec,
  );
}

/** 작업이 차지하는 시간대 (예약 겹침 확인용) */
export function jobWindow(job: { scheduledAt: Date | null; options: Record<string, any>; typeCode: string }) {
  const start = (job.scheduledAt ?? new Date()).getTime();
  const qty = Math.max(1, Number(job.options.durationQty ?? 1));
  const hours =
    job.typeCode === 'TOW' ? 2
    : job.options.durationUnit === 'DAY' ? 9 * qty
    : job.options.durationUnit === 'HALF_DAY' ? 4 * qty
    : qty;
  return { start, end: start + hours * 3600_000 };
}

export function meetsSpec(spec: Record<string, number>, required: Record<string, number>) {
  return Object.entries(required).every(([k, v]) => (spec[k] ?? -Infinity) >= v);
}
