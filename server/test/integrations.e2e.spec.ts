/**
 * 문자 인증, 카드 자동결제, 푸시 알림, 카카오 주소·길찾기 연동을 가짜 외부 서버로 확인한다.
 * 실제 서비스와 같은 요청 형식·서명을 쓰므로 키만 바꾸면 그대로 동작해야 한다.
 */
import { generateKeyPairSync } from 'crypto';

const FAKE_PORT = 40000 + Math.floor(Math.random() * 10000);
const FAKE = `http://localhost:${FAKE_PORT}`;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

Object.assign(process.env, {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/equipment_test',
  REDIS_PREFIX: `itest${Date.now()}:`,
  OTP_DEV_CODE: '',
  ADMIN_PHONES: '01000000000',
  OFFER_TIMEOUT_MS: '3000',
  DISPATCH_RETRY_MS: '100',
  SOLAPI_API_KEY: 'NCSTEST', SOLAPI_API_SECRET: 'secret123', SMS_SENDER: '0212345678', SOLAPI_BASE_URL: FAKE,
  TOSS_CLIENT_KEY: 'test_ck_fake', TOSS_SECRET_KEY: 'test_sk_fake', TOSS_BASE_URL: FAKE,
  FCM_PROJECT_ID: 'equipment-test', FCM_CLIENT_EMAIL: 'push@equipment-test.iam.gserviceaccount.com',
  FCM_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n'),
  FCM_TOKEN_URL: `${FAKE}/token`, FCM_BASE_URL: FAKE,
  KAKAO_REST_KEY: 'kakao-rest', KAKAO_LOCAL_BASE_URL: FAKE, KAKAO_MOBILITY_BASE_URL: FAKE,
  PUBLIC_URL: 'https://api.example.com',
});

import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { RedisService } from '../src/common/redis';
import { DeviceToken } from '../src/entities';
import { createApp } from '../src/main';
import { startFakeExternals } from './fake-externals';

let app: INestApplication;
let fake: Awaited<ReturnType<typeof startFakeExternals>>;
let adminToken: string;
const http = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => Promise<T | undefined | null | false> | T | undefined | null | false, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('waitFor timeout');
    await sleep(50);
  }
}

/** 실제 문자로 받은 인증번호로 로그인 */
async function login(phone: string, role: 'CUSTOMER' | 'PROVIDER' | 'ADMIN') {
  await http().post('/auth/otp/request').send({ phone }).expect(201);
  const sms = fake.rec.sms.filter((m) => m.to === phone).at(-1)!;
  const code = /인증번호 (\d{6})/.exec(sms.text)![1];
  return (await http().post('/auth/otp/verify').send({ phone, code, role }).expect(201)).body.token as string;
}

const GANGNAM = { lat: 37.4979, lng: 127.0276 };

beforeAll(async () => {
  fake = await startFakeExternals(FAKE_PORT, {
    solapi: { apiKey: 'NCSTEST', apiSecret: 'secret123' },
    tossSecretKey: 'test_sk_fake',
    fcmPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    kakaoRestKey: 'kakao-rest',
  });
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  await pg.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pg.end();
  app = await createApp();
  await app.init();
  adminToken = await login('01000000000', 'ADMIN');
});

afterAll(async () => {
  const redis = app.get(RedisService);
  const keys = await redis.client.keys(`${redis.prefix}*`);
  if (keys.length) await redis.client.del(...keys);
  await app.close();
  await fake.close();
});

describe('문자 인증', () => {
  it('솔라피 서명으로 문자를 보내고, 재발송 간격과 오입력 횟수를 제한한다', async () => {
    const phone = '01055550001';
    await http().post('/auth/otp/request').send({ phone }).expect(201);
    const sms = fake.rec.sms.at(-1)!;
    expect(sms).toMatchObject({ to: phone, from: '0212345678' });
    expect(sms.text).toMatch(/인증번호 \d{6}/);

    // 바로 다시 요청하면 막는다
    await http().post('/auth/otp/request').send({ phone }).expect(429);

    // 다섯 번 틀리면 인증번호가 없어진다
    for (let i = 0; i < 4; i++) await http().post('/auth/otp/verify').send({ phone, code: '000000', role: 'CUSTOMER' }).expect(400);
    const fifth = await http().post('/auth/otp/verify').send({ phone, code: '000000', role: 'CUSTOMER' }).expect(400);
    expect(fifth.body.message).toContain('취소');
    const code = /(\d{6})/.exec(sms.text)![1];
    await http().post('/auth/otp/verify').send({ phone, code, role: 'CUSTOMER' }).expect(400);
  });
});

