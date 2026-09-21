import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateStaffInput,
  ResetStaffPasswordInput,
  StaffLoginInput,
  UpdateStaffInput,
} from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../../security/token.service';
import { LockoutService } from '../../security/lockout.service';
import { BillingService } from '../billing/billing.service';
import { OutboxService } from '../../outbox/outbox.service';
import { hashPassword, verifyPasswordDetailed } from '../../security/password';
import { newId } from '../../ids/id';
import { runAsSystem } from '../../context/tenant-context';

export interface StaffRequestMeta {
  ip?: string;
  userAgent?: string;
}

const STAFF_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  email: true,
  avatar: true,
  role: true,
  permissions: true,
  status: true,
  createdBy: true,
  lastLogin: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Tenant staff accounts. Mirrors the legacy Express `/staff` API: email login
// issuing a `type: 'staff'` access token, owner-only CRUD, password reset.
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly lockout: LockoutService,
    private readonly billing: BillingService,
    private readonly outbox: OutboxService
  ) {}

  // Adds the `_id` alias the client keys rows on.
  private serialize<T extends { id: string }>(row: T) {
    return { ...row, _id: row.id };
  }

  // `login_attempts.user_id` is an FK to `users`; staff ids are not users, so
  // staff attempts are recorded by email only (userId null).
  private async recordAttempt(email: string, status: string, reason: string, meta: StaffRequestMeta) {
    await runAsSystem(() =>
      this.prisma.db.loginAttempt.create({
        data: { email, userId: null, status, reason, ip: meta.ip, userAgent: meta.userAgent },
      })
    );
  }

  async login(input: StaffLoginInput, meta: StaffRequestMeta) {
    const email = input.email.toLowerCase();

    const lock = await this.lockout.check(email);
    if (lock.locked) {
      throw new UnauthorizedException('Too many failed attempts. Please try again later.');
    }

    const staff = await runAsSystem(() =>
      this.prisma.db.staff.findUnique({ where: { email } })
    );
    if (!staff) {
      await this.recordAttempt(email, 'failed', 'Staff not found', meta);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (staff.status !== 'active') {
      await this.recordAttempt(email, 'inactive', 'Staff account inactive', meta);
      throw new ForbiddenException('Account is inactive. Contact your manager.');
    }

    const check = await verifyPasswordDetailed(input.password, staff.passwordHash);
    if (!check.valid) {
      await this.recordAttempt(email, 'failed', 'Wrong password', meta);
      await this.lockout.recordFailure(email);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.lockout.clear(email);
    await runAsSystem(() => this.prisma.db.staff.update({ where: { id: staff.id }, data: { lastLogin: new Date() } }));
    await this.recordAttempt(email, 'success', 'Login successful', meta);

    const token = await this.tokens.signAccess({
      userId: staff.id,
      tenantId: staff.tenantId,
      membershipId: null,
      role: 'staff',
      permissions: staff.permissions,
      tokenVersion: staff.tokenVersion,
      type: 'staff',
    });

    const refreshToken = await this.tokens.issueRefresh(staff.id, meta, 'staff');
    return {
      success: true,
      token,
      refreshToken,
      user: {
        _id: staff.id,
        name: staff.name,
        email: staff.email,
        role: 'staff',
        permissions: staff.permissions,
        businessId: staff.tenantId,
      },
    };
  }

  async me(tenantId: string, staffId: string) {
    const staff = await runAsSystem(() =>
      this.prisma.db.staff.findFirst({ where: { id: staffId, tenantId }, select: STAFF_SELECT })
    );
    if (!staff) throw new NotFoundException('Staff not found');
    return {
      success: true,
      user: {
        _id: staff.id,
        name: staff.name,
        email: staff.email,
        role: 'staff',
        permissions: staff.permissions,
        businessId: staff.tenantId,
        status: staff.status,
      },
    };
  }

  async list(tenantId: string) {
    const staff = await this.prisma.db.staff.findMany({
      where: { tenantId },
      select: STAFF_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    const [orderGroups, productGroups] = await Promise.all([
      this.prisma.db.order.groupBy({ by: ['recordedBy'], where: { tenantId, deletedAt: null }, _count: { _all: true } }),
      this.prisma.db.product.groupBy({ by: ['recordedBy'], where: { tenantId, deletedAt: null }, _count: { _all: true } }),
    ]);
    const toMap = (rows: { recordedBy: string | null; _count: { _all: number } }[]) =>
      Object.fromEntries(rows.map((r) => [r.recordedBy ?? '', r._count._all]));
    const orders = toMap(orderGroups as never);
    const products = toMap(productGroups as never);

    const staffNames = new Set(staff.map((s) => s.name));
    const rows = staff.map((s) => ({
      ...this.serialize(s),
      counts: {
        orders: orders[s.name] || 0,
        products: products[s.name] || 0,
        purchases: 0,
        debt: 0,
        expenses: 0,
      },
    }));

    // Anything not attributable to a named staff member is attributed to the owner.
    const ownerCounts = { orders: 0, products: 0, purchases: 0, debt: 0, expenses: 0 };
    for (const [name, n] of Object.entries(orders)) if (!staffNames.has(name)) ownerCounts.orders += n;
    for (const [name, n] of Object.entries(products)) if (!staffNames.has(name)) ownerCounts.products += n;

    return { success: true, staff: rows, ownerCounts };
  }

  async create(tenantId: string, input: CreateStaffInput, createdBy: string) {
    const email = input.email.toLowerCase();

    const check = await this.billing.checkLimit(tenantId, 'staff');
    if (!check.allowed) {
      throw new ConflictException(
        `Your plan allows ${check.limit} staff member(s) and you already have ${check.current}. Upgrade to add more.`
      );
    }

    try {
      const staff = await this.prisma.db.staff.create({
        data: {
          id: newId(),
          tenantId,
          name: input.name,
          email,
          passwordHash: await hashPassword(input.password),
          permissions: input.permissions ?? [],
          createdBy,
        },
        select: STAFF_SELECT,
      });
      return { success: true, staff: this.serialize(staff) };
    } catch (err) {
      // Staff emails are globally unique (login is by email across tenants).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Email already registered');
      }
      throw err;
    }
  }

  private async getOrThrow(tenantId: string, id: string) {
    const staff = await this.prisma.db.staff.findFirst({ where: { id, tenantId } });
    if (!staff) throw new NotFoundException('Staff not found');
    return staff;
  }

  async update(tenantId: string, id: string, input: UpdateStaffInput) {
    const staff = await this.getOrThrow(tenantId, id);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.permissions !== undefined) data.permissions = input.permissions;
    if (input.status !== undefined) data.status = input.status;
    if (input.email !== undefined) {
      const email = input.email.toLowerCase();
      if (email !== staff.email) data.email = email;
    }
    // Deactivating a staff member must invalidate their outstanding tokens.
    if (input.status === 'inactive') data.tokenVersion = { increment: 1 };

    try {
      const updated = await this.prisma.db.staff.update({ where: { id }, data, select: STAFF_SELECT });
      return { success: true, staff: this.serialize(updated) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Email already registered');
      }
      throw err;
    }
  }

  async resetPassword(tenantId: string, id: string, input: ResetStaffPasswordInput) {
    const staff = await this.getOrThrow(tenantId, id);
    await this.prisma.db.staff.update({
      where: { id },
      data: { passwordHash: await hashPassword(input.password), tokenVersion: { increment: 1 } },
    });
    await this.tokens.revokeAllForUser(id);

    await this.outbox.enqueue({
      type: 'email.send',
      tenantId,
      payload: {
        to: staff.email,
        subject: 'Your UZANITE staff password was reset',
        html:
          `<h2 style="margin:0 0 12px;color:#16a34a;">Staff Password Reset</h2>` +
          `<p>Hello ${staff.name},</p>` +
          `<p>Your password for the UZANITE staff account (<strong>${staff.email}</strong>) was reset by your business owner.</p>` +
          `<p>For security, the new password is not included in this email. Please ask your business owner for it, then change it after logging in.</p>`,
      },
    });

    return { success: true, message: 'Password updated' };
  }

  async remove(tenantId: string, id: string) {
    await this.getOrThrow(tenantId, id);
    await this.prisma.db.staff.delete({ where: { id } });
    await this.tokens.revokeAllForUser(id);
    return { success: true, message: 'Staff deleted' };
  }
}
