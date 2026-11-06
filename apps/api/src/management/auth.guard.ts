import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

export interface Principal { userId: string; sessionId: string }
interface AuthRequest { headers: { authorization?: string }; principal?: Principal }

export function bearerToken(header?: string): string {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(header ?? '');
  if (!match) throw new UnauthorizedException('A valid Bearer token is required');
  return match[1];
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    request.principal = await this.auth.authenticate(bearerToken(request.headers.authorization));
    return true;
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): Principal => {
  return context.switchToHttp().getRequest<AuthRequest>().principal!;
});
