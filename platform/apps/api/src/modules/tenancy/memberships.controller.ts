import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { addMemberSchema, inviteMemberSchema, listMembersQuery, memberIdParam, updateMemberSchema } from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { CurrentUser, TenantId } from '../../decorators/principal.decorator';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { MembershipsService, MembershipActor } from './memberships.service';

const actorOf = (principal: Principal): MembershipActor => ({
  userId: principal.userId,
  role: principal.role,
  platformRole: principal.platformRole,
});

@ApiTags('members')
@ApiBearerAuth()
@RequireTenant()
@RequirePermission('manage_staff')
@RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: 'members', scope: 'tenant' })
@Controller('tenants/me/members')
export class MembershipsController {
  constructor(private readonly members: MembershipsService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query(new ZodValidationPipe(listMembersQuery)) query: unknown) {
    return this.members.list(tenantId, query as never);
  }

  @Post()
  add(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(addMemberSchema)) body: unknown
  ) {
    return this.members.add(tenantId, body as never, actorOf(principal));
  }

  @Post('invites')
  invite(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(inviteMemberSchema)) body: unknown
  ) {
    return this.members.invite(tenantId, body as never, actorOf(principal));
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(updateMemberSchema)) body: unknown,
    @Param(new ZodValidationPipe(memberIdParam)) params: { id: string }
  ) {
    return this.members.update(tenantId, params.id, body as never, actorOf(principal));
  }

  @Delete(':id')
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(memberIdParam)) params: { id: string }
  ) {
    return this.members.remove(tenantId, params.id, actorOf(principal));
  }
}
