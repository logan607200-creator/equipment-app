import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { CatalogService } from '../catalog/catalog.service';
import { GeoIndex } from '../dispatch/geo-index';
import { Job, JobOffer, Payment, Provider, ProviderEquipment } from '../entities';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class ProvidersService {
  constructor(
    @InjectRepository(Provider) private readonly providers: Repository<Provider>,
    @InjectRepository(ProviderEquipment) private readonly equipment: Repository<ProviderEquipment>,
    @InjectRepository(JobOffer) private readonly offers: Repository<JobOffer>,
    @InjectRepository(Job) private readonly jobs: Repository<Job>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly catalog: CatalogService,
    private readonly geo: GeoIndex,
    @Inject(forwardRef(() => RealtimeGateway)) private readonly rt: RealtimeGateway,
  ) {}

  async byAccount(accountId: string) {
    const p = await this.providers.findOneBy({ accountId });
    if (!p) throw new NotFoundException('이용자 정보가 없습니다');
    return p;
  }

  async me(accountId: string) {
    const p = await this.byAccount(accountId);
    const equipment = await this.equipment.findBy({ providerId: p.id, active: true });
    return { ...p, rating: p.rating, acceptanceRate: p.acceptanceRate, equipment };
  }

  async updateProfile(accountId: string, dto: { companyName?: string; bizRegNo?: string; baseLat?: number; baseLng?: number }) {
    const p = await this.byAccount(accountId);
    Object.assign(p, dto);
    await this.providers.save(p);
    await this.reindexBase(p);
    return p;
  }

  async addEquipment(accountId: string, dto: { typeCode: string; plateNo?: string; spec?: Record<string, number>; towClasses?: string[] }) {
    const p = await this.byAccount(accountId);
    const type = await this.catalog.get(dto.typeCode);
    const spec = dto.spec ?? {};
    const unknown = Object.keys(spec).filter((k) => !type.specKeys.includes(k));
    if (unknown.length) throw new BadRequestException(`${type.name}에 없는 규격 항목입니다: ${unknown.join(', ')}`);
    const e = await this.equipment.save(this.equipment.create({
      providerId: p.id, typeCode: type.code, plateNo: dto.plateNo ?? null, spec, towClasses: dto.towClasses ?? [],
    }));
    await this.reindexBase(p);
    return e;
  }

  /** 출근: 어떤 장비로 일할지 고른다. 이후 보내는 위치로 즉시 호출을 받는다. */
  async goOnline(accountId: string, equipmentId: string) {
    const p = await this.byAccount(accountId);
    if (!p.verified) throw new ConflictException('운영자 서류 확인 후에 출근할 수 있습니다');
    const eq = await this.equipment.findOneBy({ id: equipmentId, providerId: p.id, active: true });
    if (!eq) throw new NotFoundException('등록된 장비가 아닙니다');
    if (p.activeEquipmentId && p.activeEquipmentId !== eq.id) await this.dropLive(p);
    p.online = true;
    p.activeEquipmentId = eq.id;
    await this.providers.save(p);
    const loc = await this.geo.getLocation(p.id);
    if (loc && !p.currentJobId) await this.geo.addLive(eq.typeCode, p.id, loc.lat, loc.lng);
    return p;
  }

  async goOffline(accountId: string) {
    const p = await this.byAccount(accountId);
    await this.dropLive(p);
    p.online = false;
    await this.providers.save(p);
    return p;
  }

  async updateLocation(accountId: string, loc: { lat: number; lng: number; heading?: number }) {
    const p = await this.byAccount(accountId);
    await this.geo.saveLocation(p.id, loc.lat, loc.lng, loc.heading);
    if (p.online && p.activeEquipmentId && !p.currentJobId) {
      const eq = await this.equipment.findOneBy({ id: p.activeEquipmentId });
      if (eq) await this.geo.addLive(eq.typeCode, p.id, loc.lat, loc.lng);
    }
    if (p.currentJobId) {
      const job = await this.jobs.findOne({ where: { id: p.currentJobId }, select: { id: true, customerId: true } });
      if (job) this.rt.toAccount(job.customerId, 'provider.location', { jobId: job.id, ...loc, ts: Date.now() });
    }
    return { ok: true };
  }

  /** 일이 끝나면 다시 즉시 호출 후보로 올린다 */
  async releaseFromJob(providerId: string, jobId: string) {
    await this.providers.update({ id: providerId, currentJobId: jobId }, { currentJobId: null });
    const p = await this.providers.findOneBy({ id: providerId });
    if (!p?.online || !p.activeEquipmentId || p.currentJobId) return;
    const [eq, loc] = await Promise.all([this.equipment.findOneBy({ id: p.activeEquipmentId }), this.geo.getLocation(p.id)]);
    if (eq && loc) await this.geo.addLive(eq.typeCode, p.id, loc.lat, loc.lng);
  }

  async occupyForJob(provider: Provider, job: Job) {
    if (provider.currentJobId && provider.currentJobId !== job.id) throw new ConflictException('진행 중인 다른 작업이 있습니다');
    await this.providers.update({ id: provider.id }, { currentJobId: job.id });
    await this.dropLive(provider);
  }

  async pendingOffers(accountId: string) {
    const p = await this.byAccount(accountId);
    return this.offers.find({ where: { providerId: p.id, status: 'PENDING', expiresAt: MoreThan(new Date()) }, order: { createdAt: 'DESC' } });
  }

  async jobsOf(accountId: string) {
    const p = await this.byAccount(accountId);
    return this.jobs.find({ where: { providerId: p.id }, order: { createdAt: 'DESC' }, take: 50 });
  }

  /** 정산 요약: 완료 건 매출, 수수료, 지급 예정액 */
  async earnings(accountId: string, from?: Date, to?: Date) {
    const p = await this.byAccount(accountId);
    const qb = this.payments.createQueryBuilder('pay').where('pay.providerId = :id', { id: p.id }).andWhere("pay.status = 'CAPTURED'");
    if (from) qb.andWhere('pay.createdAt >= :from', { from });
    if (to) qb.andWhere('pay.createdAt < :to', { to });
    const rows = await qb.orderBy('pay.createdAt', 'DESC').getMany();
    const sum = (k: 'amount' | 'commission' | 'providerPayout') => rows.reduce((s, r) => s + r[k], 0);
    return { count: rows.length, gross: sum('amount'), commission: sum('commission'), payout: sum('providerPayout'), payments: rows };
  }

  private async dropLive(p: Provider) {
    if (!p.activeEquipmentId) return;
    const eq = await this.equipment.findOneBy({ id: p.activeEquipmentId });
    if (eq) await this.geo.removeLive(eq.typeCode, p.id);
  }

  private async reindexBase(p: Provider) {
    if (p.baseLat == null || p.baseLng == null) return;
    const types = [...new Set((await this.equipment.findBy({ providerId: p.id, active: true })).map((e) => e.typeCode))];
    await this.geo.setBase(types, p.id, p.baseLat, p.baseLng);
  }
}
