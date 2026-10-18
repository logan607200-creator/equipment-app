import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../common/redis';
import { ROAD_FACTOR } from '../common/geo';
import { KakaoService } from '../integrations/kakao';

type Point = { lat: number; lng: number };

/**
 * 도착 예상 시간.
 * 카카오 키가 있으면 가까운 후보 몇 명만 카카오모빌리티 길찾기로 실제 도로 시간을 구하고
 * (고속도로 진행 방향, 막힘 반영), 나머지와 실패한 경우는 직선 거리 × 도로 계수 ÷ 평균 속도로 어림한다.
 */
@Injectable()
export class EtaService {
  private readonly log = new Logger('Eta');
  private readonly avgKmh = 35;
  private readonly prepSec = 60;

  constructor(private readonly kakao: KakaoService, private readonly redis: RedisService) {}

  estimateSec(straightKm: number): number {
    return Math.round(((straightKm * ROAD_FACTOR) / this.avgKmh) * 3600 + this.prepSec);
  }

  get routeCandidates() {
    return this.kakao.enabled ? this.kakao.routeCandidates : 0;
  }

  /** 실제 도로 기준 ETA. 못 구하면 null (호출한 쪽이 어림값을 쓴다). 1분 동안 캐시한다. */
  async routeSec(cacheKey: string, from: Point, to: Point): Promise<number | null> {
    if (!this.kakao.enabled) return null;
    const key = this.redis.key('eta', cacheKey);
    const cached = await this.redis.client.get(key);
    if (cached) return Number(cached);
    try {
      const r = await this.kakao.route(from, to);
      if (!r) return null;
      const sec = r.durationSec + this.prepSec;
      await this.redis.client.set(key, String(sec), 'EX', 60);
      return sec;
    } catch (e) {
      this.log.warn(`route failed: ${(e as Error).message}`);
      return null;
    }
  }
}
