import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { ProductsService } from '../../src/modules/catalog/products.service';
import { StockService } from '../../src/modules/catalog/stock.service';
import { OutboxService } from '../../src/outbox/outbox.service';
import { PrivacyService } from '../../src/modules/privacy/privacy.service';
import { FeatureFlagsService } from '../../src/modules/admin/feature-flags.service';
import { runWithRequest } from '../../src/context/tenant-context';

const d = hasDb ? describe : describe.skip;

async function seedTenant(h: Harness, label: string, plan = 'free') {
  const tenantId = randomUUID();
  const userId = randomUUID();
  await h.prisma.base.tenant.create({
    data: { id: tenantId, slug: `${label}-${tenantId.slice(0, 8)}`, name: label, status: 'approved' },
  });
  await h.prisma.base.user.create({
    data: { id: userId, email: `${label}-${tenantId.slice(0, 8)}@x.com`, name: label, status: 'active' },
  });
  await h.prisma.base.membership.create({ data: { id: randomUUID(), userId, tenantId, role: 'owner' } });
  await h.prisma.base.subscription.create({
    data: { id: randomUUID(), tenantId, planKey: plan, status: 'active' },
  });
  return { tenantId, userId };
}

/**
 * Regression tests for the Phase M13 hardening. Each test corresponds to a
 * specific audit finding, and would have failed before the fix.
 */
