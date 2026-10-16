import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { haversineKm } from '../common/geo';
import { DispatchService } from '../dispatch/dispatch.service';
import { GeoIndex } from '../dispatch/geo-index';
import { meetsSpec } from '../dispatch/ranking';
import { Account, Job, JobOffer, Payment, Provider, ProviderEquipment } from '../entities';
import { PaymentsService } from '../payments/payments.service';
import { ProvidersService } from '../providers/providers.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const ACTIVE: Job['status'][] = ['REQUESTED', 'MATCHED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];

/** 한국 시간 기준 오늘 0시 */
export function kstStartOfToday(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600_000);
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Job) private readonly jobs: Repository<Job>,
    @InjectRepository(JobOffer) private readonly offers: Repository<JobOffer>,
    @InjectRepository(Provider) private readonly providers: Repository<Provider>,
    @InjectRepository(ProviderEquipment) private readonly equipment: Repository<ProviderEquipment>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly geo: GeoIndex,
    private readonly dispatch: DispatchService,
    private readonly providerService: ProvidersService,
    private readonly paymentsService: PaymentsService,
    private readonly rt: RealtimeGateway,
  ) {}

  /** 오늘 운영 현황 */
  async stats() {
    const since = kstStartOfToday();
    const [today, payments, online, pendingVerify, openAlerts, active] = await Promise.all([
      this.jobs.findBy({ createdAt: MoreThanOrEqual(since) }),
      this.payments.findBy({ createdAt: MoreThanOrEqual(since), status: 'CAPTURED' }),
      this.providers.countBy({ online: true }),
      this.providers.countBy({ verified: false }),
      this.jobs.countBy({ status: 'REQUESTED', unassignedAlert: true }),
      this.jobs.countBy({ status: In(ACTIVE) }),
    ]);
    const matched = today.filter((j) => j.matchedAt);
    const dispatchSecs = matched.map((j) => (j.matchedAt!.getTime() - j.createdAt.getTime()) / 1000);
    return {
      requested: today.length,
      matched: matched.length,
      completed: today.filter((j) => j.status === 'COMPLETED').length,
      cancelled: today.filter((j) => j.status === 'CANCELLED').length,
      matchRate: today.length ? matched.length / today.length : null,
      avgDispatchSec: dispatchSecs.length ? Math.round(dispatchSecs.reduce((a, b) => a + b, 0) / dispatchSecs.length) : null,
      gross: payments.reduce((s, p) => s + p.amount, 0),
      commission: payments.reduce((s, p) => s + p.commission, 0),
      onlineProviders: online,
      pendingVerification: pendingVerify,
      openAlerts,
      active,
    };
  }

  async listJobs(filter: 'active' | 'alert' | 'all') {
    const where =
      filter === 'alert' ? { status: 'REQUESTED' as const, unassignedAlert: true }
      : filter === 'active' ? { status: In(ACTIVE) }
      : {};
    const jobs = await this.jobs.find({ where, order: { createdAt: 'DESC' }, take: 200 });
    const providers = await this.providers.findBy({ id: In(jobs.map((j) => j.providerId).filter(Boolean) as string[]) });
    const customers = await this.accounts.findBy({ id: In(jobs.map((j) => j.customerId)) });
    return jobs.map((j) => ({
      ...j,
      providerName: providers.find((p) => p.id === j.providerId)?.companyName ?? null,
      customerPhone: customers.find((c) => c.id === j.customerId)?.phone ?? null,
    }));
  }

  async listProviders(verified?: boolean) {
    const list = await this.providers.find({
      where: verified === undefined ? {} : { verified },
      order: { createdAt: 'DESC' },
      take: 300,
    });
    const ids = list.map((p) => p.id);
    const [equipment, accounts] = await Promise.all([
      this.equipment.findBy({ providerId: In(ids), active: true }),
      this.accounts.findBy({ id: In(list.map((p) => p.accountId)) }),
    ]);
    return Promise.all(list.map(async (p) => ({
      ...p,
      rating: p.rating,
      acceptanceRate: p.acceptanceRate,
      phone: accounts.find((a) => a.id === p.accountId)?.phone ?? null,
      equipment: equipment.filter((e) => e.providerId === p.id),
      location: p.online ? await this.geo.getLocation(p.id) : null,
    })));
  }

  /** 수동 배차 후보: 이 호출에 맞는 장비를 가진 승인된 이용자, 가까운 순 */
  async candidates(jobId: string) {
    const job = await this.jobs.findOneBy({ id: jobId });
    if (!job) throw new NotFoundException('없는 호출입니다');
    const eqs = (await this.equipment.findBy({ typeCode: job.typeCode, active: true })).filter((e) => meetsSpec(e.spec, job.requiredSpec));
    const providers = await this.providers.findBy({ id: In([...new Set(eqs.map((e) => e.providerId))]), verified: true });
    const offered = await this.offers.findBy({ jobId });
    const rows = await Promise.all(providers.map(async (p) => {
      const live = await this.geo.getLocation(p.id);
      const at = p.online && live ? { lat: live.lat, lng: live.lng } : p.baseLat != null ? { lat: p.baseLat, lng: p.baseLng! } : null;
      return {
        providerId: p.id,
        companyName: p.companyName,
        online: p.online,
        busy: !!p.currentJobId,
        rating: p.rating,
        equipment: eqs.filter((e) => e.providerId === p.id),
        distanceKm: at ? Math.round(haversineKm(job, at) * 10) / 10 : null,
        locationFrom: p.online && live ? 'live' : at ? 'base' : null,
        lastOffer: offered.find((o) => o.providerId === p.id)?.status ?? null,
      };
    }));
    return rows.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9)).slice(0, 30);
  }

  /** 운영자 취소 (CS 처리). 요금은 받지 않는다. */
  async cancel(jobId: string, reason?: string) {
    const job = await this.jobs.findOneBy({ id: jobId });
    if (!job) throw new NotFoundException('없는 호출입니다');
    if (!ACTIVE.includes(job.status)) throw new ConflictException('이미 끝난 호출입니다');
    const res = await this.jobs.update({ id: jobId, status: job.status }, {
      status: 'CANCELLED', cancelledBy: 'ADMIN', cancelFee: 0,
      memo: reason ? `${job.memo ?? ''}\n[운영자 취소] ${reason}`.trim() : job.memo,
    });
    if (!res.affected) throw new ConflictException('호출 상태가 바뀌었습니다. 다시 시도해 주세요.');
    await this.dispatch.closePendingOffers(jobId);
    const fresh = await this.jobs.findOneByOrFail({ id: jobId });
    this.rt.toAccount(job.customerId, 'job.updated', fresh);
    if (job.providerId) {
      await this.providerService.releaseFromJob(job.providerId, jobId);
      const p = await this.providers.findOneBy({ id: job.providerId });
      if (p) this.rt.toAccount(p.accountId, 'job.updated', fresh);
    }
    return fresh;
  }
}
