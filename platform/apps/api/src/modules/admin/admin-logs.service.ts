import { Injectable } from '@nestjs/common';
import { ActivityLogsQuery, LoginAttemptsQuery } from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem } from '../../context/tenant-context';
import { decryptPii } from '../../security/pii';

function dateRange(startDate?: string, endDate?: string): { gte?: Date; lte?: Date } | undefined {
  const range: { gte?: Date; lte?: Date } = {};
  if (startDate) range.gte = new Date(startDate);
  if (endDate) {
    const end = new Date(endDate);
    // A date-only end must include the whole day.
    if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) end.setHours(23, 59, 59, 999);
    range.lte = end;
  }
  return Object.keys(range).length ? range : undefined;
}

// Prisma groupBy returns the grouped field by name (e.g. `{ page, _count }`);
// the legacy client expects `{ _id, count }`.
const groupToCounts = (rows: Array<Record<string, unknown>>, field: string) =>
  rows.map((r) => ({ _id: (r[field] ?? '') as string, count: (r._count as { _all: number })._all }));

@Injectable()
export class AdminLogsService {
  constructor(private readonly prisma: PrismaService) {}

  private async usersByIds(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map<string, { name: string; email: string; role: string | null }>();
    const users = await runAsSystem(() =>
      this.prisma.db.user.findMany({
        where: { id: { in: unique } },
        select: { id: true, name: true, email: true, platformRole: true },
      })
    );
    return new Map(users.map((u) => [u.id, { name: u.name, email: decryptPii(u.email), role: u.platformRole }]));
  }

  async activityLogs(query: ActivityLogsQuery) {
    const where: Record<string, unknown> = {};
    if (query.userId) where.userId = query.userId;
    const range = dateRange(query.startDate, query.endDate);
    if (range) where.createdAt = range;
    if (query.search) {
      const matches = await runAsSystem(() =>
        this.prisma.db.user.findMany({
          where: { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { email: { contains: query.search, mode: 'insensitive' } }] },
          select: { id: true },
          take: 100,
        })
      );
      where.OR = [
        { page: { contains: query.search, mode: 'insensitive' } },
        { action: { contains: query.search, mode: 'insensitive' } },
        { device: { contains: query.search, mode: 'insensitive' } },
        { browser: { contains: query.search, mode: 'insensitive' } },
        { userId: { in: matches.map((m) => m.id) } },
      ];
    }

    const skip = (query.page - 1) * query.limit;
    const [rows, total] = await runAsSystem(() =>
      Promise.all([
        this.prisma.db.activityLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: query.limit }),
        this.prisma.db.activityLog.count({ where }),
      ])
    );
    const users = await this.usersByIds(rows.map((r) => r.userId ?? ''));
    const logs = rows.map((r) => {
      const user = r.userId ? users.get(r.userId) : undefined;
      return {
        _id: String(r.id),
        id: String(r.id),
        userName: user?.name ?? '',
        userEmail: user?.email ?? '',
        sessionId: '',
        page: r.page,
        action: r.action,
        device: r.device ?? '',
        browser: r.browser ?? '',
        os: r.os ?? '',
        ip: r.ip ?? '',
        createdAt: r.createdAt,
      };
    });
    return { success: true, logs, total, page: query.page, pages: Math.ceil(total / query.limit) };
  }

  async activitySummary() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [totalVisits, todayVisits, unique, topPages, deviceBreakdown, browserBreakdown, recent] = await runAsSystem(() =>
      Promise.all([
        this.prisma.db.activityLog.count(),
        this.prisma.db.activityLog.count({ where: { createdAt: { gte: startOfToday } } }),
        this.prisma.db.activityLog.groupBy({ by: ['userId'], where: { userId: { not: null } } }),
        this.prisma.db.activityLog.groupBy({ by: ['page'], _count: { _all: true }, orderBy: { _count: { page: 'desc' } }, take: 10 }),
        this.prisma.db.activityLog.groupBy({ by: ['device'], _count: { _all: true }, orderBy: { _count: { device: 'desc' } }, take: 10 }),
        this.prisma.db.activityLog.groupBy({ by: ['browser'], _count: { _all: true }, orderBy: { _count: { browser: 'desc' } }, take: 10 }),
        this.prisma.db.activityLog.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      ])
    );
    const users = await this.usersByIds(recent.map((r) => r.userId ?? ''));
    return {
      success: true,
      totalVisits,
      todayVisits,
      uniqueVisitors: unique.length,
      topPages: groupToCounts(topPages as never, 'page'),
      deviceBreakdown: groupToCounts(deviceBreakdown as never, 'device'),
      browserBreakdown: groupToCounts(browserBreakdown as never, 'browser'),
      recentActivity: recent.map((r) => ({
        _id: String(r.id),
        userName: r.userId ? users.get(r.userId)?.name ?? '' : '',
        page: r.page,
        action: r.action,
        device: r.device ?? '',
        browser: r.browser ?? '',
        os: r.os ?? '',
        createdAt: r.createdAt,
      })),
    };
  }

  async loginAttempts(query: LoginAttemptsQuery) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.email) where.email = { contains: query.email, mode: 'insensitive' };
    const range = dateRange(query.startDate, query.endDate);
    if (range) where.createdAt = range;

    const skip = (query.page - 1) * query.limit;
    const [rows, total] = await runAsSystem(() =>
      Promise.all([
        this.prisma.db.loginAttempt.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: query.limit }),
        this.prisma.db.loginAttempt.count({ where }),
      ])
    );
    const users = await this.usersByIds(rows.map((r) => r.userId ?? ''));
    const attempts = rows.map((r) => {
      const user = r.userId ? users.get(r.userId) : undefined;
      return {
        _id: String(r.id),
        email: r.email ?? '',
        userName: user?.name ?? '',
        role: user?.role ?? '',
        status: r.status,
        reason: r.reason ?? '',
        device: r.device ?? '',
        browser: r.browser ?? '',
        os: r.os ?? '',
        createdAt: r.createdAt,
      };
    });
    return { success: true, attempts, total, page: query.page, pages: Math.ceil(total / query.limit) };
  }

  async loginSummary() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [totalAttempts, todayAttempts, statusBreakdown, recent, failed] = await runAsSystem(() =>
      Promise.all([
        this.prisma.db.loginAttempt.count(),
        this.prisma.db.loginAttempt.count({ where: { createdAt: { gte: startOfToday } } }),
        this.prisma.db.loginAttempt.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.db.loginAttempt.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
        this.prisma.db.loginAttempt.groupBy({
          by: ['email'],
          where: { status: 'failed' },
          _count: { _all: true },
          orderBy: { _count: { email: 'desc' } },
          take: 10,
        }),
      ])
    );
    const users = await this.usersByIds(recent.map((r) => r.userId ?? ''));
    return {
      success: true,
      totalAttempts,
      todayAttempts,
      statusBreakdown: groupToCounts(statusBreakdown as never, 'status'),
      recentAttempts: recent.map((r) => ({
        _id: String(r.id),
        email: r.email ?? '',
        userName: r.userId ? users.get(r.userId)?.name ?? '' : '',
        status: r.status,
        reason: r.reason ?? '',
        createdAt: r.createdAt,
      })),
      failedEmails: groupToCounts(failed as never, 'email'),
    };
  }
}
