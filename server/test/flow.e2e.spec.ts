/**
 * 실제 PostgreSQL·Redis에 붙여 두 앱(사용자·이용자)과 운영자 흐름을 처음부터 끝까지 돌려 본다.
 * 필요: TEST_DATABASE_URL(기본 postgres://postgres:postgres@localhost:5432/equipment_test), Redis(localhost:6379)
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/equipment_test';
process.env.REDIS_PREFIX = `test${Date.now()}:`;
process.env.OTP_DEV_CODE = '123456';
process.env.ADMIN_PHONES = '01000000000';
process.env.OFFER_TIMEOUT_MS = '600';
process.env.RADIUS_STEP_MS = '1500';
process.env.DISPATCH_RETRY_MS = '100';

import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../src/main';
import { RedisService } from '../src/common/redis';

let app: INestApplication;
let base: string;
const sockets: Socket[] = [];

const http = () => request(app.getHttpServer());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('waitFor timeout');
    await sleep(50);
  }
}

async function login(phone: string, role: 'CUSTOMER' | 'PROVIDER' | 'ADMIN') {
  await http().post('/auth/otp/request').send({ phone }).expect(201);
  const res = await http().post('/auth/otp/verify').send({ phone, code: '123456', role }).expect(201);
  return res.body.token as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

function listen(token: string) {
  const events: Array<{ event: string; data: any }> = [];
  const s = io(`${base}/ws`, { auth: { token }, transports: ['websocket'] });
  s.onAny((event, data) => events.push({ event, data }));
  sockets.push(s);
  return { socket: s, events };
}

let adminToken: string;

/** 이용자 가입 → 장비 등록 → 운영자 승인 → (선택) 출근·위치 전송 */
async function provider(phone: string, eq: { typeCode: string; spec?: Record<string, number>; towClasses?: string[] }, at?: { lat: number; lng: number }, baseLoc?: { lat: number; lng: number }) {
  const token = await login(phone, 'PROVIDER');
  await http().put('/provider/me').set(auth(token)).send({ companyName: `${phone} 장비`, bizRegNo: '123-45-67890', ...(baseLoc && { baseLat: baseLoc.lat, baseLng: baseLoc.lng }) }).expect(200);
  const e = (await http().post('/provider/equipment').set(auth(token)).send({ plateNo: '12가3456', ...eq }).expect(201)).body;
  const me = (await http().get('/provider/me').set(auth(token)).expect(200)).body;
  await http().post(`/admin/providers/${me.id}/verify`).set(auth(adminToken)).send({ verified: true }).expect(201);
  if (at) {
    await http().post('/provider/location').set(auth(token)).send(at).expect(201);
    await http().post('/provider/online').set(auth(token)).send({ equipmentId: e.id }).expect(201);
  }
  return { token, id: me.id as string, equipmentId: e.id as string };
}

async function offerFor(token: string, jobId: string) {
  return waitFor(async () => {
    const r = await http().get('/provider/offers').set(auth(token)).expect(200);
    return r.body.find((o: any) => o.jobId === jobId);
  });
}

beforeAll(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  await pg.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pg.end();
  app = await createApp();
  await app.listen(0);
  base = await app.getUrl();
  base = base.replace('[::1]', 'localhost');
  adminToken = await login('01000000000', 'ADMIN');
});

afterAll(async () => {
  sockets.forEach((s) => s.close());
  const redis = app.get(RedisService);
  const keys = await redis.client.keys(`${redis.prefix}*`);
  if (keys.length) await redis.client.del(...keys);
  await app.close();
});

const GANGNAM = { lat: 37.4979, lng: 127.0276 };
const near = (dLat: number, dLng = 0) => ({ lat: GANGNAM.lat + dLat, lng: GANGNAM.lng + dLng });

describe('장비 목록', () => {
  it('8종 장비가 보인다', async () => {
    const r = await http().get('/equipment-types').expect(200);
    expect(r.body.map((t: any) => t.name)).toEqual(['렉카', '지게차', '덤프', '포크레인', '크레인', '렌탈', '사다리차', '스카이']);
  });
});