d('M13 hardening (Postgres)', () => {
  let h: Harness;
  let products: ProductsService;
  let stock: StockService;
  let privacy: PrivacyService;
  let flags: FeatureFlagsService;

  beforeAll(async () => {
    h = await createHarness();
    const outbox = new OutboxService(h.prisma);
    stock = new StockService(h.prisma, outbox);
    products = new ProductsService(h.prisma, stock);
    privacy = new PrivacyService(h.prisma);
    flags = new FeatureFlagsService(h.prisma, h.cache);
  });

  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  const withTenant = <T>(tenantId: string, fn: () => Promise<T>) => runWithRequest({ tenantId }, fn);

  // ── Finding 1: stock double-apply on concurrent duplicate ────────────────
  describe('stock integrity', () => {
    it('applies a concurrent duplicate dedupeKey exactly once', async () => {
      const { tenantId } = await seedTenant(h, 'stk-a');
      const created = await withTenant(tenantId, () =>
        products.create(tenantId, { name: 'Widget', price: 1000, stock: 10, lowStockThreshold: 0 } as never, 'Owner')
      );
      const productId = created.product.id;
      const clientRef = 'double-tap-1';

      // Two identical restocks fired together — the double-tapped POS button.
      // Before the fix both updated the balance and one movement insert was
      // swallowed, committing +20 with a single movement row to explain it.
      const results = await Promise.allSettled([
        withTenant(tenantId, () => products.restock(tenantId, productId, { quantity: 10, clientRef } as never, 'Owner')),
        withTenant(tenantId, () => products.restock(tenantId, productId, { quantity: 10, clientRef } as never, 'Owner')),
      ]);

      // At least one must succeed; a loser may fail on the unique index.
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

      const product = await h.prisma.base.product.findFirstOrThrow({ where: { id: productId } });
      const movements = await h.prisma.base.stockMovement.findMany({
        where: { tenantId, productId, dedupeKey: { not: null } },
      });

      // Exactly one movement row for the dedupe key...
      expect(movements.filter((m) => m.dedupeKey?.includes(clientRef))).toHaveLength(1);
      // ...and the balance moved exactly once: 10 initial + 10 restock.
      expect(product.stock).toBe(20);
      // The audit row agrees with the balance — the invariant that broke before.
      const restockMovement = movements.find((m) => m.dedupeKey?.includes(clientRef));
      expect(restockMovement?.balanceAfter).toBe(20);
      expect(restockMovement?.productName).toBe('Widget');
    });

    it('treats a sequential replay as already applied without moving stock', async () => {
      const { tenantId } = await seedTenant(h, 'stk-b');
      const created = await withTenant(tenantId, () =>
        products.create(tenantId, { name: 'Widget', price: 1000, stock: 5, lowStockThreshold: 0 } as never, 'Owner')
      );
      const productId = created.product.id;

      await withTenant(tenantId, () =>
        products.restock(tenantId, productId, { quantity: 3, clientRef: 'retry-1' } as never, 'Owner')
      );
      await withTenant(tenantId, () =>
        products.restock(tenantId, productId, { quantity: 3, clientRef: 'retry-1' } as never, 'Owner')
      );

      const product = await h.prisma.base.product.findFirstOrThrow({ where: { id: productId } });
      expect(product.stock).toBe(8); // 5 + 3, not 11
    });

    it('never commits a balance change below zero', async () => {
      const { tenantId } = await seedTenant(h, 'stk-c');
      const created = await withTenant(tenantId, () =>
        products.create(tenantId, { name: 'Widget', price: 1000, stock: 2, lowStockThreshold: 0 } as never, 'Owner')
      );
      const productId = created.product.id;

      await expect(
        withTenant(tenantId, () =>
          products.adjust(tenantId, productId, { delta: -5, clientRef: 'neg-1' } as never, 'Owner')
        )
      ).rejects.toThrow(/Insufficient stock/);

      const product = await h.prisma.base.product.findFirstOrThrow({ where: { id: productId } });
      expect(product.stock).toBe(2);
      // The rejected attempt must not leave a claimed dedupe key behind, or a
      // corrected retry would be silently swallowed as a duplicate.
      const movements = await h.prisma.base.stockMovement.findMany({
        where: { tenantId, dedupeKey: { contains: 'neg-1' } },
      });
      expect(movements).toHaveLength(0);
    });

    it('scopes dedupe keys per tenant', async () => {
      const a = await seedTenant(h, 'stk-d');
      const b = await seedTenant(h, 'stk-e');
      const pa = await withTenant(a.tenantId, () =>
        products.create(a.tenantId, { name: 'A', price: 100, stock: 1, lowStockThreshold: 0 } as never, 'Owner')
      );
      const pb = await withTenant(b.tenantId, () =>
        products.create(b.tenantId, { name: 'B', price: 100, stock: 1, lowStockThreshold: 0 } as never, 'Owner')
      );

      // Same clientRef in two tenants must both apply. With the old global
      // unique index, the second tenant's change was silently suppressed.
      await withTenant(a.tenantId, () =>
        products.restock(a.tenantId, pa.product.id, { quantity: 4, clientRef: 'shared' } as never, 'Owner')
      );
      await withTenant(b.tenantId, () =>
        products.restock(b.tenantId, pb.product.id, { quantity: 7, clientRef: 'shared' } as never, 'Owner')
      );

      expect((await h.prisma.base.product.findFirstOrThrow({ where: { id: pa.product.id } })).stock).toBe(5);
      expect((await h.prisma.base.product.findFirstOrThrow({ where: { id: pb.product.id } })).stock).toBe(8);
    });
  });

  // ── Finding 3: plan limits enforced nothing ──────────────────────────────
  describe('plan entitlements', () => {
    it('counts products live and blocks past the free plan limit', async () => {
      const { tenantId } = await seedTenant(h, 'plan-a', 'free');

      const before = await h.billing.checkLimit(tenantId, 'products');
      expect(before.limit).toBe(50);
      expect(before.current).toBe(0);
      expect(before.allowed).toBe(true);

      await withTenant(tenantId, () =>
        products.create(tenantId, { name: 'P1', price: 10, stock: 0 } as never, 'Owner')
      );
      await h.billing.invalidate(tenantId);

      // Live count, not a drifting counter.
      const after = await h.billing.checkLimit(tenantId, 'products');
      expect(after.current).toBe(1);
    });

    it('enforces ordersPerMonth, which no plan previously defined', async () => {
      const { tenantId } = await seedTenant(h, 'plan-b', 'free');
      const check = await h.billing.checkLimit(tenantId, 'ordersPerMonth');
      // Previously `undefined` -> the guard passed unconditionally.
      expect(check.limit).toBe(200);
      expect(check.allowed).toBe(true);
    });

    it('reads monthly usage only for the current period', async () => {
      const { tenantId } = await seedTenant(h, 'plan-c', 'free');
      // A stale counter from another month must not be read as current usage.
      await h.prisma.base.usageCounter.create({
        data: { id: randomUUID(), tenantId, metric: 'ordersPerMonth', periodKey: '2020-01', count: 999 },
      });
      await h.billing.invalidate(tenantId);

      const check = await h.billing.checkLimit(tenantId, 'ordersPerMonth');
      expect(check.current).toBe(0);
      expect(check.allowed).toBe(true);
    });

    it('increments monthly usage atomically under concurrency', async () => {
      const { tenantId } = await seedTenant(h, 'plan-d', 'free');
      // The old read-then-create raced the unique index and produced a 500.
      // Tenant context mirrors production: usage counters are tenant-scoped, so
      // the Prisma extension requires it.
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          withTenant(tenantId, () => h.billing.incrementUsage(tenantId, 'ordersPerMonth'))
        )
      );
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

      const counters = await h.prisma.base.usageCounter.findMany({
        where: { tenantId, metric: 'ordersPerMonth' },
      });
      expect(counters).toHaveLength(1);
      expect(Number(counters[0].count)).toBe(5);
    });

    it('fails closed on unknown features and metrics', async () => {
      const { tenantId } = await seedTenant(h, 'plan-e', 'free');
      const status = await h.billing.getStatusForGuard(tenantId);

      // An undeclared feature is denied, not granted.
      expect(h.billing.hasFeature(status, 'totally_made_up')).toBe(false);
      // A declared-but-disabled feature stays denied.
      expect(h.billing.hasFeature(status, 'reports')).toBe(false);
      // A declared-and-enabled feature is granted.
      expect(h.billing.hasFeature(status, 'orders')).toBe(true);

      const unknown = await h.billing.checkLimit(tenantId, 'not_a_metric');
      expect(unknown.allowed).toBe(false);
    });

    it('treats -1 as unlimited on the business plan', async () => {
      const { tenantId } = await seedTenant(h, 'plan-f', 'business');
      const check = await h.billing.checkLimit(tenantId, 'products');
      expect(check.limit).toBe(-1);
      expect(check.allowed).toBe(true);
      expect(h.billing.hasFeature(await h.billing.getStatusForGuard(tenantId), 'api')).toBe(true);
    });
  });

  // ── Finding 14: no privacy/consent surface on the platform ───────────────
  describe('privacy (PDPA)', () => {
    const actor = { userId: 'tester', ip: '127.0.0.1', userAgent: 'vitest' };

    async function seedContact(tenantId: string, phone: string) {
      await h.prisma.base.whatsAppContact.create({
        data: { id: randomUUID(), tenantId, phone, name: 'Asha', email: 'asha@example.com' },
      });
    }

    it('exports a data subject and records the request', async () => {
      const { tenantId } = await seedTenant(h, 'priv-a');
      await seedContact(tenantId, '255700111222');

      const res = await withTenant(tenantId, () =>
        privacy.exportData(tenantId, { phone: '255700111222' } as never, actor)
      );
      expect(res.success).toBe(true);
      expect(res.scope).toBe('data_subject');
      expect(res.contacts).toHaveLength(1);

      const requests = await h.prisma.base.privacyRequest.findMany({ where: { tenantId } });
      expect(requests).toHaveLength(1);
      expect(requests[0].kind).toBe('export');
    });

    it('erases personal data while retaining the financial record', async () => {
      const { tenantId } = await seedTenant(h, 'priv-b');
      await seedContact(tenantId, '255700333444');
      const orderId = randomUUID();
      await h.prisma.base.order.create({
        data: {
          id: orderId,
          tenantId,
          orderNumber: 'ORD-P-1',
          customerName: 'Asha',
          customerPhone: '255700333444',
          customerEmail: 'asha@example.com',
          source: 'cash',
          total: '5000',
          status: 'PAID',
        },
      });

      const res = await withTenant(tenantId, () =>
        privacy.erase(tenantId, { phone: '255700333444', preserveFinancialRecords: true } as never, actor)
      );
      expect(res.success).toBe(true);

      const order = await h.prisma.base.order.findFirstOrThrow({ where: { id: orderId } });
      expect(order.customerName).toBe('[erased]');
      expect(order.customerEmail).toBe('');
      expect(order.customerPhone).not.toContain('333444');
      // The money must survive: this is the whole point of pseudonymising.
      expect(Number(order.total)).toBe(5000);
      expect(order.status).toBe('PAID');

      const contact = await h.prisma.base.whatsAppContact.findFirstOrThrow({ where: { tenantId } });
      expect(contact.name).toBe('[erased]');
      expect(contact.optIn).toBe(false);
    });

    it('records consent withdrawal with an audit trail', async () => {
      const { tenantId } = await seedTenant(h, 'priv-c');
      await seedContact(tenantId, '255700555666');

      const res = await withTenant(tenantId, () =>
        privacy.setConsent(tenantId, { phone: '255700555666', action: 'revoked', channel: 'whatsapp', source: 'api' } as never, actor)
      );
      expect(res.contactsUpdated).toBe(1);

      const contact = await h.prisma.base.whatsAppContact.findFirstOrThrow({ where: { tenantId } });
      expect(contact.optIn).toBe(false);
      expect(contact.consentStatus).toBe('revoked');
      expect(contact.consentAt).toBeTruthy();

      const requests = await h.prisma.base.privacyRequest.findMany({ where: { tenantId } });
      expect(requests[0].kind).toBe('consent_withdraw');
    });

    it('keeps the privacy ledger append-only', async () => {
      const { tenantId } = await seedTenant(h, 'priv-d');
      await seedContact(tenantId, '255700777888');
      await withTenant(tenantId, () => privacy.exportData(tenantId, {} as never, actor));
      const row = await h.prisma.base.privacyRequest.findFirstOrThrow({ where: { tenantId } });

      await expect(h.prisma.base.privacyRequest.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/i);
    });
  });

  // ── Finding 41: FeatureFlag model had no service or controller ───────────
  describe('feature flags', () => {
    it('resolves tenant overrides above global defaults', async () => {
      const { tenantId } = await seedTenant(h, 'flag-a');

      await flags.upsert({ key: 'new_checkout', scope: 'global', enabled: false, message: '' } as never);
      expect(await flags.isEnabled('new_checkout', tenantId)).toBe(false);

      await flags.upsert({ key: 'new_checkout', scope: 'tenant', tenantId, enabled: true, message: '' } as never);
      expect(await flags.isEnabled('new_checkout', tenantId)).toBe(true);

      // Unknown flags fall back to the caller's default.
      expect(await flags.isEnabled('never_defined', tenantId)).toBe(false);
      expect(await flags.isEnabled('never_defined', tenantId, true)).toBe(true);
    });

    it('is idempotent on repeated upserts', async () => {
      await flags.upsert({ key: 'kill_switch', scope: 'global', enabled: true, message: '' } as never);
      await flags.upsert({ key: 'kill_switch', scope: 'global', enabled: false, message: 'paused' } as never);

      const listed = await flags.list({ scope: 'global', limit: 50 } as never);
      const rows = listed.flags.filter((f) => f.key === 'kill_switch');
      expect(rows).toHaveLength(1);
      expect(rows[0].enabled).toBe(false);
      expect(rows[0].message).toBe('paused');
    });
  });
});
