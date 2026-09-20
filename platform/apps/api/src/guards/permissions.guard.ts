import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { getRequestStore } from '../context/tenant-context';

const PRIVILEGED_ROLES = new Set(['owner', 'manager']);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const principal = getRequestStore()?.principal;
    if (!principal) throw new UnauthorizedException('Not authenticated');
    if (principal.platformRole) return true;
    if (principal.role && PRIVILEGED_ROLES.has(principal.role)) return true;

    const has = required.every((p) => principal.permissions.includes(p));
    if (!has) throw new ForbiddenException(`Access denied. Missing permission: ${required.join(', ')}`);
    return true;
  }
}
