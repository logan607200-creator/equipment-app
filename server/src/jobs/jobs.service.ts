import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CatalogService } from '../catalog/catalog.service';
import { estimateFare, FareInput } from '../catalog/fare';
import type { AuthUser } from '../common/roles';
import { DispatchService } from '../dispatch/dispatch.service';
import { GeoIndex } from '../dispatch/geo-index';
import { meetsSpec } from '../dispatch/ranking';
import { FareAdjustment, Job, JobStatus, Provider, ProviderEquipment, Rating } from '../entities';
import { PaymentsService } from '../payments/payments.service';
import { ProvidersService } from '../providers/providers.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export interface CreateJobInput {
  typeCode: string;
  lat: number;
  lng: number;
  address?: string;
  destLat?: number;
  destLng?: number;
  destAddress?: string;
  scheduledAt?: string;
  options?: FareInput['options'];
  requiredSpec?: Record<string, number>;
  memo?: string;
  /** 사람이 다쳤는지 (렉카) */
  injury?: boolean;
}

// 이용자가 바꿀 수 있는 다음 상태
const NEXT: Partial<Record<JobStatus, JobStatus[]>> = {
  MATCHED: ['EN_ROUTE'],
  EN_ROUTE: ['ARRIVED'],
  ARRIVED: ['IN_PROGRESS', 'COMPLETED'],
  IN_PROGRESS: ['COMPLETED'],
};

@Injectable()
export class JobsService {
  constructor(
    config: ConfigService,
    private readonly ds: DataSource,
    @InjectRepository(Job) private readonly jobs: Repository<Job>,
    @InjectRepository(FareAdjustment) private readonly adjustments: Repository<FareAdjustment>,
    @InjectRepository(Rating) private readonly ratings: Repository<Rating>,
    @InjectRepository(Provider) private readonly providerRepo: Repository<Provider>,
    @InjectRepository(ProviderEquipment) private readonly equipmentRepo: Repository<ProviderEquipment>,
    private readonly catalog: CatalogService,
    private readonly dispatch: DispatchService,
    private readonly providers: ProvidersService,
    private readonly payments: PaymentsService,
    private readonly geo: GeoIndex,
    private readonly rt: RealtimeGateway,
  ) {
    this.freeCancelMs = config.get<number>('freeCancelMs')!;
  }
  private readonly freeCancelMs: number;

  async estimate(input: CreateJobInput) {
    const type = await this.catalog.get(input.typeCode);
    const at = input.scheduledAt ? new Date(input.scheduledAt) : new Date();
    const destination = input.destLat != null && input.destLng != null ? { lat: input.destLat, lng: input.destLng } : null;
    return estimateFare(type, { pickup: { lat: input.lat, lng: input.lng }, destination, at, options: input.options ?? {} });
  }

  async create(customerId: string, input: CreateJobInput) {
    if (input.injury) {
      throw new BadRequestException({ code: 'CALL_119', message: '다친 사람이 있으면 먼저 119에 신고해 주세요.' });
    }
    if (input.scheduledAt && new Date(input.scheduledAt).getTime() < Date.now()) {
      throw new BadRequestException('예약 시각이 지났습니다');
    }
    if (this.payments.cardRequired && !(await this.payments.activeMethod(customerId))) {
      throw new BadRequestException({ code: 'CARD_REQUIRED', message: '결제 카드를 먼저 등록해 주세요' });
    }
    const open = await this.jobs.countBy({ customerId, status: 'REQUESTED' });
    if (open >= 3) throw new ConflictException('대기 중인 호출이 너무 많습니다');

    const estimate = await this.estimate(input);
    const job = await this.jobs.save(this.jobs.create({
      customerId, typeCode: input.typeCode, options: input.options ?? {}, requiredSpec: input.requiredSpec ?? {},
      lat: input.lat, lng: input.lng, address: input.address ?? null,
      destLat: input.destLat ?? null, destLng: input.destLng ?? null, destAddress: input.destAddress ?? null,
      memo: input.memo ?? null, scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      estimate, dispatchStartedAt: new Date(),
    }));
    this.dispatch.start(job.id);
    const safetyNotice = input.options?.highway ? '차 밖으로 나와 가드레일 바깥으로 대피하세요. 2차 사고가 가장 위험합니다.' : undefined;
    return { ...job, safetyNotice };
  }

  async listForCustomer(customerId: string) {
    return this.jobs.find({ where: { customerId }, order: { createdAt: 'DESC' }, take: 50 });
  }

