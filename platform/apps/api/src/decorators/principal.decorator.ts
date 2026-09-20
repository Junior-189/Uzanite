import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { getRequestStore, Principal } from '../context/tenant-context';

export const CurrentUser = createParamDecorator((_data: unknown, _ctx: ExecutionContext): Principal | null => {
  return getRequestStore()?.principal ?? null;
});

export const TenantId = createParamDecorator((_data: unknown, _ctx: ExecutionContext): string | null => {
  return getRequestStore()?.tenantId ?? null;
});
