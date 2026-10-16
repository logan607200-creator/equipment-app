import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsBoolean, IsObject, IsUUID } from 'class-validator';
import { In, Repository } from 'typeorm';
import { CatalogService } from '../catalog/catalog.service';
import { Roles } from '../common/roles';
import { DispatchService } from '../dispatch/dispatch.service';
import { Job, Provider } from '../entities';
import { JobsService } from '../jobs/jobs.service';

class VerifyDto {
  @IsBoolean() verified: boolean;
}
class AssignDto {
  @IsUUID() providerId: string;
}
class RatesDto {
  @IsObject() rates: Record<string, any>;
}

/** 운영자 웹 API */
@Controller('admin')
@Roles('ADMIN')
export class AdminController {
  constructor(
    @InjectRepository(Job) private readonly jobRepo: Repository<Job>,
    @InjectRepository(Provider) private readonly providerRepo: Repository<Provider>,
    private readonly jobs: JobsService,
    private readonly dispatch: DispatchService,
    private readonly catalog: CatalogService,
  ) {}

  /** 관제: 진행 중 호출 (alert=true 면 미배차 경보만) */
  @Get('jobs') list(@Query('alert') alert?: string) {
    return this.jobRepo.find({
      where: alert === 'true'
        ? { unassignedAlert: true, status: 'REQUESTED' }
        : { status: In(['REQUESTED', 'MATCHED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS']) },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  @Post('jobs/:id/assign') assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto) {
    return this.jobs.assignManually(id, dto.providerId);
  }

  @Post('jobs/:id/redispatch') async redispatch(@Param('id', ParseUUIDPipe) id: string) {
    await this.dispatch.restart(id);
    return { ok: true };
  }

  @Get('providers') providers(@Query('verified') verified?: string) {
    return this.providerRepo.find({
      where: verified === undefined ? {} : { verified: verified === 'true' },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  /** 서류 확인 후 승인 (서류 파일 업로드는 다음 단계) */
  @Post('providers/:id/verify') async verify(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyDto) {
    await this.providerRepo.update({ id }, { verified: dto.verified });
    return this.providerRepo.findOneByOrFail({ id });
  }

  @Put('equipment-types/:code') rates(@Param('code') code: string, @Body() dto: RatesDto) {
    return this.catalog.updateRates(code, dto.rates);
  }
}
