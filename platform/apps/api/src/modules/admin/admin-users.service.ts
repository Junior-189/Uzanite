import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  AdminUserRejectInput,
  SUB_ADMIN_PERMISSIONS,
  SubAdminCreateInput,
  SubAdminUpdateInput,
} from '@uzanite/contracts';
import { CacheService } from '../../cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../../security/token.service';
import { hashPassword } from '../../security/password';
import { FeatureFlagsService } from './feature-flags.service';
import { newId } from '../../ids/id';
import { blindIndex, decryptPii, encryptPii } from '../../security/pii';
import { runAsSystem } from '../../context/tenant-context';

// Labels shown in the admin UI for sub-admin permissions.
const SUB_ADMIN_PERMISSION_LABELS: Record<string, string> = {
  view_tenants: 'View tenants',
  approve_tenants: 'Approve tenants',
  suspend_tenants: 'Suspend tenants',
  impersonate_tenants: 'Impersonate tenants',
  edit_tenants: 'Edit tenants',
  reset_tenant_passwords: 'Reset tenant passwords',
  delete_tenants: 'Delete tenants',
  view_dashboard: 'Dashboard',
  manage_orders: 'Orders',
  manage_products: 'Products',
  manage_contacts: 'Contacts',
  manage_whatsapp: 'WhatsApp',
  manage_broadcast: 'Email / Broadcast',
  manage_expenses: 'Expenses',
  manage_purchases: 'Purchases',
  manage_debts: 'Debts',
  manage_staff: 'Staff',
  manage_business: 'Business',
  manage_settings: 'Settings',
  manage_notifications: 'Notifications',
  view_reports: 'Reports',
  access_recycle_bin: 'Recycle bin',
};

// Page-level permissions a tenant session can be granted under impersonation.
const TENANT_PAGE_PERMS = SUB_ADMIN_PERMISSIONS.filter(
  (p) => p.startsWith('manage_') || p === 'view_dashboard' || p === 'view_reports' || p === 'access_recycle_bin'
);