describe('렉카 즉시 호출 전체 흐름', () => {
  it('거절 → 다음 이용자 수락 → 출발·도착 → 추가요금 승인 → 완료·결제 → 평가', async () => {
    const a = await provider('01011110001', { typeCode: 'TOW', towClasses: ['CAR', 'SUV'] }, near(0.005)); // 약 0.5km
    const b = await provider('01011110002', { typeCode: 'TOW', towClasses: ['CAR', 'SUV'] }, near(0.02)); // 약 2.2km
    await provider('01011110003', { typeCode: 'TOW', towClasses: ['TRUCK_1T'] }, near(0.001)); // 차종이 안 맞음
    const customer = await login('01022220001', 'CUSTOMER');
    const cs = listen(customer);
    const bs = listen(b.token);
    await waitFor(async () => cs.socket.connected && bs.socket.connected);

    const job = (await http().post('/jobs').set(auth(customer)).send({
      typeCode: 'TOW', ...GANGNAM, address: '서울 강남역', destLat: 37.5172, destLng: 127.0473, destAddress: '정비소',
      options: { serviceKind: 'TOW', vehicleClass: 'SUV', highway: true },
    }).expect(201)).body;
    expect(job.status).toBe('REQUESTED');
    expect(job.safetyNotice).toContain('가드레일');
    expect(job.estimate.amount).toBeGreaterThanOrEqual(90000);

    // 가장 가까운 A에게 먼저 제안
    const offerA = await offerFor(a.token, job.id);
    expect((await http().get('/provider/offers').set(auth(b.token))).body).toHaveLength(0);
    await http().post(`/provider/offers/${offerA.id}/reject`).set(auth(a.token)).expect(201);

    // 다음 B에게 제안 (소켓으로도 온다)
    const offerB = await offerFor(b.token, job.id);
    await waitFor(async () => bs.events.find((e) => e.event === 'offer.created' && e.data.jobId === job.id));
    await http().post(`/provider/offers/${offerB.id}/accept`).set(auth(b.token)).expect(201);
    await waitFor(async () => cs.events.find((e) => e.event === 'job.updated' && e.data.status === 'MATCHED'));

    // 이미 마감된 A의 제안은 다시 수락할 수 없다
    await http().post(`/provider/offers/${offerA.id}/accept`).set(auth(a.token)).expect(409);

    // 이용자 위치가 사용자에게 실시간으로 간다
    await http().post(`/provider/jobs/${job.id}/status`).set(auth(b.token)).send({ status: 'EN_ROUTE' }).expect(201);
    bs.socket.emit('location', near(0.01));
    await waitFor(async () => cs.events.find((e) => e.event === 'provider.location' && e.data.jobId === job.id));
    const detail = (await http().get(`/jobs/${job.id}`).set(auth(customer)).expect(200)).body;
    expect(detail.provider.companyName).toBe('01011110002 장비');
    expect(detail.providerLocation.lat).toBeCloseTo(near(0.01).lat);

    // 다른 사용자는 볼 수 없다
    const other = await login('01022220099', 'CUSTOMER');
    await http().get(`/jobs/${job.id}`).set(auth(other)).expect(403);

    await http().post(`/provider/jobs/${job.id}/status`).set(auth(b.token)).send({ status: 'COMPLETED' }).expect(409);
    await http().post(`/provider/jobs/${job.id}/status`).set(auth(b.token)).send({ status: 'ARRIVED' }).expect(201);
    const adj = (await http().post(`/provider/jobs/${job.id}/adjustments`).set(auth(b.token)).send({ amount: 20000, reason: '도로 이탈 차량 구난' }).expect(201)).body;
    await waitFor(async () => cs.events.find((e) => e.event === 'adjustment.requested'));
    await http().post(`/provider/jobs/${job.id}/status`).set(auth(b.token)).send({ status: 'IN_PROGRESS' }).expect(201);
    // 승인 전에는 완료 불가
    await http().post(`/provider/jobs/${job.id}/status`).set(auth(b.token)).send({ status: 'COMPLETED' }).expect(409);
    await http().post(`/jobs/${job.id}/adjustments/${adj.id}/approve`).set(auth(customer)).expect(201);
    const done = (await http().post(`/provider/jobs/${job.id}/status`).set(auth(b.token)).send({ status: 'COMPLETED' }).expect(201)).body;
    expect(done.finalFare).toBe(job.estimate.amount + 20000);

    const earn = (await http().get('/provider/earnings').set(auth(b.token)).expect(200)).body;
    expect(earn.gross).toBe(done.finalFare);
    expect(earn.commission).toBe(Math.round(done.finalFare * 0.05));
    expect(earn.payout).toBe(done.finalFare - earn.commission);

    await http().post(`/jobs/${job.id}/rating`).set(auth(customer)).send({ score: 5, comment: '친절' }).expect(201);
    await http().post(`/jobs/${job.id}/rating`).set(auth(customer)).send({ score: 1 }).expect(409);
    const me = (await http().get('/provider/me').set(auth(b.token))).body;
    expect(me.rating).toBe(5);
    expect(me.currentJobId).toBeNull();
  });
});

