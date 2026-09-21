import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AcceptInviteInput,
  AddMemberInput,
  defaultPermissionsFor,
  InviteMemberInput,
  isOwnerOnlyPermission,
  ListMembersQuery,
  UpdateMemberInput,
} from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { UnitOfWorkService } from '../../prisma/unit-of-work.service';
import { OutboxService } from '../../outbox/outbox.service';
import { CacheService } from '../../cache/cache.service';
import { BillingService } from '../billing/billing.service';
import { assertPasswordPolicy, hashPassword } from '../../security/password';
import { randomToken, sha256 } from '../../crypto/crypto';
import { newId } from '../../ids/id';
import { blindIndex, decryptPii, encryptPii } from '../../security/pii';
import { paginate } from '../../pagination/pagination';

export interface MembershipActor {
  userId: string;
  role: string | null;
  platformRole: string | null;
}

const MEMBER_INCLUDE = {
  user: { select: { id: true, name: true, email: true, status: true, platformRole: true } },
} as const;

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Membership / staff foundation. Manages which users belong to a tenant and with
 * what role/permissions. Only owners (or platform admins) may grant the `owner`
 * role or the owner-only permissions; the last active owner cannot be demoted or
 * removed. Role defaults are applied when permissions are omitted.
 */
@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWorkService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
    private readonly billing: BillingService
  ) {}

  async list(tenantId: string, query: ListMembersQuery) {
    const page = await paginate<{ id: string }>({
      findMany: (args) =>
        this.prisma.db.membership.findMany({ ...(args as object), include: MEMBER_INCLUDE } as never) as Promise<
          { id: string }[]
        >,
      where: { tenantId },
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    const members = (page.items as Array<{ user?: { email?: string } }>).map((m) =>
      m.user ? { ...m, user: { ...m.user, email: decryptPii(m.user.email) } } : m
    );
    return { success: true, count: members.length, members, nextCursor: page.nextCursor };
  }

  /** Decrypts the member's user email for API output. */
  private memberOut<T extends { user?: { email?: string | null } }>(member: T): T {
    return member?.user ? { ...member, user: { ...member.user, email: decryptPii(member.user.email) } } : member;
  }

  private isOwnerOrAdmin(actor: MembershipActor): boolean {
    return actor.platformRole !== null || actor.role === 'owner';
  }

  private async activeOwnerCount(tenantId: string): Promise<number> {
    return this.prisma.db.membership.count({ where: { tenantId, role: 'owner', status: 'active' } });
  }

  /** Role defaults when no explicit permissions are supplied. */
  private resolvePermissions(role: 'owner' | 'manager' | 'staff', requested?: string[]): string[] {
    if (requested && requested.length > 0) return [...new Set(requested)];
    return defaultPermissionsFor(role);
  }

  private assertCanGrant(permissions: string[], actor: MembershipActor): void {
    const sensitive = permissions.filter(isOwnerOnlyPermission);
    if (sensitive.length > 0 && !this.isOwnerOrAdmin(actor)) {
      throw new ForbiddenException(`Only an owner can grant: ${sensitive.join(', ')}`);
    }
  }

  private async log(tenantId: string, actor: MembershipActor, action: string, target: string): Promise<void> {
    await this.prisma.db.activityLog.create({
      data: { tenantId, userId: actor.userId, page: 'members', action: `${action}:${target}` },
    });
  }

  /**
   * Enforces the plan's `staff` seat limit. Previously the limit existed in the
   * plan data but had no enforcement point, so every tier was effectively
   * unlimited.
   */
  private async assertStaffSeatAvailable(tenantId: string): Promise<void> {
    const check = await this.billing.checkLimit(tenantId, 'staff');
    if (!check.allowed) {
      throw new ConflictException(
        `Your plan allows ${check.limit} staff member(s) and you already have ${check.current}. Upgrade to add more.`
      );
    }
  }

  async add(tenantId: string, input: AddMemberInput, actor: MembershipActor) {
    if (input.role === 'owner' && !this.isOwnerOrAdmin(actor)) {
      throw new ForbiddenException('Only an owner can grant the owner role');
    }
    const permissions = this.resolvePermissions(input.role, input.permissions);
    this.assertCanGrant(permissions, actor);

    const user = await this.prisma.db.user.findFirst({ where: { deletedAt: null, OR: [{ emailIdx: blindIndex(input.email) }, { email: input.email }] } });
    if (!user) throw new NotFoundException('No account exists for that email yet');

    const existing = await this.prisma.db.membership.findFirst({ where: { userId: user.id, tenantId } });
    if (existing && existing.status === 'active') {
      throw new ConflictException('That user is already a member of this business');
    }

    // Plan entitlement: adding a seat must respect the `staff` limit.
    await this.assertStaffSeatAvailable(tenantId);

    const membership = existing
      ? await this.prisma.db.membership.update({
          where: { id: existing.id },
          data: { role: input.role, permissions, status: 'active' },
          include: MEMBER_INCLUDE,
        })
      : await this.prisma.db.membership.create({
          data: { id: newId(), userId: user.id, tenantId, role: input.role, permissions, status: 'active' },
          include: MEMBER_INCLUDE,
        });

    await this.cache.invalidateMembership(user.id, tenantId);
    await this.log(tenantId, actor, 'member.added', user.id);
    return { success: true, member: this.memberOut(membership) };
  }

  async update(tenantId: string, membershipId: string, input: UpdateMemberInput, actor: MembershipActor) {
    const target = await this.prisma.db.membership.findFirst({ where: { id: membershipId, tenantId } });
    if (!target) throw new NotFoundException('Membership not found');

    const isTargetActiveOwner = target.role === 'owner' && target.status === 'active';
    const demotingOwner = isTargetActiveOwner && ((input.role && input.role !== 'owner') || input.status === 'inactive');
    if (demotingOwner) {
      if (!this.isOwnerOrAdmin(actor)) throw new ForbiddenException('Only an owner can change an owner');
      if ((await this.activeOwnerCount(tenantId)) <= 1) {
        throw new ConflictException('Cannot demote or deactivate the last owner of the business');
      }
    }
    if (input.role === 'owner' && !this.isOwnerOrAdmin(actor)) {
      throw new ForbiddenException('Only an owner can grant the owner role');
    }

    // A role change without explicit permissions resets to that role's defaults.
    const permissions =
      input.permissions !== undefined
        ? this.resolvePermissions((input.role ?? target.role) as 'owner' | 'manager' | 'staff', input.permissions)
        : input.role !== undefined
          ? this.resolvePermissions(input.role)
          : undefined;
    if (permissions) this.assertCanGrant(permissions, actor);

    const membership = await this.prisma.db.membership.update({
      where: { id: membershipId },
      data: {
        role: input.role ?? undefined,
        permissions: permissions ?? undefined,
        status: input.status ?? undefined,
      },
      include: MEMBER_INCLUDE,
    });
    await this.cache.invalidateMembership(target.userId, tenantId);
    await this.log(tenantId, actor, 'member.updated', target.userId);
    return { success: true, member: this.memberOut(membership) };
  }

  async remove(tenantId: string, membershipId: string, actor: MembershipActor) {
    const target = await this.prisma.db.membership.findFirst({ where: { id: membershipId, tenantId } });
    if (!target) throw new NotFoundException('Membership not found');

    if (target.role === 'owner' && target.status === 'active' && (await this.activeOwnerCount(tenantId)) <= 1) {
      throw new ConflictException('Cannot remove the last owner of the business');
    }

    await this.prisma.db.membership.update({ where: { id: membershipId }, data: { status: 'inactive' } });
    await this.cache.invalidateMembership(target.userId, tenantId);
    await this.log(tenantId, actor, 'member.removed', target.userId);
    return { success: true, message: 'Member deactivated' };
  }

  // ── Invitations ──────────────────────────────────────────────────────────────
  async invite(tenantId: string, input: InviteMemberInput, actor: MembershipActor) {
    if (input.role === 'owner' && !this.isOwnerOrAdmin(actor)) {
      throw new ForbiddenException('Only an owner can grant the owner role');
    }
    const permissions = this.resolvePermissions(input.role, input.permissions);
    this.assertCanGrant(permissions, actor);
    // Check the seat limit at invite time so a tenant is not told "invited"
    // and then blocked at acceptance.
    await this.assertStaffSeatAvailable(tenantId);

    const existingUser = await this.prisma.db.user.findFirst({ where: { deletedAt: null, OR: [{ emailIdx: blindIndex(input.email) }, { email: input.email }] } });
    if (existingUser) {
      const active = await this.prisma.db.membership.findFirst({
        where: { userId: existingUser.id, tenantId, status: 'active' },
      });
      if (active) throw new ConflictException('That user is already a member of this business');
    }

    const rawToken = randomToken(32);
    const invite = await this.prisma.db.membershipInvite.create({
      data: {
        id: newId(),
        tenantId,
        email: encryptPii(input.email) ?? '',
        emailIdx: blindIndex(input.email),
        role: input.role,
        permissions,
        tokenHash: sha256(rawToken),
        invitedBy: actor.userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    const base = this.config.get<string>('PUBLIC_APP_URL') || this.config.get<string>('APP_URL') || 'http://localhost:4000';
    const link = `${base}/accept-invite?token=${rawToken}`;
    await this.outbox.enqueue({
      type: 'email.send',
      tenantId,
      payload: {
        to: input.email,
        subject: 'You are invited to UZANITE',
        html: `<p>You have been invited to join a business on UZANITE as <strong>${input.role}</strong>.</p>
               <p><a href="${link}">Accept your invitation</a></p>
               <p>This link expires in 7 days.</p>`,
      },
    });
    await this.log(tenantId, actor, 'member.invited', input.email);

    return { success: true, invite: { email: decryptPii(invite.email), role: invite.role, expiresAt: invite.expiresAt } };
  }

  /** Consumes an invitation: creates the user (if new) and the membership. */
  async acceptInvite(input: AcceptInviteInput) {
    assertPasswordPolicy(input.password);
    const tokenHash = sha256(input.token);

    return this.uow.runAsSystem(() =>
      this.prisma.transaction(async () => {
        const invite = await this.prisma.db.membershipInvite.findFirst({ where: { tokenHash, usedAt: null } });
        if (!invite || invite.expiresAt < new Date()) {
          throw new UnauthorizedException('Invalid or expired invitation');
        }

        const inviteEmail = decryptPii(invite.email);
        let user = await this.prisma.db.user.findFirst({ where: { deletedAt: null, OR: [{ emailIdx: blindIndex(inviteEmail) }, { email: inviteEmail }] } });
        if (!user) {
          user = await this.prisma.db.user.create({
            data: {
              id: newId(),
              email: encryptPii(inviteEmail) ?? '',
              emailIdx: blindIndex(inviteEmail),
              name: input.name,
              passwordHash: await hashPassword(input.password),
              status: 'active',
              emailVerifiedAt: new Date(),
            },
          });
        }

        const existing = await this.prisma.db.membership.findFirst({
          where: { userId: user.id, tenantId: invite.tenantId },
        });
        if (existing) {
          await this.prisma.db.membership.update({
            where: { id: existing.id },
            data: { role: invite.role, permissions: invite.permissions, status: 'active' },
          });
        } else {
          await this.prisma.db.membership.create({
            data: {
              id: newId(),
              userId: user.id,
              tenantId: invite.tenantId,
              role: invite.role,
              permissions: invite.permissions,
              status: 'active',
            },
          });
        }

        await this.prisma.db.membershipInvite.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
        // The membership set changed, so drop this user's cached membership and
        // re-key the tenant's cache.
        await this.cache.invalidateMembership(user.id, invite.tenantId);
        return { success: true, message: 'Invitation accepted. Please sign in.' };
      })
    );
  }
}
