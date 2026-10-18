import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'crypto';
import { callJson } from './http';

/**
 * 문자 발송 (솔라피). 키가 없으면 로그로만 남긴다.
 * https://developers.solapi.com/references/messages/sendSimpleMessage
 */
@Injectable()
export class SmsService {
  private readonly log = new Logger('Sms');
  constructor(private readonly config: ConfigService) {}

  get enabled() {
    const c = this.cfg;
    return !!(c.apiKey && c.apiSecret && c.sender);
  }

  private get cfg() {
    return this.config.get<{ apiKey?: string; apiSecret?: string; sender?: string; baseUrl: string }>('sms')!;
  }

  async send(to: string, text: string) {
    if (!this.enabled) {
      this.log.log(`[문자 미연동] ${to.slice(0, 3)}****: ${text}`);
      return;
    }
    const { apiKey, apiSecret, sender, baseUrl } = this.cfg;
    const date = new Date().toISOString();
    const salt = randomBytes(16).toString('hex');
    const signature = createHmac('sha256', apiSecret!).update(date + salt).digest('hex');
    await callJson('solapi', `${baseUrl}/messages/v4/send`, {
      headers: { Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}` },
      body: { message: { to, from: sender, text } },
    });
  }
}
