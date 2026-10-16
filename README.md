# 장비 호출 플랫폼

카카오T처럼 위치 기반으로 가까운 장비를 부르는 서비스입니다.
렉카, 지게차, 덤프, 포크레인, 크레인, 렌탈, 사다리차, 스카이를 다룹니다.

| 용어 | 뜻 | 앱 | 코드 |
|---|---|---|---|
| 이용자 | 장비를 가진 기사·업체 (공급자) | 이용자 앱 | `PROVIDER` |
| 사용자 | 장비가 필요한 사람 (수요자) | 사용자 앱 | `CUSTOMER` |
| 운영자 | 우리 회사 관제·CS | 관리자 웹 | `ADMIN` |

## 지금 있는 것

`server/` — NestJS + PostgreSQL + Redis 서버. 두 앱과 관리자 웹이 함께 쓰는 API와 실시간 채널입니다.

- 휴대폰 인증 로그인 (SMS 발송은 연동 전, 개발용 고정 코드 지원)
- 장비 종류 표 (새 업종은 행 추가로 확장), 장비별 규격 (톤수, 작업 높이)
- 요금 예상: 렉카는 기본료 + 거리, 나머지는 시간·반일·일 대여, 야간·주말·고속도로 할증
- 즉시 호출과 예약 호출
- 순차 배차: ETA 순으로 한 명씩 15초 제안, 거절·무응답이면 다음 이용자, 2분마다 반경 5 → 10 → 20km 확대, 끝까지 안 되면 운영자 경보
- 진행 상태: 배차됨 → 출발 → 도착 → 작업 중 → 완료
- 현장 추가 요금은 사용자가 승인해야만 청구
- 취소 규칙: 배차 전·배차 후 3분 안 무료, 그 뒤 출동비
- 완료 시 결제 기록과 수수료(5%) 계산, 이용자 정산 요약, 평점
- 실시간 이벤트 (socket.io `/ws`): 제안 도착, 상태 변경, 이용자 위치, 추가요금 요청, 미배차 경보
- 운영자: 이용자 서류 승인, 미배차 목록, 수동 배차, 재배차, 요금표 수정

**요금 금액은 모두 가정값입니다.** 운영 전에 `PUT /admin/equipment-types/:code`로 실제 요금표를 넣어야 합니다.

## 실행

```bash
docker compose up -d          # PostgreSQL, Redis
cd server
cp .env.example .env
npm install
npm run dev                   # http://localhost:3000
npm test                      # 단위 + 전체 흐름 테스트 (DB equipment_test 필요)
```

## API 요약

| 누가 | 메서드 | 경로 | 하는 일 |
|---|---|---|---|
| 누구나 | POST | `/auth/otp/request` | 인증번호 요청 `{phone}` |
| 누구나 | POST | `/auth/otp/verify` | 로그인 `{phone, code, role}` → `token` |
| 누구나 | GET | `/equipment-types` | 장비 목록과 요금 구조 |
| 누구나 | POST | `/jobs/estimate` | 예상 요금 |
| 사용자 | POST | `/jobs` | 호출 (즉시 / `scheduledAt` 예약) |
| 사용자 | GET | `/jobs`, `/jobs/:id` | 내 호출, 상세 (배정 이용자 위치 포함) |
| 사용자 | POST | `/jobs/:id/cancel` | 취소 |
| 사용자 | POST | `/jobs/:id/adjustments/:adjId/approve` · `reject` | 추가 요금 승인·거절 |
| 사용자 | POST | `/jobs/:id/rating` | 평가 |
| 이용자 | GET·PUT | `/provider/me` | 내 정보, 업체명·사업자번호·차고지 |
| 이용자 | POST | `/provider/equipment` | 장비 등록 `{typeCode, spec, plateNo}` |
| 이용자 | POST | `/provider/online` · `offline` | 출근(장비 선택)·퇴근 |
| 이용자 | POST | `/provider/location` | 위치 전송 (소켓 `location` 이벤트도 가능) |
| 이용자 | GET | `/provider/offers` | 대기 중인 제안 |
| 이용자 | POST | `/provider/offers/:id/accept` · `reject` | 수락·거절 |
| 이용자 | POST | `/provider/jobs/:id/status` | 출발·도착·작업 중·완료 |
| 이용자 | POST | `/provider/jobs/:id/adjustments` | 추가 요금 요청 |
| 이용자 | POST | `/provider/jobs/:id/cancel` | 배정 취소 (자동 재배차) |
| 이용자 | GET | `/provider/earnings` | 정산 요약 |
| 운영자 | GET | `/admin/jobs?alert=true` | 관제, 미배차 경보 |
| 운영자 | POST | `/admin/jobs/:id/assign` · `redispatch` | 수동 배차, 재배차 |
| 운영자 | GET | `/admin/providers` | 이용자 목록 |
| 운영자 | POST | `/admin/providers/:id/verify` | 서류 승인 |
| 운영자 | PUT | `/admin/equipment-types/:code` | 요금표 수정 |

## 아직 안 된 것 (다음 단계)

- 사용자 앱, 이용자 앱 (Flutter), 관리자 웹 화면
- SMS 인증 발송, PG 자동결제, 푸시 알림(FCM), 안심번호, 채팅
- 실제 경로 기반 ETA (T맵·카카오모빌리티), 지금은 직선 거리 어림
- 작업 사진·서류 업로드 (S3)
- 서버 여러 대 운영 시 배차 타이머를 지연 큐(BullMQ)로 이전, DB 마이그레이션
