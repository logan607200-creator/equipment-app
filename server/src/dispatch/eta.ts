import { Injectable } from '@nestjs/common';
import { ROAD_FACTOR } from '../common/geo';

/**
 * 도착 예상 시간. 지금은 직선 거리 × 도로 계수 ÷ 평균 속도로 어림한다.
 * 실제 서비스 전에는 T맵·카카오모빌리티 경로 API로 바꿔야 한다 (고속도로 진행 방향 반영).
 */
@Injectable()
export class EtaService {
  private readonly avgKmh = 35;
  private readonly prepSec = 60;

  estimateSec(straightKm: number): number {
    return Math.round(((straightKm * ROAD_FACTOR) / this.avgKmh) * 3600 + this.prepSec);
  }
}