const SUB_ADMIN_SELECT = {
  id: true,
  name: true,
  email: true,
  permissions: true,
  status: true,
  platformRole: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface AccountRow {
  user: { id: string; name: string; email: string; status: string; tokenVersion: number };
  tenant: { id: string; name: string; status: string };
  membership: { id: string; permissions: string[] };
}

/**
 * Reimplementation of the legacy Express admin panel's user management
 * (`/api/admin/users*`, `/api/admin/sub-admins*`, `/api/admin/stats`,
 * `/api/admin/impersonate/:id`).
 *
 * Legacy "tenant users" are platform Users that own a tenant; "sub-admins" are
 * platform Users with `platformRole = sub_admin`. Responses are adapted to the
 * legacy shapes the existing admin SPA expects (`_id`, `businessName`,
 * `suspended`, embedded counts).
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
    private readonly flags: FeatureFlagsService
  ) {}

  private findAccount(userId: string, includeDeleted = false): Promise<AccountRow | null> {
    return runAsSystem(() =>
      this.prisma.db.membership
        .findFirst({
          where: includeDeleted
            ? { userId, role: 'owner' }
            : { userId, role: 'owner', tenant: { deletedAt: null }, user: { deletedAt: null } },
          include: {
            user: { select: { id: true, name: true, email: true, status: true, tokenVersion: true } },
            tenant: { select: { id: true, name: true, status: true } },
          },
          orderBy: { createdAt: 'asc' },
        })
        .then((m) => (m ? { user: m.user, tenant: m.tenant, membership: { id: m.id, permissions: m.permissions } } : null))
    );
  }

  private async getAccountOrThrow(userId: string): Promise<AccountRow> {
    const account = await this.findAccount(userId);
    if (!account) throw new NotFoundException('User not found');
    return account;
  }

  private async loadCounts(tenantIds: string[]) {
    if (tenantIds.length === 0) {
      return { orders: new Map<string, number>(), revenue: new Map<string, number>(), products: new Map<string, number>(), contacts: new Map<string, number>(), whatsapp: new Set<string>(), plans: new Map<string, { plan: string; status: string }>() };
    }
    const [orders, revenue, products, contacts, accounts, subs] = await runAsSystem(() => Promise.all([
      this.prisma.db.order.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds }, deletedAt: null }, _count: { _all: true } }),
      this.prisma.db.order.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds }, deletedAt: null, status: 'PAID' }, _sum: { total: true } }),
      this.prisma.db.product.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds }, deletedAt: null }, _count: { _all: true } }),
      this.prisma.db.whatsAppContact.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds }, deletedAt: null }, _count: { _all: true } }),
      this.prisma.db.whatsAppAccount.findMany({ where: { tenantId: { in: tenantIds } }, select: { tenantId: true, status: true } }),
      this.prisma.db.subscription.findMany({ where: { tenantId: { in: tenantIds } }, select: { tenantId: true, planKey: true, status: true } }),
    ]));

    const num = (rows: { tenantId: string; _count: { _all: number } }[]) =>
      new Map(rows.map((r) => [r.tenantId, r._count._all]));
    return {
      orders: num(orders as never),
      revenue: new Map(revenue.map((r) => [r.tenantId, Number(r._sum.total ?? 0)])),
      products: num(products as never),
      contacts: num(contacts as never),
      whatsapp: new Set(accounts.filter((a) => a.status === 'connected').map((a) => a.tenantId)),
      plans: new Map(subs.map((s) => [s.tenantId, { plan: s.planKey, status: s.status }])),
    };
  }

  private async buildAccounts() {
    const memberships = await runAsSystem(() =>
      this.prisma.db.membership.findMany({
        where: { role: 'owner', tenant: { deletedAt: null }, user: { deletedAt: null } },
        include: {
          user: { select: { id: true, name: true, email: true, status: true, createdAt: true, updatedAt: true } },
          tenant: { select: { id: true, name: true, status: true, createdAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    );

    const counts = await this.loadCounts(memberships.map((m) => m.tenantId));
    const rows = memberships.map((m) => {
      const suspended = m.tenant.status === 'suspended';
      const status = suspended ? 'approved' : m.tenant.status;
      const sub = counts.plans.get(m.tenantId);
      return {
        _id: m.user.id,
        id: m.user.id,
        name: m.user.name,
        email: decryptPii(m.user.email),
        role: 'tenant',
        status,
        businessId: m.tenant.id,
        businessName: m.tenant.name,
        suspended,
        whatsappConnected: counts.whatsapp.has(m.tenantId),
        permissions: m.permissions,
        plan: sub?.plan ?? 'free',
        subscriptionStatus: sub?.status ?? 'active',
        theme: 'light',
        createdAt: m.user.createdAt,
        updatedAt: m.user.updatedAt,
        totalOrders: counts.orders.get(m.tenantId) ?? 0,
        totalRevenue: counts.revenue.get(m.tenantId) ?? 0,
        productCount: counts.products.get(m.tenantId) ?? 0,
        contactCount: counts.contacts.get(m.tenantId) ?? 0,
      };
    });

    const countsOut = {
      total: rows.length,
      pending: rows.filter((r) => r.status === 'pending').length,
      approved: rows.filter((r) => r.status === 'approved').length,
      rejected: rows.filter((r) => r.status === 'rejected').length,
    };
    return { rows, counts: countsOut };
  }

  async listUsers() {
    const { rows, counts } = await this.buildAccounts();
    return { success: true, counts, users: rows };
  }

  async stats() {
    const { rows, counts } = await this.buildAccounts();
    return {
      success: true,
      stats: {
        totalUsers: counts.total,
        pendingUsers: counts.pending,
        approvedUsers: counts.approved,
        rejectedUsers: counts.rejected,
        connectedWhatsApp: rows.filter((r) => r.whatsappConnected).length,
      },
    };
  }

  private async setTenantStatus(account: AccountRow, status: 'approved' | 'rejected' | 'suspended', rejectionReason?: string) {
    await runAsSystem(() =>
      this.prisma.db.tenant.update({
        where: { id: account.tenant.id },
        data: { status, ...(rejectionReason !== undefined ? { rejectionReason } : {}) },
      })
    );
    await this.cache.invalidateTenant(account.tenant.id);
  }

  async approve(userId: string) {
    const account = await this.getAccountOrThrow(userId);
    await runAsSystem(() =>
      this.prisma.db.user.update({ where: { id: account.user.id }, data: { status: 'active' } })
    );
    await this.setTenantStatus(account, 'approved', '');
    return {
      success: true,
      message: `User ${account.user.name} approved successfully`,
      user: { id: account.user.id, name: account.user.name, email: decryptPii(account.user.email), status: 'approved' },
    };
  }

  async reject(userId: string, input: AdminUserRejectInput) {
    const account = await this.getAccountOrThrow(userId);
    await runAsSystem(() =>
      this.prisma.db.user.update({ where: { id: account.user.id }, data: { status: 'rejected' } })
    );
    await this.setTenantStatus(account, 'rejected', input.reason);
    return {
      success: true,
      message: `User ${account.user.name} rejected`,
      user: { id: account.user.id, name: account.user.name, email: decryptPii(account.user.email), status: 'rejected', rejectionReason: input.reason },
    };
  }

  async suspend(userId: string, suspended: boolean) {
    const account = await this.getAccountOrThrow(userId);
    await this.setTenantStatus(account, suspended ? 'suspended' : 'approved');
    return {
      success: true,
      message: `${account.user.name} has been ${suspended ? 'suspended' : 'unsuspended'}`,
      user: { id: account.user.id, name: account.user.name, suspended },
    };
  }

  async updateName(userId: string, name: string) {
    const account = await this.getAccountOrThrow(userId);
    await runAsSystem(() => this.prisma.db.user.update({ where: { id: account.user.id }, data: { name } }));
    return { success: true, message: `Name updated to "${name}"`, user: { id: account.user.id, name } };
  }

  async updateEmail(userId: string, email: string) {
    const account = await this.getAccountOrThrow(userId);
    try {
      await runAsSystem(() =>
        this.prisma.db.user.update({ where: { id: account.user.id }, data: { email: encryptPii(email) ?? '', emailIdx: blindIndex(email) } })
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Email already in use');
      }
      throw err;
    }
    return { success: true, message: `Email updated to "${email}"`, user: { id: account.user.id, email } };
  }

  async resetPassword(userId: string, newPassword: string) {
    const account = await this.getAccountOrThrow(userId);
    const passwordHash = await hashPassword(newPassword);
    await runAsSystem(() =>
      this.prisma.db.user.update({
        where: { id: account.user.id },
        data: { passwordHash, mustChangePassword: true, tokenVersion: { increment: 1 } },
      })
    );
    await this.tokens.revokeAllForUser(account.user.id);
    return {
      success: true,
      message: `Password reset for ${account.user.name}. All existing sessions were signed out.`,
      sessionsRevoked: true,
    };
  }

  async remove(userId: string, permanent: boolean) {
    const account = await this.findAccount(userId, true);
    if (!account) throw new NotFoundException('User not found');
    if (permanent) {
      await runAsSystem(() => this.prisma.db.user.delete({ where: { id: account.user.id } }));
      await this.tokens.revokeAllForUser(account.user.id);
      return { success: true, message: 'User permanently deleted' };
    }
    await runAsSystem(() =>
      this.prisma.db.user.update({
        where: { id: account.user.id },
        data: { deletedAt: new Date(), status: 'rejected', tokenVersion: { increment: 1 } },
      })
    );
    await this.tokens.revokeAllForUser(account.user.id);
    return { success: true, message: 'User moved to recycle bin' };
  }

  async impersonate(userId: string, actorUserId: string, ip?: string, userAgent?: string) {
    const account = await this.getAccountOrThrow(userId);
    if (account.tenant.status !== 'approved') {
      throw new BadRequestException('Cannot impersonate unapproved tenants');
    }

    const actor = await runAsSystem(() =>
      this.prisma.db.user.findFirst({
        where: { id: actorUserId },
        select: { email: true, platformRole: true, permissions: true },
      })
    );
    const pagePermissions =
      actor?.platformRole === 'sub_admin'
        ? TENANT_PAGE_PERMS.filter((p) => (actor.permissions ?? []).includes(p))
        : [...TENANT_PAGE_PERMS];

    const token = await this.tokens.signAccess(
      {
        userId: account.user.id,
        tenantId: account.tenant.id,
        membershipId: account.membership.id,
        role: 'owner',
        permissions: account.membership.permissions,
        tokenVersion: account.user.tokenVersion,
        impersonatedBy: actorUserId,
      },
      this.config.get<string>('IMPERSONATION_TTL') ?? '30m'
    );

    await runAsSystem(() =>
      this.prisma.db.activityLog.create({
        data: { tenantId: account.tenant.id, userId: actorUserId, page: 'admin', action: 'visit', referrer: `admin.impersonate:${account.tenant.id}`, ip, userAgent },
      })
    );

    const effective = await this.flags.effectiveFlags(account.tenant.id);
    const featureFlags = Object.fromEntries(Object.entries(effective).map(([key, enabled]) => [key, { enabled, message: '' }]));

    return {
      success: true,
      token,
      impersonation: { active: true, by: actor ? decryptPii(actor.email) : '', expiresInSeconds: 1800, pagePermissions },
      user: {
        _id: account.user.id,
        name: account.user.name,
        email: decryptPii(account.user.email),
        role: 'tenant',
        businessId: account.tenant.id,
        status: 'approved',
        featureFlags,
        theme: 'light',
      },
    };
  }

  // ── Sub-admins ────────────────────────────────────────────────────────────

  async listSubAdmins() {
    const users = await runAsSystem(() =>
      this.prisma.db.user.findMany({
        where: { platformRole: 'sub_admin', deletedAt: null },
        select: SUB_ADMIN_SELECT,
        orderBy: { createdAt: 'desc' },
      })
    );
    const rows = users.map((u) => ({ ...u, _id: u.id, email: decryptPii(u.email), suspended: u.status === 'suspended' }));
    return { success: true, users: rows, permissions: SUB_ADMIN_PERMISSION_LABELS };
  }

  private async getSubAdminOrThrow(id: string) {
    const user = await runAsSystem(() =>
      this.prisma.db.user.findFirst({ where: { id, platformRole: 'sub_admin', deletedAt: null } })
    );
    if (!user) throw new NotFoundException('Sub-admin not found');
    return user;
  }

  async createSubAdmin(input: SubAdminCreateInput) {
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await runAsSystem(() =>
        this.prisma.db.user.create({
          data: {
            id: newId(),
            name: input.name,
            email: encryptPii(input.email) ?? '',
            emailIdx: blindIndex(input.email),
            passwordHash,
            platformRole: 'sub_admin',
            status: 'active',
            permissions: input.permissions ?? [],
          },
          select: SUB_ADMIN_SELECT,
        })
      );
      return { success: true, message: `Sub-admin "${user.name}" created`, user: { ...user, _id: user.id, email: decryptPii(user.email) } };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Email already in use');
      }
      throw err;
    }
  }

  async updateSubAdmin(id: string, input: SubAdminUpdateInput) {
    await this.getSubAdminOrThrow(id);
    const data: Prisma.UserUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.email !== undefined) {
      data.email = encryptPii(input.email) ?? '';
      data.emailIdx = blindIndex(input.email);
    }
    if (input.permissions !== undefined) data.permissions = input.permissions;
    try {
      const user = await runAsSystem(() =>
        this.prisma.db.user.update({ where: { id }, data, select: SUB_ADMIN_SELECT })
      );
      return { success: true, message: 'Sub-admin updated', user: { ...user, _id: user.id, email: decryptPii(user.email) } };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Email already in use');
      }
      throw err;
    }
  }

  async removeSubAdmin(id: string) {
    const user = await this.getSubAdminOrThrow(id);
    await runAsSystem(() => this.prisma.db.user.delete({ where: { id } }));
    await this.tokens.revokeAllForUser(id);
    return { success: true, message: `Sub-admin "${user.name}" deleted` };
  }

  async resetSubAdminPassword(id: string, newPassword: string) {
    const user = await this.getSubAdminOrThrow(id);
    const passwordHash = await hashPassword(newPassword);
    await runAsSystem(() =>
      this.prisma.db.user.update({
        where: { id },
        data: { passwordHash, mustChangePassword: true, tokenVersion: { increment: 1 } },
      })
    );
    await this.tokens.revokeAllForUser(id);
    return { success: true, message: `Password reset for ${user.name}` };
  }
}
