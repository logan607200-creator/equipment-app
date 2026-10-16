import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsObject, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';
import { CurrentUser, Roles, type AuthUser } from '../common/roles';
import type { JobStatus } from '../entities';
import { JobsService } from './jobs.service';

class JobDto {
  @IsString() typeCode: string;
  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lng: number;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsNumber() destLat?: number;
  @IsOptional() @IsNumber() destLng?: number;
  @IsOptional() @IsString() destAddress?: string;
  @IsOptional() @IsISO8601() scheduledAt?: string;
  @IsOptional() @IsObject() options?: Record<string, any>;
  @IsOptional() @IsObject() requiredSpec?: Record<string, number>;
  @IsOptional() @IsString() @MaxLength(500) memo?: string;
  @IsOptional() @IsBoolean() injury?: boolean;
}

class CancelDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

class RatingDto {
  @IsInt() @Min(1) @Max(5) score: number;
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

class StatusDto {
  @IsIn(['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED']) status: JobStatus;
}

class AdjustmentDto {
  @IsInt() @Min(-10_000_000) @Max(10_000_000) amount: number;
  @IsString() @MaxLength(300) reason: string;
}

/** 사용자(수요자) 앱 API */
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  /** 로그인 전에도 요금을 미리 볼 수 있다 */
  @Post('estimate') estimate(@Body() dto: JobDto) {
    return this.jobs.estimate(dto);
  }

  @Post() @Roles('CUSTOMER') create(@CurrentUser() u: AuthUser, @Body() dto: JobDto) {
    return this.jobs.create(u.accountId, dto);
  }

  @Get() @Roles('CUSTOMER') mine(@CurrentUser() u: AuthUser) {
    return this.jobs.listForCustomer(u.accountId);
  }

  @Get(':id') @Roles('CUSTOMER', 'PROVIDER', 'ADMIN') detail(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.detail(u, id);
  }

  @Post(':id/cancel') @Roles('CUSTOMER') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.jobs.cancelByCustomer(u.accountId, id, dto.reason);
  }

  @Post(':id/adjustments/:adjId/approve') @Roles('CUSTOMER')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('adjId', ParseUUIDPipe) adjId: string) {
    return this.jobs.decideAdjustment(u.accountId, id, adjId, true);
  }

  @Post(':id/adjustments/:adjId/reject') @Roles('CUSTOMER')
  rejectAdj(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('adjId', ParseUUIDPipe) adjId: string) {
    return this.jobs.decideAdjustment(u.accountId, id, adjId, false);
  }

  @Post(':id/rating') @Roles('CUSTOMER') rate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RatingDto) {
    return this.jobs.rate(u.accountId, id, dto.score, dto.comment);
  }
}

/** 이용자(공급자) 앱의 작업 진행 API */
@Controller('provider/jobs')
@Roles('PROVIDER')
export class ProviderJobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post(':id/status') status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) {
    return this.jobs.advance(u.accountId, id, dto.status);
  }

  @Post(':id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.cancelByProvider(u.accountId, id);
  }

  @Post(':id/adjustments') adjust(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdjustmentDto) {
    return this.jobs.requestAdjustment(u.accountId, id, dto.amount, dto.reason);
  }
}
