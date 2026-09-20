import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  featureFlagIdParam,
  listFeatureFlagsQuery,
  upsertFeatureFlagSchema,
  type ListFeatureFlagsQuery,
  type UpsertFeatureFlagInput,
} from '@uzanite/contracts';
import { CurrentUser } from '../../decorators/principal.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { FeatureFlagsService } from './feature-flags.service';

function assertPlatformAdmin(principal: Principal): void {
  if (!principal?.platformRole) throw new ForbiddenException('Platform admin only');
}

@ApiTags('admin')
@ApiBearerAuth()
@RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: 'admin:flags', scope: 'user' })
@Controller('admin/feature-flags')
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get()
  list(
    @CurrentUser() principal: Principal,
    @Query(new ZodValidationPipe(listFeatureFlagsQuery)) query: ListFeatureFlagsQuery
  ) {
    assertPlatformAdmin(principal);
    return this.flags.list(query);
  }

  @Post()
  upsert(
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(upsertFeatureFlagSchema)) body: UpsertFeatureFlagInput
  ) {
    assertPlatformAdmin(principal);
    return this.flags.upsert(body);
  }

  @Delete(':id')
  remove(
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(featureFlagIdParam)) params: { id: string }
  ) {
    assertPlatformAdmin(principal);
    return this.flags.remove(params.id);
  }
}
