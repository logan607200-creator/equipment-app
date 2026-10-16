import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { IsArray, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { CurrentUser, Roles, type AuthUser } from '../common/roles';
import { DispatchService } from '../dispatch/dispatch.service';
import { ProvidersService } from './providers.service';

class ProfileDto {
  @IsOptional() @IsString() companyName?: string;
  @IsOptional() @IsString() bizRegNo?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) baseLat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) baseLng?: number;
}

class EquipmentDto {
  @IsString() typeCode: string;
  @IsOptional() @IsString() plateNo?: string;
  @IsOptional() @IsObject() spec?: Record<string, number>;
  @IsOptional() @IsArray() towClasses?: string[];
}

class OnlineDto {
  @IsUUID() equipmentId: string;
}

class LocationDto {
  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lng: number;
  @IsOptional() @IsNumber() heading?: number;
}

/** 이용자(공급자) 앱 API */
@Controller('provider')
@Roles('PROVIDER')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService, private readonly dispatch: DispatchService) {}

  @Get('me') me(@CurrentUser() u: AuthUser) {
    return this.providers.me(u.accountId);
  }

  @Put('me') profile(@CurrentUser() u: AuthUser, @Body() dto: ProfileDto) {
    return this.providers.updateProfile(u.accountId, dto);
  }

  @Post('equipment') addEquipment(@CurrentUser() u: AuthUser, @Body() dto: EquipmentDto) {
    return this.providers.addEquipment(u.accountId, dto);
  }

  @Post('online') online(@CurrentUser() u: AuthUser, @Body() dto: OnlineDto) {
    return this.providers.goOnline(u.accountId, dto.equipmentId);
  }

  @Post('offline') offline(@CurrentUser() u: AuthUser) {
    return this.providers.goOffline(u.accountId);
  }

  @Post('location') location(@CurrentUser() u: AuthUser, @Body() dto: LocationDto) {
    return this.providers.updateLocation(u.accountId, dto);
  }

  @Get('offers') offers(@CurrentUser() u: AuthUser) {
    return this.providers.pendingOffers(u.accountId);
  }

  @Post('offers/:id/accept') accept(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.dispatch.respond(id, u.accountId, true);
  }

  @Post('offers/:id/reject') reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.dispatch.respond(id, u.accountId, false);
  }

  @Get('jobs') jobs(@CurrentUser() u: AuthUser) {
    return this.providers.jobsOf(u.accountId);
  }

  @Get('earnings') earnings(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.providers.earnings(u.accountId, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }
}