  /** 호출 상세. 사용자 본인, 배정된 이용자, 운영자만 볼 수 있다. */
  async detail(user: AuthUser, id: string) {
    const job = await this.jobs.findOneBy({ id });
    if (!job) throw new NotFoundException('없는 호출입니다');
    await this.assertCanView(user, job);
    const [adjustments, provider, equipment, payment] = await Promise.all([
      this.adjustments.find({ where: { jobId: id }, order: { createdAt: 'ASC' } }),
      job.providerId ? this.providerRepo.findOneBy({ id: job.providerId }) : null,
      job.equipmentId ? this.equipmentRepo.findOneBy({ id: job.equipmentId }) : null,
      this.payments.forJob(job.id),
    ]);
    const location = job.providerId && ['MATCHED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'].includes(job.status)
      ? await this.geo.getLocation(job.providerId) : null;
    return {
      ...job,
      adjustments,
      provider: provider && { id: provider.id, companyName: provider.companyName, rating: provider.rating },
      equipment: equipment && { typeCode: equipment.typeCode, plateNo: equipment.plateNo, spec: equipment.spec },
      providerLocation: location,
      payment: payment && { status: payment.status, amount: payment.amount, kind: payment.kind, method: payment.method, failReason: payment.failReason },
    };
  }

  async cancelByCustomer(customerId: string, id: string, reason?: string) {
    const job = await this.ownedByCustomer(customerId, id);
    if (job.status === 'COMPLETED' || job.status === 'CANCELLED') throw new ConflictException('이미 끝난 호출입니다');
    if (job.status === 'IN_PROGRESS') throw new ConflictException('작업이 시작된 뒤에는 앱에서 취소할 수 없습니다. 고객센터로 연락해 주세요.');

    const type = await this.catalog.get(job.typeCode);
    // 배차 전, 또는 배차 후 무료 취소 시간 안이면서 출발 전이면 무료. 그 뒤로는 출동비를 받는다.
    const free = job.status === 'REQUESTED' ||
      (job.status === 'MATCHED' && !job.scheduledAt && Date.now() - job.matchedAt!.getTime() < this.freeCancelMs) ||
      (job.status === 'MATCHED' && !!job.scheduledAt);
    const fee = free ? 0 : type.rates.cancelFee ?? 0;

    const res = await this.jobs.update({ id, status: job.status }, { status: 'CANCELLED', cancelledBy: 'CUSTOMER', cancelFee: fee, memo: reason ? `${job.memo ?? ''}\n[취소 사유] ${reason}`.trim() : job.memo });
    if (!res.affected) throw new ConflictException('호출 상태가 바뀌었습니다. 다시 시도해 주세요.');
    await this.dispatch.closePendingOffers(id);
    const fresh = await this.jobs.findOneByOrFail({ id });
    if (job.providerId) {
      await this.providers.releaseFromJob(job.providerId, id);
      if (fee > 0) await this.payments.capture(fresh, fee, 'CANCEL_FEE');
      await this.notifyProvider(job.providerId, fresh);
    }
    return fresh;
  }

  /** 이용자가 진행 상태를 올린다: 출발 → 도착 → 작업 중 → 완료 */
  async advance(providerAccountId: string, id: string, to: JobStatus) {
    const provider = await this.providers.byAccount(providerAccountId);
    const job = await this.assignedTo(provider, id);
    if (!NEXT[job.status]?.includes(to)) throw new ConflictException(`${job.status}에서 ${to}로 바꿀 수 없습니다`);

    if (to === 'EN_ROUTE') await this.providers.occupyForJob(provider, job);
    const patch: Partial<Job> = { status: to };
    if (to === 'ARRIVED') patch.arrivedAt = new Date();
    if (to === 'COMPLETED') {
      if (await this.adjustments.existsBy({ jobId: id, status: 'PENDING' })) {
        throw new ConflictException('사용자가 아직 승인하지 않은 추가 요금이 있습니다');
      }
      const approved = await this.adjustments.findBy({ jobId: id, status: 'APPROVED' });
      patch.finalFare = job.estimate.amount + approved.reduce((s, a) => s + a.amount, 0);
      patch.completedAt = new Date();
    }
    const res = await this.jobs.update({ id, status: job.status }, patch);
    if (!res.affected) throw new ConflictException('호출 상태가 바뀌었습니다. 다시 시도해 주세요.');
    const fresh = await this.jobs.findOneByOrFail({ id });
    if (to === 'COMPLETED') {
      await this.payments.capture(fresh, fresh.finalFare!);
      await this.providers.releaseFromJob(provider.id, id);
    }
    this.rt.toAccount(fresh.customerId, 'job.updated', fresh);
    return fresh;
  }

  async cancelByProvider(providerAccountId: string, id: string) {
    const provider = await this.providers.byAccount(providerAccountId);
    const job = await this.assignedTo(provider, id);
    if (!['MATCHED', 'EN_ROUTE', 'ARRIVED'].includes(job.status)) throw new ConflictException('지금은 취소할 수 없습니다');
    const fresh = await this.dispatch.providerCancel(job, provider);
    await this.providers.releaseFromJob(provider.id, id);
    return fresh;
  }