describe('크레인: 규격 조건, 무응답, 미배차 경보, 수동 배차', () => {
  it('25톤 이상만 제안 → 무응답 만료 → 반경 단계 소진 후 경보 → 운영자 배정', async () => {
    const small = await provider('01033330001', { typeCode: 'CRANE', spec: { tonnage: 10 } }, near(0.003));
    const big = await provider('01033330002', { typeCode: 'CRANE', spec: { tonnage: 50 } }, near(0.03));
    const customer = await login('01022220002', 'CUSTOMER');
    const job = (await http().post('/jobs').set(auth(customer)).send({
      typeCode: 'CRANE', ...GANGNAM, requiredSpec: { tonnage: 25 }, options: { durationUnit: 'HALF_DAY' },
    }).expect(201)).body;
    // 출동 거리 요금은 가장 가까운 출근 이용자 기준이고, 무료 거리 안이라 붙지 않는다
    expect(job.estimate.dispatchKm).toBeLessThan(1);
    expect(job.estimate.lines.some((l: { label: string }) => l.label.startsWith('출동 거리'))).toBe(false);

    const offer = await offerFor(big.token, job.id);
    expect((await http().get('/provider/offers').set(auth(small.token))).body).toHaveLength(0);
    // 응답하지 않으면 만료
    await sleep(800);
    await http().post(`/provider/offers/${offer.id}/accept`).set(auth(big.token)).expect(409);

    const alerts = await waitFor(async () => {
      const r = await http().get('/admin/jobs?alert=true').set(auth(adminToken)).expect(200);
      return r.body.find((j: any) => j.id === job.id);
    });
    expect(alerts.unassignedAlert).toBe(true);

    // 규격이 안 맞는 이용자는 수동 배차도 막는다
    await http().post(`/admin/jobs/${job.id}/assign`).set(auth(adminToken)).send({ providerId: small.id }).expect(409);
    const assigned = (await http().post(`/admin/jobs/${job.id}/assign`).set(auth(adminToken)).send({ providerId: big.id }).expect(201)).body;
    expect(assigned.status).toBe('MATCHED');
    expect(assigned.unassignedAlert).toBe(false);
  });
});

describe('사다리차 예약 호출', () => {
  it('차고지 기준으로 제안하고, 시간이 겹치는 다음 예약은 그 이용자에게 보내지 않는다', async () => {
    const ladder = await provider('01044440001', { typeCode: 'LADDER', spec: { heightM: 50 } }, undefined, near(0.01));
    const customer = await login('01022220003', 'CUSTOMER');
    const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString();
    const job1 = (await http().post('/jobs').set(auth(customer)).send({
      typeCode: 'LADDER', ...GANGNAM, scheduledAt: tomorrow, requiredSpec: { heightM: 30 }, options: { durationUnit: 'HOUR', durationQty: 3 },
    }).expect(201)).body;
    const offer = await offerFor(ladder.token, job1.id);
    await http().post(`/provider/offers/${offer.id}/accept`).set(auth(ladder.token)).expect(201);

    const job2 = (await http().post('/jobs').set(auth(customer)).send({
      typeCode: 'LADDER', ...GANGNAM, scheduledAt: tomorrow, options: { durationUnit: 'HOUR', durationQty: 2 },
    }).expect(201)).body;
    await sleep(500);
    expect((await http().get('/provider/offers').set(auth(ladder.token))).body).toHaveLength(0);

    // 예약을 수락해도 출발 전까지는 즉시 호출 대기 상태를 막지 않는다
    expect((await http().get('/provider/me').set(auth(ladder.token))).body.currentJobId).toBeNull();
    await http().post(`/jobs/${job2.id}/cancel`).set(auth(customer)).send({}).expect(201);
  });
});

