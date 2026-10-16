import { Injectable } from '@nestjs/common';
import { RedisService } from '../common/redis';

export interface GeoHit {
  providerId: string;
  distanceKm: number;
}

/**
 * Redis GEO 인덱스.
 *  live:{장비}  지금 출근해 있고 일이 없는 이용자 (즉시 호출용)
 *  base:{장비}  이용자 차고지 (예약 호출용)
 *  loc:{이용자} 마지막 위치와 시각
 */
@Injectable()
export class GeoIndex {
  constructor(private readonly redis: RedisService) {}

  private k(...p: string[]) {
    return this.redis.key(...p);
  }

  async saveLocation(providerId: string, lat: number, lng: number, heading?: number) {
    await this.redis.client.hset(this.k('loc', providerId), { lat, lng, heading: heading ?? '', ts: Date.now() });
  }

  async getLocation(providerId: string) {
    const h = await this.redis.client.hgetall(this.k('loc', providerId));
    if (!h.lat) return null;
    return { lat: Number(h.lat), lng: Number(h.lng), heading: h.heading ? Number(h.heading) : null, ts: Number(h.ts) };
  }

  async addLive(typeCode: string, providerId: string, lat: number, lng: number) {
    await this.redis.client.geoadd(this.k('live', typeCode), lng, lat, providerId);
  }

  async removeLive(typeCode: string, providerId: string) {
    await this.redis.client.zrem(this.k('live', typeCode), providerId);
  }

  async setBase(typeCodes: string[], providerId: string, lat: number, lng: number) {
    for (const t of typeCodes) await this.redis.client.geoadd(this.k('base', t), lng, lat, providerId);
  }

  async search(set: 'live' | 'base', typeCode: string, lat: number, lng: number, radiusKm: number, count = 30): Promise<GeoHit[]> {
    const res = (await this.redis.client.call(
      'GEOSEARCH', this.k(set, typeCode), 'FROMLONLAT', lng, lat, 'BYRADIUS', radiusKm, 'km', 'ASC', 'COUNT', count, 'WITHDIST',
    )) as Array<[string, string]>;
    return res.map(([providerId, d]) => ({ providerId, distanceKm: Number(d) }));
  }
}
