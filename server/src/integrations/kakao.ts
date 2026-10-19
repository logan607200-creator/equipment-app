import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { callJson } from './http';

export interface Place {
  name: string;
  address: string;
  roadAddress: string | null;
  lat: number;
  lng: number;
}

/**
 * 카카오 로컬(주소·장소 검색, 좌표 → 주소)과 카카오모빌리티 길찾기.
 * https://developers.kakao.com/docs/latest/ko/local/dev-guide
 * https://developers.kakaomobility.com/docs/navi-api/directions/
 */
@Injectable()
export class KakaoService {
  private readonly log = new Logger('Kakao');
  constructor(private readonly config: ConfigService) {}

  private get cfg() {
    return this.config.get<{ restKey?: string; localBaseUrl: string; mobilityBaseUrl: string; routeCandidates: number }>('kakao')!;
  }

  get enabled() {
    return !!this.cfg.restKey;
  }

  get routeCandidates() {
    return this.cfg.routeCandidates;
  }

  private get headers() {
    return { Authorization: `KakaoAK ${this.cfg.restKey}` };
  }

  /** 주소로 먼저 찾고, 없으면 장소 이름(키워드)으로 찾는다. */
  async search(query: string, near?: { lat: number; lng: number }): Promise<Place[]> {
    const q = encodeURIComponent(query);
    const addr = await callJson('kakao', `${this.cfg.localBaseUrl}/v2/local/search/address.json?query=${q}&size=10`, { headers: this.headers });
    const fromAddr: Place[] = (addr.documents ?? []).map((d: any) => ({
      name: d.road_address?.building_name || d.address_name,
      address: d.address?.address_name ?? d.address_name,
      roadAddress: d.road_address?.address_name ?? null,
      lat: Number(d.y), lng: Number(d.x),
    }));
    if (fromAddr.length) return fromAddr;
    const nearQs = near ? `&x=${near.lng}&y=${near.lat}&sort=distance` : '';
    const kw = await callJson('kakao', `${this.cfg.localBaseUrl}/v2/local/search/keyword.json?query=${q}&size=10${nearQs}`, { headers: this.headers });
    return (kw.documents ?? []).map((d: any) => ({
      name: d.place_name, address: d.address_name, roadAddress: d.road_address_name || null, lat: Number(d.y), lng: Number(d.x),
    }));
  }

  async reverse(lat: number, lng: number): Promise<{ address: string; roadAddress: string | null } | null> {
    const res = await callJson('kakao', `${this.cfg.localBaseUrl}/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`, { headers: this.headers });
    const d = res.documents?.[0];
    if (!d) return null;
    return { address: d.address?.address_name ?? '', roadAddress: d.road_address?.address_name ?? null };
  }

  /** 실제 도로 기준 소요 시간(초)과 거리(m). 경로를 못 찾으면 null. */
  async route(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<{ durationSec: number; distanceM: number } | null> {
    const url = `${this.cfg.mobilityBaseUrl}/v1/directions?origin=${from.lng},${from.lat}&destination=${to.lng},${to.lat}&priority=TIME&summary=true`;
    const res = await callJson('kakao-mobility', url, { headers: this.headers, timeoutMs: 3000 });
    const r = res.routes?.[0];
    if (!r || r.result_code !== 0) return null;
    return { durationSec: r.summary.duration, distanceM: r.summary.distance };
  }
}
