import { BadRequestException, BadGatewayException, Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { CurrentUser, Roles, type AuthUser } from '../common/roles';
import { PushService } from './fcm';
import { KakaoService } from './kakao';

class PushTokenDto {
  @IsString() @MaxLength(4096) token: string;
  @IsIn(['android', 'ios', 'web']) platform: string;
}

/** 앱이 로그인 뒤 푸시 토큰을 등록한다. 로그아웃할 때 지운다. */
@Controller('me/push-tokens')
export class PushTokenController {
  constructor(private readonly push: PushService) {}

  @Post() @Roles('CUSTOMER', 'PROVIDER', 'ADMIN') add(@CurrentUser() u: AuthUser, @Body() dto: PushTokenDto) {
    return this.push.register(u.accountId, dto.token, dto.platform).then(() => ({ ok: true, enabled: this.push.enabled }));
  }

  @Delete() @Roles('CUSTOMER', 'PROVIDER', 'ADMIN') remove(@CurrentUser() u: AuthUser, @Body() dto: PushTokenDto) {
    return this.push.unregister(u.accountId, dto.token).then(() => ({ ok: true }));
  }
}

const num = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v));

/** 주소 검색. 카카오 키가 없으면 빈 결과와 enabled=false 를 돌려준다. */
@Controller('geo')
export class GeoController {
  constructor(private readonly kakao: KakaoService) {}

  @Get('search') @Roles('CUSTOMER', 'PROVIDER', 'ADMIN')
  async search(@Query('q') q?: string, @Query('lat') lat?: string, @Query('lng') lng?: string) {
    const query = (q ?? '').trim();
    if (query.length < 2) throw new BadRequestException('두 글자 이상 입력해 주세요');
    if (!this.kakao.enabled) return { enabled: false, places: [] };
    const near = num(lat) !== undefined && num(lng) !== undefined ? { lat: num(lat)!, lng: num(lng)! } : undefined;
    const places = await this.kakao.search(query.slice(0, 100), near).catch(() => {
      throw new BadGatewayException('주소 검색이 잠시 안 돼요. 잠시 후 다시 시도해 주세요');
    });
    return { enabled: true, places };
  }

  @Get('reverse') @Roles('CUSTOMER', 'PROVIDER', 'ADMIN')
  async reverse(@Query('lat') lat: string, @Query('lng') lng: string) {
    const la = num(lat), ln = num(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) throw new BadRequestException('좌표가 필요합니다');
    if (!this.kakao.enabled) return { enabled: false, address: null };
    const r = await this.kakao.reverse(la!, ln!).catch(() => null);
    return { enabled: true, address: r?.roadAddress ?? r?.address ?? null, jibunAddress: r?.address ?? null };
  }
}
