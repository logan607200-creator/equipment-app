import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { RedisService } from '../common/redis';
import { Job, Payment, PaymentMethod } from '../entities';
import { ExternalApiError } from '../integrations/http';
import { TossClient } from '../integrations/toss';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const SESSION_TTL_SEC = 600;

/**
 * 결제. 토스페이먼츠 키가 있으면 등록된 카드(빌링키)로 자동결제하고,
 * 없으면 예전처럼 승인된 것으로 기록만 한다(개발·시연용).
 * 직접 카드 정보를 받지 않으므로 전자금융업 등록 없이 PG 가맹점으로 운영한다.
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger('Payments');

  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(PaymentMethod) private readonly methods: Repository<PaymentMethod>,
    @InjectRepository(Job) private readonly jobs: Repository<Job>,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly toss: TossClient,
    private readonly rt: RealtimeGateway,
  ) {}

  /** PG가 켜져 있으면 호출 전에 카드가 있어야 한다 */
  get cardRequired() {
    return this.toss.enabled;
  }

  activeMethod(accountId: string) {
    return this.methods.findOne({ where: { accountId, active: true }, order: { createdAt: 'DESC' } });
  }

  async listMethods(accountId: string) {
    const list = await this.methods.find({ where: { accountId, active: true }, order: { createdAt: 'DESC' } });
    return {
      pgEnabled: this.toss.enabled,
      cardRequired: this.cardRequired,
      methods: list.map((m) => ({ id: m.id, cardCompany: m.cardCompany, cardNumber: m.cardNumber, createdAt: m.createdAt })),
    };
  }

  async removeMethod(accountId: string, id: string) {
    const res = await this.methods.update({ id, accountId }, { active: false });
    if (!res.affected) throw new NotFoundException('등록된 카드가 아닙니다');
    return { ok: true };
  }

  // ── 카드 등록 (토스 결제창) ─────────────────────────────

  /** 앱이 열 카드 등록 페이지 주소. 10분 동안만 쓸 수 있다. */
  async startBillingSession(accountId: string) {
    const session = randomBytes(24).toString('base64url');
    const customerKey = `cus_${randomUUID()}`;
    await this.redis.client.set(this.redis.key('billing', session), JSON.stringify({ accountId, customerKey }), 'EX', SESSION_TTL_SEC);
    return { url: `${this.config.get('publicUrl')}/payments/billing/page?session=${session}`, expiresInSec: SESSION_TTL_SEC };
  }

  async readSession(session: string) {
    const raw = session ? await this.redis.client.get(this.redis.key('billing', session)) : null;
    if (!raw) throw new BadRequestException('카드 등록 시간이 지났어요. 앱에서 다시 시작해 주세요.');
    return JSON.parse(raw) as { accountId: string; customerKey: string };
  }

  billingPageParams(session: string, customerKey: string) {
    const base = this.config.get<string>('publicUrl');
    return {
      pgEnabled: this.toss.enabled,
      clientKey: this.toss.enabled ? this.toss.clientKey : null,
      customerKey,
      successUrl: `${base}/payments/billing/success?session=${session}`,
      failUrl: `${base}/payments/billing/fail?session=${session}`,
    };
  }

  /** 결제창이 돌려준 authKey로 빌링키를 받아 저장한다. PG가 꺼져 있으면 시연용 카드를 등록한다. */
  async completeBilling(session: string, authKey: string, customerKey: string) {
    const s = await this.readSession(session);
    if (s.customerKey !== customerKey) throw new ForbiddenException('카드 등록 정보가 맞지 않아요');
    let billingKey: string;
    let cardCompany: string | null = null;
    let cardNumber: string | null = null;
    if (this.toss.enabled) {
      const res = await this.toss.issueBillingKey(authKey, customerKey).catch((e) => {
        throw new BadRequestException(e instanceof ExternalApiError ? (e.body?.message ?? '카드사 확인에 실패했어요') : '결제사에 연결하지 못했어요');
      });
      billingKey = res.billingKey;
      cardCompany = res.cardCompany ?? null;
      cardNumber = res.cardNumber ?? res.card?.number ?? null;
    } else {
      billingKey = `mock_${randomUUID()}`;
      cardCompany = '시연용';
      cardNumber = '4330********1234';
    }
    await this.methods.update({ accountId: s.accountId, active: true }, { active: false });
    const method = await this.methods.save(this.methods.create({ accountId: s.accountId, customerKey, billingKey, cardCompany, cardNumber }));
    await this.redis.client.del(this.redis.key('billing', session));
    this.rt.toAccount(s.accountId, 'payment.method.updated', { id: method.id, cardCompany, cardNumber });
    return method;
  }

  // ── 결제 ─────────────────────────────────────────────

  /** 작업 요금이나 취소 수수료를 결제한다. 같은 호출로 다시 부르면 이미 된 결제를 돌려준다. */
  async capture(job: Job, amount: number, kind: Payment['kind'] = 'FARE') {
    let payment = await this.payments.findOneBy({ jobId: job.id });
    if (payment?.status === 'CAPTURED' || payment?.status === 'REFUNDED') return payment;
    const commission = Math.round(amount * this.config.get<number>('commissionRate')!);
    payment ??= this.payments.create({ jobId: job.id, providerId: job.providerId!, kind });
    Object.assign(payment, { amount, commission, providerPayout: amount - commission, kind, attempts: (payment.attempts ?? 0) + 1 });

    if (!this.toss.enabled) {
      Object.assign(payment, { status: 'CAPTURED', method: 'MOCK', pgTxId: `mock_${randomUUID()}`, failReason: null });
      return this.payments.save(payment);
    }

    payment.method = 'TOSS';
    const card = await this.activeMethod(job.customerId);
    if (!card) return this.fail(payment, '등록된 카드가 없습니다');
    try {
      const res = await this.toss.charge(card.billingKey, {
        customerKey: card.customerKey,
        amount,
        // 실패 후 다시 시도할 때는 새 주문번호를 쓴다
        orderId: `${job.id}-${payment.attempts}`,
        orderName: kind === 'CANCEL_FEE' ? '장비 호출 취소 수수료' : '장비 호출 이용 요금',
      });
      if (res.status !== 'DONE') return this.fail(payment, `결제 상태 ${res.status}`);
      Object.assign(payment, { status: 'CAPTURED', pgTxId: res.paymentKey, failReason: null });
      return this.payments.save(payment);
    } catch (e) {
      const reason = e instanceof ExternalApiError ? (e.body?.message ?? `결제사 오류 ${e.status}`) : '결제사에 연결하지 못했습니다';
      this.log.warn(`charge failed for job ${job.id}: ${(e as Error).message}`);
      return this.fail(payment, reason);
    }
  }

  private async fail(payment: Payment, reason: string) {
    Object.assign(payment, { status: 'FAILED', failReason: reason });
    const saved = await this.payments.save(payment);
    const job = await this.jobs.findOneBy({ id: payment.jobId });
    if (job) this.rt.toAccount(job.customerId, 'payment.failed', { jobId: job.id, amount: payment.amount, reason });
    this.rt.toAdmins('admin.alert', { kind: 'PAYMENT_FAILED', jobId: payment.jobId, amount: payment.amount, reason });
    return saved;
  }

  /** 실패한 결제를 사용자가 카드를 바꾼 뒤 다시 시도한다 */
  async retry(customerId: string, jobId: string) {
    const job = await this.jobs.findOneBy({ id: jobId, customerId });
    const payment = await this.payments.findOneBy({ jobId });
    if (!job || !payment) throw new NotFoundException('결제할 내역이 없습니다');
    if (payment.status !== 'FAILED') return payment;
    return this.capture(job, payment.amount, payment.kind);
  }

  forJob(jobId: string) {
    return this.payments.findOneBy({ jobId });
  }

  /** 운영자 환불 (전액) */
  async refund(jobId: string, reason: string) {
    const payment = await this.payments.findOneBy({ jobId });
    if (!payment || payment.status !== 'CAPTURED') throw new BadRequestException('환불할 결제가 없습니다');
    if (payment.method === 'TOSS') await this.toss.cancel(payment.pgTxId!, reason);
    payment.status = 'REFUNDED';
    payment.failReason = reason;
    return this.payments.save(payment);
  }
}
