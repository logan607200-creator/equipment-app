export const won = (n: number | null | undefined) => (n == null ? '-' : `${n.toLocaleString('ko-KR')}원`);

export const STATUS: Record<string, string> = {
  REQUESTED: '배차 중',
  MATCHED: '배정됨',
  EN_ROUTE: '이동 중',
  ARRIVED: '도착',
  IN_PROGRESS: '작업 중',
  COMPLETED: '완료',
  CANCELLED: '취소',
};

export const TYPE: Record<string, string> = {
  TOW: '렉카', FORKLIFT: '지게차', DUMP: '덤프', EXCAVATOR: '포크레인',
  CRANE: '크레인', RENTAL: '렌탈', LADDER: '사다리차', SKY: '스카이',
};

const SPEC: Record<string, [string, string]> = { tonnage: ['톤수', '톤'], heightM: ['높이', 'm'] };
export const specText = (s: Record<string, number>, suffix = '') =>
  Object.entries(s).map(([k, v]) => `${v}${SPEC[k]?.[1] ?? ''}${suffix}`).join(' ');
export const specLabel = (k: string) => SPEC[k]?.[0] ?? k;

const KIND: Record<string, string> = { TOW: '견인', BATTERY: '배터리', TIRE: '타이어', LOCKOUT: '잠금 해제' };
const CLS: Record<string, string> = { CAR: '승용', SUV: 'SUV', TRUCK_1T: '1톤' };
const UNIT: Record<string, string> = { HOUR: '시간', HALF_DAY: '반나절', DAY: '일' };

/** 호출 내용 한 줄 요약 */
export function jobSummary(j: { typeCode: string; options: Record<string, any>; requiredSpec: Record<string, number> }) {
  const o = j.options ?? {};
  const parts =
    j.typeCode === 'TOW'
      ? [KIND[o.serviceKind] ?? '견인', CLS[o.vehicleClass], o.highway ? '고속도로' : null]
      : [o.durationUnit === 'HOUR' ? `${o.durationQty ?? 1}시간` : `${UNIT[o.durationUnit] ?? ''} ×${o.durationQty ?? 1}`];
  const spec = specText(j.requiredSpec ?? {}, ' 이상');
  return [...parts, spec || null].filter(Boolean).join(' · ');
}

export function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const duration = (sec: number | null) => (sec == null ? '-' : sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${sec % 60}초`);

export const phone = (p: string | null | undefined) =>
  !p ? '-' : p.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
