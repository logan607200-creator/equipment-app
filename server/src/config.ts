// 환경변수로 덮어쓸 수 있는 운영 설정. 금액·비율은 모두 가정값이며 운영 전에 확정해야 한다.
const num = (key: string, fallback: number) => {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : Number(v);
};

export const appConfig = () => ({
  port: num('PORT', 3000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  db: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/equipment',
    sync: (process.env.DB_SYNC ?? 'true') === 'true',
  },
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  redisPrefix: process.env.REDIS_PREFIX ?? 'eq:',
  otp: {
    // 개발 환경에서만 사용. 설정하면 SMS 대신 이 코드로 인증된다.
    devCode: process.env.NODE_ENV === 'production' ? undefined : process.env.OTP_DEV_CODE,
    ttlSec: num('OTP_TTL_SEC', 180),
  },
  adminPhones: (process.env.ADMIN_PHONES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  dispatch: {
    offerTimeoutMs: num('OFFER_TIMEOUT_MS', 15_000),
    radiusStepsKm: (process.env.RADIUS_STEPS_KM ?? '5,10,20').split(',').map(Number),
    radiusStepMs: num('RADIUS_STEP_MS', 120_000),
    retryMs: num('DISPATCH_RETRY_MS', 5_000),
    // 이 시간 안에 위치를 보낸 이용자만 후보로 본다.
    locationStaleMs: num('LOCATION_STALE_MS', 60_000),
    // ETA 차이가 이 안이면 평점·수락률로 순서를 정한다.
    etaTieSec: num('ETA_TIE_SEC', 60),
  },
  freeCancelMs: num('FREE_CANCEL_MS', 180_000),
  commissionRate: num('COMMISSION_RATE', 0.05),
});

export type AppConfig = ReturnType<typeof appConfig>;
