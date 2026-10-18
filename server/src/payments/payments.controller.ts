import { Controller, Delete, Get, Header, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles, type AuthUser } from '../common/roles';
import { billingDonePage, billingFailPage, billingPage } from './billing-page';
import { PaymentsService } from './payments.service';

/**
 * 결제 카드 등록과 결제 재시도.
 * 카드 등록 순서: 앱이 POST /payments/billing/session → 받은 url을 앱 안 브라우저로 연다 →
 * 토스 결제창 → /payments/billing/success 에서 빌링키 발급 → 앱은 GET /payments/methods 로 확인.
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('methods') @Roles('CUSTOMER') methods(@CurrentUser() u: AuthUser) {
    return this.payments.listMethods(u.accountId);
  }

  @Delete('methods/:id') @Roles('CUSTOMER') remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.removeMethod(u.accountId, id);
  }

  @Post('billing/session') @Roles('CUSTOMER') session(@CurrentUser() u: AuthUser) {
    return this.payments.startBillingSession(u.accountId);
  }

  @Post('jobs/:jobId/retry') @Roles('CUSTOMER') retry(@CurrentUser() u: AuthUser, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.payments.retry(u.accountId, jobId);
  }

  // 아래는 브라우저가 여는 페이지라 로그인 토큰 대신 session 값으로 확인한다.

  @Get('billing/page') @Header('Content-Type', 'text/html; charset=utf-8')
  async page(@Query('session') session: string) {
    try {
      const s = await this.payments.readSession(session);
      return billingPage(this.payments.billingPageParams(session, s.customerKey));
    } catch (e) {
      return billingFailPage((e as Error).message);
    }
  }

  @Get('billing/success') @Header('Content-Type', 'text/html; charset=utf-8')
  async success(@Query('session') session: string, @Query('authKey') authKey: string, @Query('customerKey') customerKey: string) {
    try {
      const m = await this.payments.completeBilling(session, authKey, customerKey);
      return billingDonePage(m);
    } catch (e) {
      return billingFailPage((e as Error).message);
    }
  }

  @Get('billing/fail') @Header('Content-Type', 'text/html; charset=utf-8')
  fail(@Query('message') message?: string) {
    return billingFailPage(message ?? '카드 등록이 취소됐어요');
  }
}
