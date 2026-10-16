import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsBoolean, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Repository } from 'typeorm';
import { CatalogService } from '../catalog/catalog.service';
import { Roles } from '../common/roles';
import { DispatchService } from '../dispatch/dispatch.service';
import { Provider } from '../entities';
import { JobsService } from '../jobs/jobs.service';
import { AdminService } from './admin.service';

class VerifyDto {
  @IsBoolean() verified: boolean;
}
class AssignDto {
  @IsUUID() providerId: string;
}
class RatesDto {
  @IsObject() rates: Record<string, any>;
}
class CancelDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/** 운영자 웹 API */
@Controller('admin')
@Roles('ADMIN')
export class AdminController {
  constructor(
    @InjectRepository(Provider) private readonly providerRepo: Repository<Provider>,
    private readonly admin: AdminService,
    private readonly jobs: JobsService,
    private readonly dispatch: DispatchService,
    private readonly catalog: CatalogService,
  ) {}

  @Get('stats') stats() {
    return this.admin.stats();
  }

  /** 관제: status=active(기본) | alert(미배차 경보) | all(최근 200건) */
  @Get('jobs') list(@Query('status') status?: string, @Query('alert') alert?: string) {
    const f = alert === 'true' ? 'alert' : status === 'alert' || status === 'all' ? status : 'active';
    return this.admin.listJobs(f);
  }

  @Get('jobs/:id/candidates') candidates(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.candidates(id);
  }

  @Post('jobs/:id/assign') assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto) {
    return this.jobs.assignManually(id, dto.providerId);
  }

  @Post('jobs/:id/redispatch') async redispatch(@Param('id', ParseUUIDPipe) id: string) {
    await this.dispatch.restart(id);
    return { ok: true };
  }

  @Post('jobs/:id/cancel') cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.admin.cancel(id, dto.reason);
  }

  @Get('providers') providers(@Query('verified') verified?: string) {
    return this.admin.listProviders(verified === undefined ? undefined : verified === 'true');
  }

  /** 서류 확인 후 승인 (서류 파일 업로드는 다음 단계) */
  @Post('providers/:id/verify') async verify(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyDto) {
    await this.providerRepo.update({ id }, { verified: dto.verified, ...(dto.verified ? {} : { online: false }) });
    return this.providerRepo.findOneByOrFail({ id });
  }

  @Put('equipment-types/:code') rates(@Param('code') code: string, @Body() dto: RatesDto) {
    return this.catalog.updateRates(code, dto.rates);
  }
}
