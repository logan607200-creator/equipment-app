// 환경변수로 덮어쓸 수 있는 운영 설정. 금액·비율은 모두 가정값이며 운영 전에 확정해야 한다.
const num = (key: string, fallback: number) => {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : Number(v);
};

const str = (key: string) => (process.env[key] ?? '').trim() || undefined;

export const appConfig = () => ({
  port: num('PORT', 3000),
  /** 바깥에서 이 서버에 접속하는 주소. 카드 등록 페이지의 돌아올 주소에 쓴다. */
  publicUrl: (str('PUBLIC_URL') ?? `http://localhost:${num('PORT', 3000)}`).replace(/\/$/, ''),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  db: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/equipment',
    sync: (process.env.DB_SYNC ?? 'true') === 'true',
  },
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  redisPrefix: process.env.REDIS_PREFIX ?? 'eq:',
  otp: {
    // 개발 환경에서만 사용. 설정하면 SMS 대신 이 코드로 인증된다.
    devCode: process.env.NODE_ENV === 'production' ? undefined : str('OTP_DEV_CODE'),
    ttlSec: num('OTP_TTL_SEC', 180),
    resendSec: num('OTP_RESEND_SEC', 30),
    maxPerHour: num('OTP_MAX_PER_HOUR', 5),
    maxAttempts: num('OTP_MAX_ATTEMPTS', 5),
  },
  // 키가 비어 있으면 각 연동은 꺼지고 개발용 동작(로그, 모의 결제, 직선 거리 ETA)으로 돌아간다.
  sms: {
    // 솔라피(SOLAPI). 발신번호는 솔라피에 사전 등록된 번호여야 한다.
    apiKey: str('SOLAPI_API_KEY'),
    apiSecret: str('SOLAPI_API_SECRET'),
    sender: str('SMS_SENDER'),
    baseUrl: str('SOLAPI_BASE_URL') ?? 'https://api.solapi.com',
  },
  toss: {
    // 토스페이먼츠 자동결제(빌링). 테스트 키(test_ck_/test_sk_)면 실제 돈이 나가지 않는다.
    clientKey: str('TOSS_CLIENT_KEY'),
    secretKey: str('TOSS_SECRET_KEY'),
    baseUrl: str('TOSS_BASE_URL') ?? 'https://api.tosspayments.com',
  },
  fcm: {
    // Firebase 서비스 계정 (프로젝트 설정 → 서비스 계정 → 새 비공개 키)
    projectId: str('FCM_PROJECT_ID'),
    clientEmail: str('FCM_CLIENT_EMAIL'),
    privateKey: str('FCM_PRIVATE_KEY')?.replace(/\\n/g, '\n'),
    tokenUrl: str('FCM_TOKEN_URL') ?? 'https://oauth2.googleapis.com/token',
    baseUrl: str('FCM_BASE_URL') ?? 'https://fcm.googleapis.com',
  },
  kakao: {
    // 카카오 디벨로퍼스 → 내 애플리케이션 → 앱 키 → REST API 키
    restKey: str('KAKAO_REST_KEY'),
    localBaseUrl: str('KAKAO_LOCAL_BASE_URL') ?? 'https://dapi.kakao.com',
    mobilityBaseUrl: str('KAKAO_MOBILITY_BASE_URL') ?? 'https://apis-navi.kakaomobility.com',
    // 길찾기 API를 부를 후보 수 (가까운 순). 호출 비용을 줄이려고 제한한다.
    routeCandidates: num('KAKAO_ROUTE_CANDIDATES', 5),
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
