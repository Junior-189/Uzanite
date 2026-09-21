import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { recycleBinItemParam } from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { CurrentUser, TenantId } from '../../decorators/principal.decorator';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { RecycleBinService, RecycleBinType } from './recycle-bin.service';

@ApiTags('recycle-bin')
@ApiBearerAuth()
@RequireTenant()
@RequirePermission('recycle_bin')
@RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: 'recycle-bin' })
@Controller('recycle-bin')
export class RecycleBinController {
  constructor(private readonly recycleBin: RecycleBinService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.recycleBin.list(tenantId);
  }

  @Post('restore/:type/:id')
  restore(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(recycleBinItemParam)) params: { type: RecycleBinType; id: string }
  ) {
    return this.recycleBin.restore(tenantId, params.type, params.id, principal.userId);
  }

  @Delete(':type/:id')
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(recycleBinItemParam)) params: { type: RecycleBinType; id: string }
  ) {
    return this.recycleBin.removePermanent(tenantId, params.type, params.id, principal.userId);
  }
}