describe('주소 검색', () => {
  it('주소, 장소 이름, 좌표로 찾는다', async () => {
    const t = await login('01055550002', 'CUSTOMER');
    const byAddr = (await http().get('/geo/search').query({ q: '테헤란로 152' }).set(auth(t)).expect(200)).body;
    expect(byAddr.places[0]).toMatchObject({ roadAddress: '서울 강남구 테헤란로 152', name: '강남파이낸스센터', lat: 37.5, lng: 127.0365 });
    const byName = (await http().get('/geo/search').query({ q: '강남역', ...GANGNAM }).set(auth(t)).expect(200)).body;
    expect(byName.places[0].name).toBe('강남역 2호선');
    const rev = (await http().get('/geo/reverse').query(GANGNAM).set(auth(t)).expect(200)).body;
    expect(rev.address).toBe('서울 강남구 강남대로 396');
  });
});

describe('카드 등록, 자동결제, 푸시, 실제 길 ETA', () => {
  it('카드 없이는 호출할 수 없고, 등록하면 완료 때 그 카드로 결제된다', async () => {
    // 이용자 준비 (푸시 토큰 등록)
    const p = await login('01066660001', 'PROVIDER');
    await http().post('/me/push-tokens').set(auth(p)).send({ token: 'provider-device', platform: 'android' }).expect(201);
    await http().post('/me/push-tokens').set(auth(p)).send({ token: 'dead-token', platform: 'ios' }).expect(201);
    await http().put('/provider/me').set(auth(p)).send({ companyName: '강남렉카', bizRegNo: '123-45-67890' }).expect(200);
    const eq = (await http().post('/provider/equipment').set(auth(p)).send({ typeCode: 'TOW', towClasses: ['CAR'] }).expect(201)).body;
    const me = (await http().get('/provider/me').set(auth(p)).expect(200)).body;
    await http().post(`/admin/providers/${me.id}/verify`).set(auth(adminToken)).send({ verified: true }).expect(201);
    await http().post('/provider/location').set(auth(p)).send({ lat: GANGNAM.lat + 0.01, lng: GANGNAM.lng }).expect(201);
    await http().post('/provider/online').set(auth(p)).send({ equipmentId: eq.id }).expect(201);

    const c = await login('01077770001', 'CUSTOMER');
    await http().post('/me/push-tokens').set(auth(c)).send({ token: 'customer-device', platform: 'ios' }).expect(201);
    const body = { typeCode: 'TOW', ...GANGNAM, address: '서울 강남구 강남대로 396', destLat: 37.5172, destLng: 127.0473, options: { serviceKind: 'TOW', vehicleClass: 'CAR' } };

    const noCard = await http().post('/jobs').set(auth(c)).send(body).expect(400);
    expect(noCard.body.code).toBe('CARD_REQUIRED');
    expect((await http().get('/payments/methods').set(auth(c)).expect(200)).body).toMatchObject({ pgEnabled: true, cardRequired: true, methods: [] });

    // 카드 등록 페이지 → 토스 결제창 → 돌아오는 주소
    const session = (await http().post('/payments/billing/session').set(auth(c)).expect(201)).body;
    expect(session.url).toMatch(/^https:\/\/api\.example\.com\/payments\/billing\/page\?session=/);
    const sessionId = new URL(session.url).searchParams.get('session')!;
    const page = (await http().get('/payments/billing/page').query({ session: sessionId }).expect(200)).text;
    expect(page).toContain('js.tosspayments.com/v2/standard');
    expect(page).toContain('test_ck_fake');
    const customerKey = /"customerKey":"(cus_[^"]+)"/.exec(page)![1];
    // 다른 customerKey는 거절, 만료된 authKey는 안내
    expect((await http().get('/payments/billing/success').query({ session: sessionId, authKey: 'a', customerKey: 'cus_other' })).text).toContain('맞지 않아요');
    expect((await http().get('/payments/billing/success').query({ session: sessionId, authKey: 'bad', customerKey })).text).toContain('카드 인증이 만료');
    const done = (await http().get('/payments/billing/success').query({ session: sessionId, authKey: 'auth-ok', customerKey }).expect(200)).text;
    expect(done).toContain('카드를 등록했어요');
    expect(fake.rec.billingIssued.at(-1)).toMatchObject({ authKey: 'auth-ok', customerKey });
    // 한 번 쓴 등록 주소는 다시 못 쓴다
    expect((await http().get('/payments/billing/page').query({ session: sessionId })).text).toContain('시간이 지났어요');
    const methods = (await http().get('/payments/methods').set(auth(c)).expect(200)).body.methods;
    expect(methods).toEqual([expect.objectContaining({ cardCompany: '신한', cardNumber: '43301234****123*' })]);

    // 호출 → 이용자에게 푸시, ETA는 길찾기 결과(420초 + 준비 60초)
    fake.control.routeSec = 420;
    const job = (await http().post('/jobs').set(auth(c)).send(body).expect(201)).body;
    const offer = await waitFor(async () => (await http().get('/provider/offers').set(auth(p))).body.find((o: any) => o.jobId === job.id));
    expect(offer.etaSec).toBe(480);
    const offerPush = await waitFor(() => fake.rec.pushes.find((x) => x.token === 'provider-device' && x.data.jobId === job.id));
    expect(offerPush.title).toBe('새 호출이 왔어요');
    expect(offerPush.body).toContain('강남대로');
    // 없어진 기기 토큰은 지운다
    await waitFor(async () => !(await app.get(DataSource).getRepository(DeviceToken).findOneBy({ token: 'dead-token' })));

    await http().post(`/provider/offers/${offer.id}/accept`).set(auth(p)).expect(201);
    await waitFor(() => fake.rec.pushes.find((x) => x.token === 'customer-device' && x.title === '기사님이 배정됐어요'));
    for (const status of ['EN_ROUTE', 'ARRIVED', 'COMPLETED']) {
      await http().post(`/provider/jobs/${job.id}/status`).set(auth(p)).send({ status }).expect(201);
    }

    const charge = fake.rec.charges.at(-1)!;
    expect(charge).toMatchObject({ billingKey: 'bk_1', customerKey, amount: job.estimate.amount, orderId: `${job.id}-1`, idempotencyKey: `${job.id}-1` });
    const detail = (await http().get(`/jobs/${job.id}`).set(auth(c)).expect(200)).body;
    expect(detail.payment).toMatchObject({ status: 'CAPTURED', method: 'TOSS', amount: job.estimate.amount });
    await waitFor(() => fake.rec.pushes.find((x) => x.token === 'customer-device' && x.title === '작업이 끝났어요'));

    // 운영자 환불
    await http().post(`/admin/jobs/${job.id}/refund`).set(auth(adminToken)).send({ reason: '중복 결제' }).expect(201);
    expect(fake.rec.cancels.at(-1)).toEqual({ paymentKey: 'pk_1', reason: '중복 결제' });
  });

  it('결제가 거절되면 사용자에게 알리고, 다시 시도할 수 있다', async () => {
    const p = await login('01066660002', 'PROVIDER');
    await http().put('/provider/me').set(auth(p)).send({ companyName: '역삼렉카', bizRegNo: '123-45-67891' }).expect(200);
    const eq = (await http().post('/provider/equipment').set(auth(p)).send({ typeCode: 'TOW' }).expect(201)).body;
    const me = (await http().get('/provider/me').set(auth(p)).expect(200)).body;
    await http().post(`/admin/providers/${me.id}/verify`).set(auth(adminToken)).send({ verified: true }).expect(201);
    await http().post('/provider/location').set(auth(p)).send({ lat: GANGNAM.lat + 0.002, lng: GANGNAM.lng }).expect(201);
    await http().post('/provider/online').set(auth(p)).send({ equipmentId: eq.id }).expect(201);

    const c = await login('01077770002', 'CUSTOMER');
    await http().post('/me/push-tokens').set(auth(c)).send({ token: 'customer2-device', platform: 'android' }).expect(201);
    const s = new URL((await http().post('/payments/billing/session').set(auth(c)).expect(201)).body.url).searchParams.get('session')!;
    const ck = /"customerKey":"(cus_[^"]+)"/.exec((await http().get('/payments/billing/page').query({ session: s })).text)![1];
    await http().get('/payments/billing/success').query({ session: s, authKey: 'ok', customerKey: ck }).expect(200);

    const created = await http().post('/jobs').set(auth(c)).send({ typeCode: 'TOW', ...GANGNAM, destLat: 37.5172, destLng: 127.0473, options: { serviceKind: 'TOW', vehicleClass: 'CAR' } });
    expect(created.body).toMatchObject({ status: 'REQUESTED' });
    const job = created.body;
    const offer = await waitFor(async () => (await http().get('/provider/offers').set(auth(p))).body.find((o: any) => o.jobId === job.id));
    await http().post(`/provider/offers/${offer.id}/accept`).set(auth(p)).expect(201);
    fake.control.failNextCharge = '카드 한도를 초과했습니다';
    for (const status of ['EN_ROUTE', 'ARRIVED', 'COMPLETED']) {
      await http().post(`/provider/jobs/${job.id}/status`).set(auth(p)).send({ status }).expect(201);
    }
    let detail = (await http().get(`/jobs/${job.id}`).set(auth(c)).expect(200)).body;
    expect(detail.status).toBe('COMPLETED');
    expect(detail.payment).toMatchObject({ status: 'FAILED', failReason: '카드 한도를 초과했습니다' });
    await waitFor(() => fake.rec.pushes.find((x) => x.token === 'customer2-device' && x.title === '결제가 안 됐어요'));

    const retried = (await http().post(`/payments/jobs/${job.id}/retry`).set(auth(c)).expect(201)).body;
    expect(retried.status).toBe('CAPTURED');
    expect(fake.rec.charges.at(-1)!.orderId).toBe(`${job.id}-2`);
    detail = (await http().get(`/jobs/${job.id}`).set(auth(c)).expect(200)).body;
    expect(detail.payment.status).toBe('CAPTURED');
  });
});
