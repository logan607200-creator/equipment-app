import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { callJson } from './http';

export interface TossBillingKey {
  billingKey: string;
  customerKey: string;
  cardCompany?: string;
  cardNumber?: string;
  card?: { number?: string; cardType?: string; ownerType?: string; issuerCode?: string };
}

export interface TossPayment {
  paymentKey: string;
  orderId: string;
  status: string;
  totalAmount: number;
  approvedAt?: string;
}

/**
 * 토스페이먼츠 자동결제(빌링). 카드는 토스 결제창에서 등록하고 우리는 빌링키만 보관한다.
 * https://docs.tosspayments.com/guides/v2/billing
 */
@Injectable()
export class TossClient {
  constructor(private readonly config: ConfigService) {}

  private get cfg() {
    return this.config.get<{ clientKey?: string; secretKey?: string; baseUrl: string }>('toss')!;
  }

  get enabled() {
    return !!(this.cfg.clientKey && this.cfg.secretKey);
  }

  get clientKey() {
    return this.cfg.clientKey!;
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Basic ${Buffer.from(`${this.cfg.secretKey}:`).toString('base64')}`, ...extra };
  }

  issueBillingKey(authKey: string, customerKey: string) {
    return callJson<TossBillingKey>('toss', `${this.cfg.baseUrl}/v1/billing/authorizations/issue`, {
      headers: this.headers(), body: { authKey, customerKey },
    });
  }

  /** 같은 orderId로 다시 불러도 한 번만 결제되도록 Idempotency-Key를 붙인다. */
  charge(billingKey: string, p: { customerKey: string; amount: number; orderId: string; orderName: string }) {
    return callJson<TossPayment>('toss', `${this.cfg.baseUrl}/v1/billing/${encodeURIComponent(billingKey)}`, {
      headers: this.headers({ 'Idempotency-Key': p.orderId }), body: p, timeoutMs: 30_000,
    });
  }

  cancel(paymentKey: string, cancelReason: string, cancelAmount?: number) {
    return callJson<TossPayment>('toss', `${this.cfg.baseUrl}/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, {
      headers: this.headers(), body: { cancelReason, ...(cancelAmount ? { cancelAmount } : {}) },
    });
  }
}
