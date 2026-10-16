import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, ForbiddenException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

/** CUSTOMER = 사용자(장비가 필요한 사람), PROVIDER = 이용자(장비 기사·업체), ADMIN = 운영자 */
export type Role = 'CUSTOMER' | 'PROVIDER' | 'ADMIN';

export interface AuthUser {
  accountId: string;
  role: Role;
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('로그인이 필요합니다');
    let payload: { sub: string; role: Role };
    try {
      payload = this.jwt.verify(header.slice(7));
    } catch {
      throw new UnauthorizedException('로그인이 만료되었습니다');
    }
    if (!roles.includes(payload.role)) throw new ForbiddenException('권한이 없습니다');
    req.user = { accountId: payload.sub, role: payload.role } satisfies AuthUser;
    return true;
  }
}
