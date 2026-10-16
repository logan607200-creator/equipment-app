import type { Job, JobOffer } from '../entities';

/** 이용자 앱에 보여 줄 제안 내용 (수락 전이라 사용자 연락처 등은 넣지 않는다) */
export function offerView(offer: JobOffer, job: Job) {
  return {
    id: offer.id, offerId: offer.id, jobId: job.id, status: offer.status,
    expiresAt: offer.expiresAt, etaSec: offer.etaSec, distanceKm: offer.distanceKm,
    typeCode: job.typeCode, options: job.options, requiredSpec: job.requiredSpec,
    address: job.address, lat: job.lat, lng: job.lng, destAddress: job.destAddress,
    scheduledAt: job.scheduledAt, memo: job.memo,
    estimate: { amount: job.estimate.amount, min: job.estimate.min, max: job.estimate.max, distanceKm: job.estimate.distanceKm },
  };
}
