import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createSign } from 'crypto';
import { In, Repository } from 'typeorm';
import { DeviceToken } from '../entities';
import { callJson, ExternalApiError } from './http';

export interface PushMessage {
  title: string;
  body: string;
  /** 앱이 눌렸을 때 열 화면을 정하는 값 (문자열만 가능) */
  data?: Record<string, string>;
}

/**
 * 푸시 알림 (Firebase Cloud Messaging HTTP v1). 서비스 계정 키가 없으면 보내지 않는다.
 * 앱이 꺼져 있거나 화면이 잠겨 있을 때도 호출 제안과 상태 변경을 알리기 위해 쓴다.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger('Push');
  private accessToken: { value: string; exp: number } | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(DeviceToken) private readonly tokens: Repository<DeviceToken>,
  ) {}

  private get cfg() {
    return this.config.get<{ projectId?: string; clientEmail?: string; privateKey?: string; tokenUrl: string; baseUrl: string }>('fcm')!;
  }

  get enabled() {
    const c = this.cfg;
    return !!(c.projectId && c.clientEmail && c.privateKey);
  }

  async register(accountId: string, token: string, platform: string) {
    await this.tokens.upsert({ accountId, token, platform }, ['token']);
  }

  async unregister(accountId: string, token: string) {
    await this.tokens.delete({ accountId, token });
  }

  /** 실패해도 호출 흐름을 막지 않는다. */
  async sendToAccount(accountId: string, msg: PushMessage) {
    if (!this.enabled) return;
    try {
      const list = await this.tokens.findBy({ accountId });
      const dead: string[] = [];
      await Promise.all(list.map(async (t) => {
        try {
          await this.sendOne(t.token, msg);
        } catch (e) {
          if (e instanceof ExternalApiError && (e.status === 404 || e.body?.error?.status === 'INVALID_ARGUMENT')) dead.push(t.token);
          else this.log.warn(`push failed: ${(e as Error).message}`);
        }
      }));
      if (dead.length) await this.tokens.delete({ token: In(dead) });
    } catch (e) {
      this.log.warn(`push failed: ${(e as Error).message}`);
    }
  }

  private async sendOne(token: string, msg: PushMessage) {
    const { projectId, baseUrl } = this.cfg;
    await callJson('fcm', `${baseUrl}/v1/projects/${projectId}/messages:send`, {
      headers: { Authorization: `Bearer ${await this.getAccessToken()}` },
      body: {
        message: {
          token,
          notification: { title: msg.title, body: msg.body },
          data: msg.data ?? {},
          android: { priority: 'high', notification: { sound: 'default', channel_id: 'calls' } },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      },
    });
  }

  /** 서비스 계정으로 서명한 JWT를 OAuth 토큰으로 바꾼다. 만료 5분 전까지 재사용. */
  private async getAccessToken() {
    if (this.accessToken && this.accessToken.exp - 300_000 > Date.now()) return this.accessToken.value;
    const { clientEmail, privateKey, tokenUrl } = this.cfg;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: tokenUrl, iat: now, exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey!, 'base64url');
    const res = await callJson<{ access_token: string; expires_in: number }>('google-oauth', tokenUrl, {
      form: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` },
    });
    this.accessToken = { value: res.access_token, exp: Date.now() + res.expires_in * 1000 };
    return res.access_token;
  }
}
