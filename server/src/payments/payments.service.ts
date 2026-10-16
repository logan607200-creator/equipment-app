import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { Job, Payment } from '../entities';

/**
 * 결제. 지금은 PG 연동 없이 승인된 것으로 기록만 한다.
 * TODO: 토스페이먼츠·나이스페이 등 PG의 빌링키 자동결제로 교체 (직접 전자금융업 등록은 피한다).
 */
@Injectable()
export class PaymentsService {
  constructor(@InjectRepository(Payment) private readonly payments: Repository<Payment>, private readonly config: ConfigService) {}

  async capture(job: Job, amount: number) {
    const existing = await this.payments.findOneBy({ jobId: job.id });
    if (existing) return existing;
    const commission = Math.round(amount * this.config.get<number>('commissionRate')!);
    return this.payments.save(this.payments.create({
      jobId: job.id, providerId: job.providerId!, amount, commission, providerPayout: amount - commission,
      status: 'CAPTURED', pgTxId: `mock_${randomUUID()}`,
    }));
  }
}
