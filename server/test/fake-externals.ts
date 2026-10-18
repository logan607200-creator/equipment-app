import { createHmac, createVerify } from 'crypto';
import { createServer, IncomingMessage, Server } from 'http';

/**
 * 솔라피, 토스페이먼츠, Firebase, 카카오를 흉내 내는 로컬 서버.
 * 실제 서비스처럼 서명·인증 헤더를 확인하고, 받은 요청을 기록한다.
 */
export interface FakeOptions {
  solapi: { apiKey: string; apiSecret: string };
  tossSecretKey: string;
  fcmPublicKey: string;
  kakaoRestKey: string;
}

export interface Recorded {
  sms: Array<{ to: string; from: string; text: string }>;
  billingIssued: Array<{ authKey: string; customerKey: string; billingKey: string }>;
  charges: Array<{ billingKey: string; amount: number; orderId: string; customerKey: string; idempotencyKey?: string }>;
  cancels: Array<{ paymentKey: string; reason: string }>;
  pushes: Array<{ token: string; title: string; body: string; data: Record<string, string> }>;
  routes: number;
}

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => resolve(s));
  });

export function startFakeExternals(port: number, opt: FakeOptions) {
  const rec: Recorded = { sms: [], billingIssued: [], charges: [], cancels: [], pushes: [], routes: 0 };
  const control = { failNextCharge: false as false | string, routeSec: 420 };
  const tossAuth = `Basic ${Buffer.from(`${opt.tossSecretKey}:`).toString('base64')}`;

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${port}`);
    const raw = await readBody(req);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const json = () => (raw ? JSON.parse(raw) : {});

    // ── 솔라피 ──
    if (url.pathname === '/messages/v4/send') {
      const m = /HMAC-SHA256 apiKey=(.+), date=(.+), salt=(.+), signature=(.+)/.exec(String(req.headers.authorization));
      const ok = m && m[1] === opt.solapi.apiKey && createHmac('sha256', opt.solapi.apiSecret).update(m[2] + m[3]).digest('hex') === m[4];
      if (!ok) return send(403, { errorCode: 'SignatureDoesNotMatch' });
      rec.sms.push(json().message);
      return send(200, { groupId: 'G1', messageId: 'M1', statusCode: '2000' });
    }

    // ── Google OAuth + FCM ──
    if (url.pathname === '/token') {
      const assertion = new URLSearchParams(raw).get('assertion') ?? '';
      const [h, p, sig] = assertion.split('.');
      const valid = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(opt.fcmPublicKey, sig, 'base64url');
      if (!valid) return send(400, { error: 'invalid_grant' });
      return send(200, { access_token: 'fake-access-token', expires_in: 3600 });
    }
    if (/^\/v1\/projects\/.+\/messages:send$/.test(url.pathname)) {
      if (req.headers.authorization !== 'Bearer fake-access-token') return send(401, {});
      const m = json().message;
      if (m.token === 'dead-token') return send(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } });
      rec.pushes.push({ token: m.token, title: m.notification.title, body: m.notification.body, data: m.data });
      return send(200, { name: 'projects/p/messages/1' });
    }

    // ── 카카오모빌리티 길찾기 (FCM과 함께 토스와 경로가 겹쳐서 먼저 본다) ──
    if (url.pathname === '/v1/directions') {
      if (req.headers.authorization !== `KakaoAK ${opt.kakaoRestKey}`) return send(401, {});
      rec.routes++;
      return send(200, { routes: [{ result_code: 0, summary: { duration: control.routeSec, distance: 3100 } }] });
    }

    // ── 토스페이먼츠 ──
    if (url.pathname.startsWith('/v1/')) {
      if (req.headers.authorization !== tossAuth) return send(401, { code: 'UNAUTHORIZED_KEY', message: '인증되지 않은 키' });
      if (url.pathname === '/v1/billing/authorizations/issue') {
        const b = json();
        if (b.authKey === 'bad') return send(400, { code: 'INVALID_AUTH_KEY', message: '카드 인증이 만료되었습니다' });
        const billingKey = `bk_${rec.billingIssued.length + 1}`;
        rec.billingIssued.push({ ...b, billingKey });
        return send(200, { billingKey, customerKey: b.customerKey, cardCompany: '신한', cardNumber: '43301234****123*', card: { number: '43301234****123*' } });
      }
      const charge = /^\/v1\/billing\/(.+)$/.exec(url.pathname);
      if (charge) {
        const b = json();
        if (control.failNextCharge) {
          const message = control.failNextCharge;
          control.failNextCharge = false;
          return send(400, { code: 'REJECT_CARD_COMPANY', message });
        }
        rec.charges.push({ billingKey: decodeURIComponent(charge[1]), ...b, idempotencyKey: req.headers['idempotency-key'] as string });
        return send(200, { paymentKey: `pk_${rec.charges.length}`, orderId: b.orderId, status: 'DONE', totalAmount: b.amount });
      }
      const cancel = /^\/v1\/payments\/(.+)\/cancel$/.exec(url.pathname);
      if (cancel) {
        rec.cancels.push({ paymentKey: cancel[1], reason: json().cancelReason });
        return send(200, { paymentKey: cancel[1], status: 'CANCELED' });
      }
    }

    // ── 카카오 ──
    if (req.headers.authorization !== `KakaoAK ${opt.kakaoRestKey}`) return send(401, { msg: 'wrong key' });
    if (url.pathname === '/v2/local/search/address.json') {
      if (url.searchParams.get('query') !== '테헤란로 152') return send(200, { documents: [] });
      return send(200, { documents: [{ address_name: '서울 강남구 역삼동 737', x: '127.0365', y: '37.5000',
        address: { address_name: '서울 강남구 역삼동 737' }, road_address: { address_name: '서울 강남구 테헤란로 152', building_name: '강남파이낸스센터' } }] });
    }
    if (url.pathname === '/v2/local/search/keyword.json') {
      return send(200, { documents: [{ place_name: '강남역 2호선', address_name: '서울 강남구 역삼동 858', road_address_name: '서울 강남구 강남대로 396', x: '127.0276', y: '37.4979' }] });
    }
    if (url.pathname === '/v2/local/geo/coord2address.json') {
      return send(200, { documents: [{ address: { address_name: '서울 강남구 역삼동 858' }, road_address: { address_name: '서울 강남구 강남대로 396' } }] });
    }
    send(404, { message: `fake: no route ${url.pathname}` });
  });

  return new Promise<{ rec: Recorded; control: typeof control; close: () => Promise<void> }>((resolve) =>
    server.listen(port, () => resolve({ rec, control, close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections(); }) })),
  );
}
