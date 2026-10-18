import { Inject, Logger, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import type { AuthUser, Role } from '../common/roles';
import { PushService } from '../integrations/fcm';
import { pushFor } from '../integrations/push-messages';
import { ProvidersService } from '../providers/providers.service';

/**
 * 앱과 서버 사이 실시간 채널 (socket.io, 경로 /ws).
 * 연결할 때 handshake.auth.token 에 로그인 토큰을 넣는다.
 *
 * 서버 → 앱 이벤트
 *  - offer.created / offer.closed : 이용자에게 호출 제안이 오거나 마감됨
 *  - job.updated                  : 호출 상태가 바뀜 (사용자·이용자 모두)
 *  - provider.location            : 배정된 이용자 위치 (사용자에게)
 *  - adjustment.requested         : 추가 요금 승인 요청 (사용자에게)
 *  - payment.failed               : 자동결제 실패 (사용자에게)
 *  - payment.method.updated       : 카드 등록 완료 (사용자에게)
 *  - admin.alert                  : 미배차·결제 실패 경보 (운영자에게)
 *
 * 이 중 앱이 꺼져 있어도 알아야 하는 이벤트는 푸시 알림으로도 보낸다 (integrations/push-messages.ts).
 * 앱 → 서버 이벤트
 *  - location { lat, lng, heading? } : 이용자 위치 (HTTP POST /provider/location 과 같음)
 */
@WebSocketGateway({ namespace: '/ws', cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly log = new Logger('Realtime');
  @WebSocketServer() server: Namespace;

  constructor(
    private readonly jwt: JwtService,
    @Inject(forwardRef(() => ProvidersService)) private readonly providers: ProvidersService,
    private readonly push: PushService,
  ) {}

  handleConnection(socket: Socket) {
    try {
      const payload = this.jwt.verify<{ sub: string; role: Role }>(socket.handshake.auth?.token);
      const user: AuthUser = { accountId: payload.sub, role: payload.role };
      socket.data.user = user;
      socket.join(`acct:${user.accountId}`);
      if (user.role === 'ADMIN') socket.join('admin');
    } catch {
      socket.emit('error', { message: '로그인이 필요합니다' });
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('location')
  async onLocation(@ConnectedSocket() socket: Socket, @MessageBody() body: { lat: number; lng: number; heading?: number }) {
    const user: AuthUser | undefined = socket.data.user;
    if (user?.role !== 'PROVIDER') return { ok: false };
    if (!Number.isFinite(body?.lat) || !Number.isFinite(body?.lng)) return { ok: false };
    await this.providers.updateLocation(user.accountId, body);
    return { ok: true };
  }

  toAccount(accountId: string, event: string, data: unknown) {
    this.server?.to(`acct:${accountId}`).emit(event, data);
    const msg = pushFor(event, data);
    if (msg) void this.push.sendToAccount(accountId, msg);
  }

  toAdmins(event: string, data: unknown) {
    this.server?.to('admin').emit(event, data);
  }
}
