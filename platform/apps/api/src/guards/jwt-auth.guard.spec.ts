import { describe, it, expect } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

const context = (authorization?: string): ExecutionContext =>
  ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ headers: authorization ? { authorization } : {} }) }),
  }) as unknown as ExecutionContext;

const makeGuard = (payload: Record<string, unknown>) =>
  new JwtAuthGuard(
    { verify: async () => payload } as never, // JwtKeyService
    {} as never, // PrismaService
    { getAllAndOverride: () => false } as never, // Reflector
    {} as never // IdentityResolverService
  );

describe('JwtAuthGuard (challenge token rejection)', () => {
  it('rejects a 2FA challenge token used as an access token', async () => {
    const guard = makeGuard({ sub: 'user-1', tv: 0, purpose: 'mfa' });
    await expect(guard.canActivate(context('Bearer challenge'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a request with no bearer token', async () => {
    const guard = makeGuard({ sub: 'user-1' });
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
