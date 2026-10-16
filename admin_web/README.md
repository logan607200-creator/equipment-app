# 관리자 웹

운영자가 쓰는 관제 화면입니다. React + Vite, 지도는 Leaflet(OpenStreetMap).

| 메뉴 | 하는 일 |
|---|---|
| 관제 | 오늘 호출·배차율·평균 배차 시간·매출·수수료, 지도에 진행 중 호출과 출근한 이용자, 호출 상세 |
| 미배차 | 반경을 다 넓혀도 못 잡은 호출. 거리순 후보를 보고 직접 배정, 자동 배차 다시 시작, 운영자 취소 |
| 호출 내역 | 전체 호출 검색, 상태별 보기 |
| 이용자 | 서류 승인 대기, 승인·승인 취소 (승인 취소하면 바로 퇴근 처리) |
| 요금표 | 장비별 요금 수정. 새 호출부터 적용 |

미배차 경보는 실시간(socket.io `admin.alert`)으로 화면에 뜹니다.

## 실행

```bash
npm install
VITE_API_URL=http://localhost:3000 npm run dev   # http://localhost:5173
npm run build                                    # dist/
```

로그인은 서버 `.env`의 `ADMIN_PHONES`에 넣은 번호로 합니다. 개발 중에는 `OTP_DEV_CODE`가 인증번호입니다.
