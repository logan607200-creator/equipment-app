import type { PushMessage } from './fcm';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

const CUSTOMER_STATUS: Record<string, string> = {
  MATCHED: '기사님이 배정됐어요',
  EN_ROUTE: '기사님이 출발했어요',
  ARRIVED: '기사님이 도착했어요',
  COMPLETED: '작업이 끝났어요',
  CANCELLED: '호출이 취소됐어요',
};

/**
 * 실시간 이벤트 중 앱이 꺼져 있어도 알려야 하는 것만 푸시로 바꾼다.
 * 위치 이동처럼 자주 오는 이벤트는 보내지 않는다.
 */
export function pushFor(event: string, data: any): PushMessage | null {
  switch (event) {
    case 'offer.created': {
      return {
        title: data?.scheduledAt ? '새 예약 호출이 왔어요' : '새 호출이 왔어요',
        body: [data?.distanceKm != null ? `${data.distanceKm}km` : null, data?.address, data?.estimate?.amount ? won(data.estimate.amount) : null]
          .filter(Boolean).join(' · ') || '앱을 열어 확인해 주세요',
        data: { type: 'offer', offerId: String(data?.id ?? ''), jobId: String(data?.jobId ?? '') },
      };
    }
    case 'job.updated': {
      const title = CUSTOMER_STATUS[data?.status];
      if (!title) return null;
      const body = data.status === 'COMPLETED' && data.finalFare ? `결제 금액 ${won(data.finalFare)}` : '앱에서 자세히 볼 수 있어요';
      return { title, body, data: { type: 'job', jobId: String(data.id) } };
    }
    case 'adjustment.requested':
      return {
        title: '추가 요금 승인 요청',
        body: `${data?.reason ?? ''} ${data?.amount ? won(data.amount) : ''}`.trim(),
        data: { type: 'job', jobId: String(data?.jobId ?? '') },
      };
    case 'payment.failed':
      return { title: '결제가 안 됐어요', body: '앱에서 카드를 확인해 주세요', data: { type: 'job', jobId: String(data?.jobId ?? '') } };
    default:
      return null;
  }
}
