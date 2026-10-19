import { ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, IsNull, Repository } from 'typeorm';
import { Job, JobOffer, Provider, ProviderEquipment } from '../entities';
import type { AppConfig } from '../config';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { EtaService } from './eta';
import { GeoIndex } from './geo-index';
import { offerView } from './offer-view';
import { Candidate, jobWindow, meetsSpec, rankCandidates } from './ranking';

const ACTIVE: Job['status'][] = ['MATCHED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];

/**
 * 순차 배차.
 * 반경 안 후보를 ETA 순으로 세우고 한 명에게만 제안한다. 제한 시간 안에 응답이 없거나
 * 거절하면 다음 후보에게 넘긴다. 단계 시간이 지나면 반경을 넓히고, 마지막 단계도 지나면
 * 운영자에게 미배차 경보를 띄운다.
 *
 * 타이머는 서버 메모리에 있다 (서버 1대 기준). 여러 대로 늘릴 때는 BullMQ 같은 지연 큐로 옮긴다.
 * 서버가 재시작되면 진행 중이던 호출의 배차를 다시 이어간다.
 */
@Injectable()
export class DispatchService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Dispatch');
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly cfg: AppConfig['dispatch'];

  constructor(
    config: ConfigService,
    private readonly ds: DataSource,
    @InjectRepository(Job) private readonly jobs: Repository<Job>,
    @InjectRepository(JobOffer) private readonly offers: Repository<JobOffer>,
    @InjectRepository(Provider) private readonly providers: Repository<Provider>,
    @InjectRepository(ProviderEquipment) private readonly equipment: Repository<ProviderEquipment>,
    private readonly geo: GeoIndex,
    private readonly eta: EtaService,
    private readonly rt: RealtimeGateway,
  ) {
    this.cfg = config.get('dispatch')!;
  }

  /** 배차가 찾는 가장 넓은 반경 */
  get maxRadiusKm() {
    return this.cfg.radiusStepsKm[this.cfg.radiusStepsKm.length - 1];
  }

  async onApplicationBootstrap() {
    const open = await this.jobs.find({ where: { status: 'REQUESTED', unassignedAlert: false }, select: { id: true } });
    for (const j of open) this.schedule(j.id, 0);
    if (open.length) this.log.log(`배차 재개: ${open.length}건`);
  }

  onModuleDestroy() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  start(jobId: string) {
    this.schedule(jobId, 0);
  }

  stop(jobId: string) {
    const t = this.timers.get(jobId);
    if (t) clearTimeout(t);
    this.timers.delete(jobId);
  }

  private schedule(jobId: string, ms: number) {
    this.stop(jobId);
    const t = setTimeout(() => {
      this.timers.delete(jobId);
      this.round(jobId).catch((e) => {
        this.log.error(`배차 오류 ${jobId}: ${e?.message}`);
        this.schedule(jobId, this.cfg.retryMs);
      });
    }, Math.max(0, ms));
    this.timers.set(jobId, t);
  }

  /** 배차 한 걸음: 만료된 제안 정리 → 반경 결정 → 다음 후보에게 제안 */
  async round(jobId: string) {
    const job = await this.jobs.findOneBy({ id: jobId });
    if (!job || job.status !== 'REQUESTED' || job.unassignedAlert) return;
    const now = Date.now();

    const pending = await this.offers.findOneBy({ jobId, status: 'PENDING' });
    if (pending) {
      if (pending.expiresAt.getTime() > now) return this.schedule(jobId, pending.expiresAt.getTime() - now);
      const res = await this.offers.update({ id: pending.id, status: 'PENDING' }, { status: 'EXPIRED', respondedAt: new Date() });
      if (res.affected) this.rt.toAccount(await this.accountOf(pending.providerId), 'offer.closed', { offerId: pending.id, reason: 'EXPIRED' });
    }

    const elapsed = now - job.dispatchStartedAt.getTime();
    const step = Math.floor(elapsed / this.cfg.radiusStepMs);
    if (step >= this.cfg.radiusStepsKm.length) return this.raiseAlert(job);
    const radiusKm = this.cfg.radiusStepsKm[step];

    const [best] = await this.findCandidates(job, radiusKm);
    if (!best) {
      const untilNextStep = (step + 1) * this.cfg.radiusStepMs - elapsed;
      return this.schedule(jobId, Math.min(this.cfg.retryMs, untilNextStep));
    }

    const offer = await this.offers.save(this.offers.create({
      jobId, providerId: best.providerId, equipmentId: best.equipmentId,
      etaSec: best.etaSec, distanceKm: Math.round(best.distanceKm * 10) / 10,
      expiresAt: new Date(now + this.cfg.offerTimeoutMs),
    }));
    await this.providers.increment({ id: best.providerId }, 'offersReceived', 1);
    this.rt.toAccount(await this.accountOf(best.providerId), 'offer.created', offerView(offer, job));
    this.schedule(jobId, this.cfg.offerTimeoutMs);
  }

  async findCandidates(job: Job, radiusKm: number): Promise<Candidate[]> {
    const scheduled = !!job.scheduledAt;
    const hits = await this.geo.search(scheduled ? 'base' : 'live', job.typeCode, job.lat, job.lng, radiusKm);
    if (!hits.length) return [];
    const ids = hits.map((h) => h.providerId);

    const [providers, equipment, offeredHere, pendingElsewhere] = await Promise.all([
      this.providers.findBy({ id: In(ids), verified: true }),
      this.equipment.findBy({ providerId: In(ids), typeCode: job.typeCode, active: true }),
      this.offers.find({ where: { jobId: job.id }, select: { providerId: true } }),
      this.offers.find({ where: { providerId: In(ids), status: 'PENDING' }, select: { providerId: true } }),
    ]);
    const byId = new Map(providers.map((p) => [p.id, p]));
    const excluded = new Set([...offeredHere, ...pendingElsewhere].map((o) => o.providerId));
    const scheduledBusy = scheduled ? await this.scheduledConflicts(ids, job) : new Set<string>();

    const fits = (e: ProviderEquipment) =>
      meetsSpec(e.spec, job.requiredSpec) &&
      (job.typeCode !== 'TOW' || !e.towClasses.length || !job.options.vehicleClass || e.towClasses.includes(job.options.vehicleClass));

    const out: Candidate[] = [];
    const origins = new Map<string, { lat: number; lng: number }>();
    for (const hit of hits) {
      const p = byId.get(hit.providerId);
      if (!p || excluded.has(p.id) || scheduledBusy.has(p.id)) continue;
      let eq: ProviderEquipment | undefined;
      if (scheduled) {
        eq = equipment.find((e) => e.providerId === p.id && fits(e));
        if (p.baseLat != null && p.baseLng != null) origins.set(p.id, { lat: p.baseLat, lng: p.baseLng });
      } else {
        if (!p.online || p.currentJobId) continue;
        eq = equipment.find((e) => e.id === p.activeEquipmentId && fits(e));
        const loc = await this.geo.getLocation(p.id);
        if (!loc || Date.now() - loc.ts > this.cfg.locationStaleMs) continue;
        origins.set(p.id, loc);
      }
      if (!eq) continue;
      out.push({
        providerId: p.id, equipmentId: eq.id, distanceKm: hit.distanceKm,
        etaSec: this.eta.estimateSec(hit.distanceKm), rating: p.rating, acceptanceRate: p.acceptanceRate,
      });
    }
    // 가까운 몇 명은 실제 길찾기로 ETA를 바꾼다 (직선으로는 가까워도 강 건너, 반대 차로일 수 있다)
    const near = [...out].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, this.eta.routeCandidates);
    await Promise.all(near.map(async (c) => {
      const from = origins.get(c.providerId);
      if (!from) return;
      const sec = await this.eta.routeSec(`${job.id}:${c.providerId}`, from, { lat: job.lat, lng: job.lng });
      if (sec != null) c.etaSec = sec;
    }));
    return rankCandidates(out, this.cfg.etaTieSec);
  }

  private async scheduledConflicts(providerIds: string[], job: Job) {
    const w = jobWindow(job);
    const booked = await this.jobs.findBy({ providerId: In(providerIds), status: In(ACTIVE), scheduledAt: Not(IsNull()) });
    return new Set(
      booked.filter((b) => { const bw = jobWindow(b); return bw.start < w.end && w.start < bw.end; }).map((b) => b.providerId!),
    );
  }

  private async raiseAlert(job: Job) {
    await this.jobs.update({ id: job.id, status: 'REQUESTED' }, { unassignedAlert: true });
    this.log.warn(`미배차 경보: ${job.id}`);
    this.rt.toAdmins('admin.alert', { jobId: job.id, typeCode: job.typeCode, lat: job.lat, lng: job.lng });
    this.rt.toAccount(job.customerId, 'job.updated', { ...job, unassignedAlert: true });
  }

  /** 이용자가 제안에 응답 */
  async respond(offerId: string, providerAccountId: string, accept: boolean) {
    const provider = await this.providers.findOneByOrFail({ accountId: providerAccountId });
    const result = await this.ds.transaction(async (m) => {
      const offer = await m.findOne(JobOffer, { where: { id: offerId, providerId: provider.id }, lock: { mode: 'pessimistic_write' } });
      if (!offer) throw new NotFoundException('없는 제안입니다');
      if (offer.status !== 'PENDING' || offer.expiresAt.getTime() <= Date.now()) throw new ConflictException('이미 마감된 제안입니다');
      offer.respondedAt = new Date();
      if (!accept) {
        offer.status = 'REJECTED';
        await m.save(offer);
        return { offer, job: null as Job | null };
      }
      const job = await m.findOne(Job, { where: { id: offer.jobId }, lock: { mode: 'pessimistic_write' } });
      if (!job || job.status !== 'REQUESTED') {
        offer.status = 'CLOSED';
        await m.save(offer);
        throw new ConflictException('이미 마감된 호출입니다');
      }
      offer.status = 'ACCEPTED';
      Object.assign(job, { status: 'MATCHED', providerId: provider.id, equipmentId: offer.equipmentId, matchedAt: new Date(), unassignedAlert: false });
      await m.save([offer, job]);
      await m.increment(Provider, { id: provider.id }, 'offersAccepted', 1);
      if (!job.scheduledAt) await m.update(Provider, { id: provider.id }, { currentJobId: job.id });
      return { offer, job };
    });

    if (!result.job) {
      this.schedule(result.offer.jobId, 0);
      return { offer: result.offer };
    }
    this.stop(result.job.id);
    if (!result.job.scheduledAt) await this.geo.removeLive(result.job.typeCode, provider.id);
    this.rt.toAccount(result.job.customerId, 'job.updated', result.job);
    return { offer: result.offer, job: result.job };
  }

  /** 배정된 이용자가 취소하면 기록을 남기고 다시 배차한다 */
  async providerCancel(job: Job, provider: Provider) {
    await this.ds.transaction(async (m) => {
      await m.update(JobOffer, { jobId: job.id, providerId: provider.id, status: 'ACCEPTED' }, { status: 'CANCELLED_BY_PROVIDER' });
      await m.update(Job, { id: job.id }, {
        status: 'REQUESTED', providerId: null, equipmentId: null, matchedAt: null, dispatchStartedAt: new Date(),
      });
      await m.increment(Provider, { id: provider.id }, 'cancelCount', 1);
      if (provider.currentJobId === job.id) await m.update(Provider, { id: provider.id }, { currentJobId: null });
    });
    const fresh = await this.jobs.findOneByOrFail({ id: job.id });
    this.rt.toAccount(job.customerId, 'job.updated', fresh);
    this.start(job.id);
    return fresh;
  }

  /** 운영자가 미배차 호출을 다시 자동 배차 */
  async restart(jobId: string) {
    const res = await this.jobs.update({ id: jobId, status: 'REQUESTED' }, { unassignedAlert: false, dispatchStartedAt: new Date() });
    if (!res.affected) throw new ConflictException('대기 중인 호출이 아닙니다');
    this.start(jobId);
  }

  /** 대기 중 제안을 모두 닫는다 (사용자 취소, 수동 배차 때) */
  async closePendingOffers(jobId: string) {
    this.stop(jobId);
    const pending = await this.offers.findBy({ jobId, status: 'PENDING' });
    for (const o of pending) {
      await this.offers.update({ id: o.id }, { status: 'CLOSED', respondedAt: new Date() });
      this.rt.toAccount(await this.accountOf(o.providerId), 'offer.closed', { offerId: o.id, reason: 'CLOSED' });
    }
  }

  private async accountOf(providerId: string) {
    const p = await this.providers.findOne({ where: { id: providerId }, select: { accountId: true } });
    return p?.accountId ?? '';
  }
}
