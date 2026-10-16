import { BadRequestException, Body, Controller, ForbiddenException, Injectable, Logger, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsIn, IsString, Matches } from 'class-validator';
import { randomInt } from 'crypto';
import { Repository } from 'typeorm';
import { RedisService } from '../common/redis';
import type { Role } from '../common/roles';
import { Account, Provider } from '../entities';

class OtpRequestDto {
  @Matches(/^01[0-9]{8,9}$/, { message: '휴대폰 번호 형식이 아닙니다' }) phone: string;
}

class OtpVerifyDto {
  @Matches(/^01[0-9]{8,9}$/) phone: string;
  @IsString() code: string;
  @IsIn(['CUSTOMER', 'PROVIDER', 'ADMIN']) role: Role;
}

@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');

  constructor(
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Provider) private readonly providers: Repository<Provider>,
  ) {}

  async requestOtp(phone: string) {
    const devCode = this.config.get<string | undefined>('otp.devCode');
    const code = devCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.redis.client.set(this.redis.key('otp', phone), code, 'EX', this.config.get<number>('otp.ttlSec')!);
    // TODO: SMS 발송 업체(NHN Cloud, 알리고 등) 연동. 지금은 로그로만 남긴다.
    if (!devCode) this.log.log(`OTP for ${phone.slice(0, 3)}****: ${code}`);
    return { sent: true };
  }

  async verifyOtp(phone: string, code: string, role: Role) {
    const key = this.redis.key('otp', phone);
    const stored = await this.redis.client.get(key);
    if (!stored || stored !== code) throw new BadRequestException('인증번호가 맞지 않습니다');
    await this.redis.client.del(key);
    if (role === 'ADMIN' && !this.config.get<string[]>('adminPhones')!.includes(phone)) {
      throw new ForbiddenException('운영자로 등록된 번호가 아닙니다');
    }
    let account = await this.accounts.findOneBy({ phone, role });
    if (!account) account = await this.accounts.save(this.accounts.create({ phone, role }));
    if (role === 'PROVIDER' && !(await this.providers.existsBy({ accountId: account.id }))) {
      await this.providers.save(this.providers.create({ accountId: account.id }));
    }
    const token = this.jwt.sign({ sub: account.id, role });
    return { token, account };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('otp/request')
  request(@Body() dto: OtpRequestDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Post('otp/verify')
  verify(@Body() dto: OtpVerifyDto) {
    return this.auth.verifyOtp(dto.phone, dto.code, dto.role);
  }
}
