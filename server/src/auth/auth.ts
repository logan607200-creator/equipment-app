import { BadRequestException, HttpException, HttpStatus, Body, Controller, ForbiddenException, Injectable, Logger, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsIn, IsString, Matches } from 'class-validator';
import { randomInt } from 'crypto';
import { Repository } from 'typeorm';
import { RedisService } from '../common/redis';
import type { Role } from '../common/roles';
import { Account, Provider } from '../entities';
import { SmsService } from '../integrations/sms';

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
    private readonly sms: SmsService,
  ) {}

  private get otpCfg() {
    return this.config.get<{ devCode?: string; ttlSec: number; resendSec: number; maxPerHour: number; maxAttempts: number }>('otp')!;
  }

  async requestOtp(phone: string) {
    const { devCode, ttlSec, resendSec, maxPerHour } = this.otpCfg;
    const r = this.redis.client;
    if (!devCode) {
      // 문자 비용과 남용을 막는다: 재발송 간격, 시간당 횟수
      if (!(await r.set(this.redis.key('otp-cool', phone), '1', 'EX', resendSec, 'NX'))) {
        throw new HttpException(`${resendSec}초 뒤에 다시 요청해 주세요`, HttpStatus.TOO_MANY_REQUESTS);
      }
      const hourKey = this.redis.key('otp-hour', phone);
      const count = await r.incr(hourKey);
      if (count === 1) await r.expire(hourKey, 3600);
      if (count > maxPerHour) throw new HttpException('인증 요청이 너무 많아요. 한 시간 뒤에 다시 시도해 주세요', HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = devCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    await r.set(this.redis.key('otp', phone), code, 'EX', ttlSec);
    await r.del(this.redis.key('otp-try', phone));
    if (!devCode) {
      try {
        await this.sms.send(phone, `[장비호출] 인증번호 ${code}를 입력해 주세요. 3분 안에 입력해야 해요.`);
      } catch (e) {
        this.log.error(`SMS failed: ${(e as Error).message}`);
        await r.del(this.redis.key('otp-cool', phone));
        throw new HttpException('문자를 보내지 못했어요. 잠시 후 다시 시도해 주세요', HttpStatus.BAD_GATEWAY);
      }
    }
    return { sent: true, ttlSec };
  }

  async verifyOtp(phone: string, code: string, role: Role) {
    const key = this.redis.key('otp', phone);
    const stored = await this.redis.client.get(key);
    if (!stored) throw new BadRequestException('인증번호가 만료됐어요. 다시 받아 주세요');
    if (stored !== code) {
      // 틀린 번호를 여러 번 넣으면 인증번호를 없앤다 (무작위 대입 방지)
      const tries = await this.redis.client.incr(this.redis.key('otp-try', phone));
      await this.redis.client.expire(this.redis.key('otp-try', phone), this.otpCfg.ttlSec);
      if (tries >= this.otpCfg.maxAttempts) {
        await this.redis.client.del(key);
        throw new BadRequestException('여러 번 틀려서 인증번호가 취소됐어요. 다시 받아 주세요');
      }
      throw new BadRequestException('인증번호가 맞지 않습니다');
    }
    await this.redis.client.del(key, this.redis.key('otp-try', phone));
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