  /** 현장 추가 요금 요청 (사용자 승인 전에는 청구되지 않는다) */
  async requestAdjustment(providerAccountId: string, id: string, amount: number, reason: string) {
    const provider = await this.providers.byAccount(providerAccountId);
    const job = await this.assignedTo(provider, id);
    if (!['ARRIVED', 'IN_PROGRESS'].includes(job.status)) throw new ConflictException('현장 도착 후에 요청할 수 있습니다');
    if (!reason?.trim()) throw new BadRequestException('사유를 적어 주세요');
    const adj = await this.adjustments.save(this.adjustments.create({ jobId: id, amount: Math.round(amount), reason: reason.trim() }));
    this.rt.toAccount(job.customerId, 'adjustment.requested', adj);
    return adj;
  }

  async decideAdjustment(customerId: string, id: string, adjId: string, approve: boolean) {
    const job = await this.ownedByCustomer(customerId, id);
    const res = await this.adjustments.update(
      { id: adjId, jobId: id, status: 'PENDING' },
      { status: approve ? 'APPROVED' : 'REJECTED', decidedAt: new Date() },
    );
    if (!res.affected) throw new ConflictException('이미 처리된 요청입니다');
    const adj = await this.adjustments.findOneByOrFail({ id: adjId });
    if (job.providerId) await this.notifyProvider(job.providerId, { ...job, adjustment: adj });
    return adj;
  }

  async rate(customerId: string, id: string, score: number, comment?: string) {
    const job = await this.ownedByCustomer(customerId, id);
    if (job.status !== 'COMPLETED' || !job.providerId) throw new ConflictException('완료된 호출만 평가할 수 있습니다');
    if (await this.ratings.existsBy({ jobId: id })) throw new ConflictException('이미 평가했습니다');
    return this.ds.transaction(async (m) => {
      const r = await m.save(m.create(Rating, { jobId: id, providerId: job.providerId!, score, comment: comment ?? null }));
      await m.increment(Provider, { id: job.providerId! }, 'ratingSum', score);
      await m.increment(Provider, { id: job.providerId! }, 'ratingCount', 1);
      return r;
    });
  }

  /** 운영자 수동 배차 */
  async assignManually(id: string, providerId: string) {
    const job = await this.jobs.findOneBy({ id });
    if (!job || job.status !== 'REQUESTED') throw new ConflictException('대기 중인 호출이 아닙니다');
    const provider = await this.providerRepo.findOneBy({ id: providerId, verified: true });
    if (!provider) throw new NotFoundException('확인된 이용자가 아닙니다');
    const eqs = await this.equipmentRepo.findBy({ providerId, typeCode: job.typeCode, active: true });
    const eq = eqs.find((e) => meetsSpec(e.spec, job.requiredSpec));
    if (!eq) throw new ConflictException('이 호출에 맞는 장비가 없는 이용자입니다');
    if (!job.scheduledAt && provider.currentJobId) throw new ConflictException('다른 작업 중인 이용자입니다');

    await this.dispatch.closePendingOffers(id);
    const res = await this.jobs.update({ id, status: 'REQUESTED' }, {
      status: 'MATCHED', providerId, equipmentId: eq.id, matchedAt: new Date(), unassignedAlert: false,
    });
    if (!res.affected) throw new ConflictException('호출 상태가 바뀌었습니다');
    const fresh = await this.jobs.findOneByOrFail({ id });
    if (!job.scheduledAt) await this.providers.occupyForJob(provider, fresh);
    this.rt.toAccount(fresh.customerId, 'job.updated', fresh);
    await this.notifyProvider(providerId, fresh);
    return fresh;
  }

  private async notifyProvider(providerId: string, data: unknown) {
    const p = await this.providerRepo.findOne({ where: { id: providerId }, select: { accountId: true } });
    if (p) this.rt.toAccount(p.accountId, 'job.updated', data);
  }

  private async ownedByCustomer(customerId: string, id: string) {
    const job = await this.jobs.findOneBy({ id, customerId });
    if (!job) throw new NotFoundException('없는 호출입니다');
    return job;
  }

  private async assignedTo(provider: Provider, id: string) {
    const job = await this.jobs.findOneBy({ id, providerId: provider.id });
    if (!job) throw new NotFoundException('배정된 호출이 아닙니다');
    return job;
  }

  private async assertCanView(user: AuthUser, job: Job) {
    if (user.role === 'ADMIN') return;
    if (user.role === 'CUSTOMER' && job.customerId === user.accountId) return;
    if (user.role === 'PROVIDER') {
      const p = await this.providers.byAccount(user.accountId);
      if (job.providerId === p.id) return;
    }
    throw new ForbiddenException('볼 수 없는 호출입니다');
  }
}
