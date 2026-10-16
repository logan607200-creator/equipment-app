import { BadRequestException } from '@nestjs/common';
import type { EquipmentType } from '../entities';
import { haversineKm, LatLng, ROAD_FACTOR } from '../common/geo';

export type TowServiceKind = 'TOW' | 'BATTERY' | 'TIRE' | 'LOCKOUT';
export type VehicleClass = 'CAR' | 'SUV' | 'TRUCK_1T';
export type DurationUnit = 'HOUR' | 'HALF_DAY' | 'DAY';

export interface FareInput {
  pickup: LatLng;
  destination?: LatLng | null;
  /** 작업 시작 시각 (예약이면 예약 시각) */
  at: Date;
  options: {
    serviceKind?: TowServiceKind;
    vehicleClass?: VehicleClass;
    highway?: boolean;
    durationUnit?: DurationUnit;
    durationQty?: number;
  };
}

export interface FareLine {
  label: string;
  amount: number;
}

export interface FareEstimate {
  pricingModel: EquipmentType['pricingModel'];
  amount: number;
  min: number;
  max: number;
  lines: FareLine[];
  distanceKm?: number;
}

const round100 = (n: number) => Math.round(n / 100) * 100;

/** 한국 시간 기준 야간(22~06시)·주말 여부. 공휴일은 2단계에서 달력 연동. */
export function kstFlags(at: Date) {
  const kst = new Date(at.getTime() + 9 * 3600_000);
  const h = kst.getUTCHours();
  const d = kst.getUTCDay();
  return { night: h >= 22 || h < 6, holiday: d === 0 || d === 6 };
}

export function estimateFare(type: EquipmentType, input: FareInput): FareEstimate {
  const r = type.rates;
  const lines: FareLine[] = [];
  let distanceKm: number | undefined;

  if (type.pricingModel === 'DISTANCE') {
    const kind = input.options.serviceKind ?? 'TOW';
    if (kind === 'TOW') {
      const cls = input.options.vehicleClass ?? 'CAR';
      const base = r.base?.[cls];
      if (base === undefined) throw new BadRequestException(`지원하지 않는 차종입니다: ${cls}`);
      if (!input.destination) throw new BadRequestException('견인은 목적지가 필요합니다');
      distanceKm = Math.round(haversineKm(input.pickup, input.destination) * ROAD_FACTOR * 10) / 10;
      lines.push({ label: `기본료 (${r.includedKm}km 포함)`, amount: base });
      const extraKm = Math.max(0, distanceKm - r.includedKm);
      if (extraKm > 0) lines.push({ label: `거리 요금 ${extraKm.toFixed(1)}km`, amount: round100(extraKm * r.perKm) });
    } else {
      const flat = r.emergency?.[kind];
      if (flat === undefined) throw new BadRequestException(`지원하지 않는 출동 유형입니다: ${kind}`);
      lines.push({ label: '긴급출동', amount: flat });
    }
  } else {
    const unit = input.options.durationUnit ?? 'HOUR';
    const qty = Math.max(1, Math.floor(input.options.durationQty ?? 1));
    if (unit === 'HOUR') {
      const hours = Math.max(qty, r.minHours ?? 1);
      lines.push({ label: `시간 대여 ${hours}시간${hours > qty ? ' (최소 시간)' : ''}`, amount: r.hourly * hours });
    } else if (unit === 'HALF_DAY') {
      lines.push({ label: `반일 대여 ×${qty}`, amount: r.halfDay * qty });
    } else if (unit === 'DAY') {
      lines.push({ label: `일 대여 ×${qty}`, amount: r.day * qty });
    } else {
      throw new BadRequestException(`지원하지 않는 대여 단위입니다: ${unit}`);
    }
  }

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const flags = kstFlags(input.at);
  const s = r.surcharge ?? {};
  if (flags.night && s.night) lines.push({ label: `야간 할증 ${s.night * 100}%`, amount: round100(subtotal * s.night) });
  if (flags.holiday && s.holiday) lines.push({ label: `주말 할증 ${s.holiday * 100}%`, amount: round100(subtotal * s.holiday) });
  if (input.options.highway && s.highway) lines.push({ label: `고속도로 할증 ${s.highway * 100}%`, amount: round100(subtotal * s.highway) });

  const amount = lines.reduce((sum, l) => sum + l.amount, 0);
  const pct = r.rangePct ?? 0;
  return {
    pricingModel: type.pricingModel,
    amount,
    min: round100(amount * (1 - pct)),
    max: round100(amount * (1 + pct)),
    lines,
    distanceKm,
  };
}