describe('취소', () => {
  it('배차 전 사용자 취소는 무료, 이용자가 취소하면 다른 이용자에게 다시 배차', async () => {
    const p1 = await provider('01055550001', { typeCode: 'FORKLIFT', spec: { tonnage: 3 } }, near(0.002));
    const p2 = await provider('01055550002', { typeCode: 'FORKLIFT', spec: { tonnage: 5 } }, near(0.01));
    const customer = await login('01022220004', 'CUSTOMER');
    const body = { typeCode: 'FORKLIFT', ...GANGNAM, options: { durationUnit: 'HOUR', durationQty: 2 } };

    const j1 = (await http().post('/jobs').set(auth(customer)).send(body).expect(201)).body;
    await offerFor(p1.token, j1.id);
    const c1 = (await http().post(`/jobs/${j1.id}/cancel`).set(auth(customer)).send({ reason: '직접 해결' }).expect(201)).body;
    expect(c1.status).toBe('CANCELLED');
    expect(c1.cancelFee).toBe(0);
    expect((await http().get('/provider/offers').set(auth(p1.token))).body).toHaveLength(0);

    const j2 = (await http().post('/jobs').set(auth(customer)).send(body).expect(201)).body;
    const o1 = await offerFor(p1.token, j2.id);
    await http().post(`/provider/offers/${o1.id}/accept`).set(auth(p1.token)).expect(201);
    await http().post(`/provider/jobs/${j2.id}/cancel`).set(auth(p1.token)).expect(201);
    const o2 = await offerFor(p2.token, j2.id);
    await http().post(`/provider/offers/${o2.id}/accept`).set(auth(p2.token)).expect(201);
    const after = (await http().get(`/jobs/${j2.id}`).set(auth(customer))).body;
    expect(after.provider.id).toBe(p2.id);
    expect((await http().get('/provider/me').set(auth(p1.token))).body.cancelCount).toBe(1);
  });

  it('다친 사람이 있으면 호출 대신 119 안내', async () => {
    const customer = await login('01022220005', 'CUSTOMER');
    const r = await http().post('/jobs').set(auth(customer)).send({ typeCode: 'TOW', ...GANGNAM, injury: true, options: { serviceKind: 'BATTERY' } }).expect(400);
    expect(r.body.code).toBe('CALL_119');
  });

  it('운영자 승인 전 이용자는 출근할 수 없다', async () => {
    const token = await login('01066660001', 'PROVIDER');
    const e = (await http().post('/provider/equipment').set(auth(token)).send({ typeCode: 'DUMP', spec: { tonnage: 25 } }).expect(201)).body;
    await http().post('/provider/online').set(auth(token)).send({ equipmentId: e.id }).expect(409);
    await http().post('/provider/equipment').set(auth(token)).send({ typeCode: 'DUMP', spec: { heightM: 3 } }).expect(400);
  });
});

describe('운영자', () => {
  it('오늘 현황, 이용자 목록, 배정 후보, 운영자 취소', async () => {
    const stats = (await http().get('/admin/stats').set(auth(adminToken)).expect(200)).body;
    expect(stats.requested).toBeGreaterThan(0);
    expect(stats.gross).toBeGreaterThan(0);

    const list = (await http().get('/admin/providers').set(auth(adminToken)).expect(200)).body;
    expect(list[0].phone).toMatch(/^010/);
    expect(Array.isArray(list[0].equipment)).toBe(true);

    const sky = await provider('01077770001', { typeCode: 'SKY', spec: { heightM: 45 } }, near(0.01));
    const customer = await login('01022220006', 'CUSTOMER');
    const job = (await http().post('/jobs').set(auth(customer)).send({ typeCode: 'SKY', ...GANGNAM, requiredSpec: { heightM: 30 }, options: { durationUnit: 'HOUR', durationQty: 2 } }).expect(201)).body;
    const cands = (await http().get(`/admin/jobs/${job.id}/candidates`).set(auth(adminToken)).expect(200)).body;
    expect(cands[0].providerId).toBe(sky.id);
    expect(cands[0].distanceKm).toBeGreaterThan(0);

    const all = (await http().get('/admin/jobs?status=all').set(auth(adminToken)).expect(200)).body;
    expect(all.find((j: any) => j.id === job.id).customerPhone).toBe('01022220006');

    const c = (await http().post(`/admin/jobs/${job.id}/cancel`).set(auth(adminToken)).send({ reason: '고객 전화 요청' }).expect(201)).body;
    expect(c.status).toBe('CANCELLED');
    expect(c.cancelledBy).toBe('ADMIN');
    expect((await http().get('/provider/offers').set(auth(sky.token))).body).toHaveLength(0);
  });
});
