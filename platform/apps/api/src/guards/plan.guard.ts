import { CanActivate, ExecutionContext, ForbiddenException, Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLAN_FEATURE_KEY, PLAN_LIMIT_KEY } from '../decorators/plan.decorator';
import { getRequestStore } from '../context/tenant-context';
import { BillingService } from '../modules/billing/billing.service';

// Enforces plan features and usage limits when a route opts in via decorators.
@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly billing: BillingService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const principal = getRequestStore()?.principal;
    if (!principal) return true;
    if (principal.platformRole) return true;

    const feature = this.reflector.getAllAndOverride<string>(PLAN_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const limitMetric = this.reflector.getAllAndOverride<string>(PLAN_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature && !limitMetric) return true;
    if (!principal.tenantId) throw new ForbiddenException('Tenant context required');

    // Guard-safe (bypass transaction): guards run before the request tx.
    const status = await this.billing.getStatusForGuard(principal.tenantId);

    if (feature && !this.billing.hasFeature(status, feature)) {
      throw new ForbiddenException(`Your plan does not include "${feature}". Upgrade to continue.`);
    }

    if (limitMetric) {
      const check = await this.billing.checkLimit(principal.tenantId, limitMetric);
      if (!check.allowed) {
        throw new HttpException(
          {
            success: false,
            error: `Plan limit reached for ${limitMetric} (${check.current}/${check.limit}). Upgrade to continue.`,
            limit: { metric: limitMetric, current: check.current, max: check.limit },
          },
          HttpStatus.PAYMENT_REQUIRED
        );
      }
    }

    return true;
  }
}
