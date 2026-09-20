import { Injectable } from '@nestjs/common';
import { ReportKey, ReportQuery } from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { periodStart } from '../ledgers/ledger-utils';

export interface ReportColumn {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'right';
}

export interface Dataset {
  title: string;
  stats: Array<{ label: string; value: string }>;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number>>;
}

const fmtNum = (n: number) => Number(n ?? 0).toLocaleString('en-US');
const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private money(value: unknown): number {
    return Number(value ?? 0);
  }

  async businessName(tenantId: string): Promise<string> {
    const tenant = await this.prisma.db.tenant.findFirst({ where: { id: tenantId }, select: { name: true } });
    return tenant?.name ?? 'Business';
  }

  async summary(tenantId: string, query: ReportQuery) {
    const from = periodStart(query.period);
    const withDate = (field: string) => (from ? { [field]: { gte: from } } : {});

    const [orders, products, expenses, purchases, debts, staff] = await Promise.all([
      this.prisma.db.order.findMany({ where: { tenantId, ...withDate('createdAt') } }),
      this.prisma.db.product.findMany({ where: { tenantId, deletedAt: null } }),
      this.prisma.db.expense.findMany({ where: { tenantId, ...withDate('date') } }),
      this.prisma.db.purchase.findMany({ where: { tenantId, deletedAt: null, ...withDate('date') } }),
      this.prisma.db.debt.findMany({ where: { tenantId, deletedAt: null, ...withDate('createdAt') } }),
      this.prisma.db.staff.findMany({ where: { tenantId, ...withDate('createdAt') } }),
    ]);

    const revenue = orders
      .filter((o) => o.status === 'PAID' || o.status === 'DELIVERED')
      .reduce((s, o) => s + this.money(o.total), 0);
    const expenseTotal = expenses.reduce((s, e) => s + this.money(e.amount), 0);
    const purchaseTotal = purchases.reduce((s, p) => s + this.money(p.totalCost), 0);
    const debtTotal = debts.reduce((s, d) => s + this.money(d.amount), 0);
    const debtPaid = debts.reduce((s, d) => s + this.money(d.paidAmount), 0);
    const inventoryValue = products.reduce((s, p) => s + this.money(p.price) * (p.stock ?? 0), 0);

    return {
      success: true,
      period: query.period,
      range: { start: from ? from.toISOString() : null, end: new Date().toISOString() },
      metrics: {
        orders: { count: orders.length, revenue },
        products: { count: products.length, value: inventoryValue },
        expenses: { count: expenses.length, total: expenseTotal },
        purchases: { count: purchases.length, total: purchaseTotal },
        debts: { count: debts.length, total: debtTotal, remaining: debtTotal - debtPaid },
        staff: { count: staff.length },
      },
    };
  }

  async build(tenantId: string, key: Exclude<ReportKey, 'full'> | 'full', query: ReportQuery): Promise<Dataset[]> {
    const datasets: Dataset[] = [];
    if (key === 'expenses' || key === 'full') datasets.push(await this.expenses(tenantId, query));
    if (key === 'purchases' || key === 'full') datasets.push(await this.purchases(tenantId, query));
    if (key === 'debts' || key === 'full') datasets.push(await this.debts(tenantId, query));
    if (key === 'orders' || key === 'full') datasets.push(await this.orders(tenantId, query));
    if (key === 'products' || key === 'full') datasets.push(await this.products(tenantId, query));
    if (key === 'staff' || key === 'full') datasets.push(await this.staff(tenantId, query));
    return datasets;
  }

  private async expenses(tenantId: string, query: ReportQuery): Promise<Dataset> {
    const from = periodStart(query.period);
    const rows = await this.prisma.db.expense.findMany({
      where: { tenantId, ...(from ? { date: { gte: from } } : {}) },
      orderBy: { date: 'desc' },
    });
    const total = rows.reduce((s, e) => s + this.money(e.amount), 0);
    return {
      title: 'Expenses Report',
      stats: [
        { label: 'Total', value: fmtNum(total) },
        { label: 'Records', value: String(rows.length) },
        { label: 'Average', value: fmtNum(rows.length ? Math.round(total / rows.length) : 0) },
      ],
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'description', label: 'Description', width: 3 },
        { key: 'category', label: 'Category' },
        { key: 'recordedBy', label: 'Recorded By' },
        { key: 'amount', label: 'Amount', align: 'right' },
      ],
      rows: rows.map((e) => ({
        date: fmtDate(e.date),
        description: e.description,
        category: e.category,
        recordedBy: e.recordedBy,
        amount: fmtNum(this.money(e.amount)),
      })),
    };
  }

  private async purchases(tenantId: string, query: ReportQuery): Promise<Dataset> {
    const from = periodStart(query.period);
    const rows = await this.prisma.db.purchase.findMany({
      where: { tenantId, deletedAt: null, ...(from ? { date: { gte: from } } : {}) },
      orderBy: { date: 'desc' },
    });
    const total = rows.reduce((s, p) => s + this.money(p.totalCost), 0);
    return {
      title: 'Purchases Report',
      stats: [
        { label: 'Total Cost', value: fmtNum(total) },
        { label: 'Records', value: String(rows.length) },
      ],
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'productName', label: 'Product', width: 2.5 },
        { key: 'quantity', label: 'Qty', align: 'right' },
        { key: 'costPerUnit', label: 'Unit', align: 'right' },
        { key: 'totalCost', label: 'Total', align: 'right' },
        { key: 'supplier', label: 'Supplier', width: 2 },
      ],
      rows: rows.map((p) => ({
        date: fmtDate(p.date),
        productName: p.productName,
        quantity: p.quantity,
        costPerUnit: fmtNum(this.money(p.costPerUnit)),
        totalCost: fmtNum(this.money(p.totalCost)),
        supplier: p.supplier || '—',
      })),
    };
  }

  private async debts(tenantId: string, query: ReportQuery): Promise<Dataset> {
    const from = periodStart(query.period);
    const rows = await this.prisma.db.debt.findMany({
      where: { tenantId, deletedAt: null, ...(from ? { createdAt: { gte: from } } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    const total = rows.reduce((s, d) => s + this.money(d.amount), 0);
    const remaining = rows.reduce((s, d) => s + Math.max(0, this.money(d.amount) - this.money(d.paidAmount)), 0);
    return {
      title: 'Debts Report',
      stats: [
        { label: 'Total Amount', value: fmtNum(total) },
        { label: 'Remaining', value: fmtNum(remaining) },
        { label: 'Records', value: String(rows.length) },
      ],
      columns: [
        { key: 'customerName', label: 'Customer', width: 2 },
        { key: 'customerPhone', label: 'Phone' },
        { key: 'amount', label: 'Amount', align: 'right' },
        { key: 'paidAmount', label: 'Paid', align: 'right' },
        { key: 'remaining', label: 'Remaining', align: 'right' },
        { key: 'status', label: 'Status' },
      ],
      rows: rows.map((d) => ({
        customerName: d.customerName,
        customerPhone: d.customerPhone || '—',
        amount: fmtNum(this.money(d.amount)),
        paidAmount: fmtNum(this.money(d.paidAmount)),
        remaining: fmtNum(Math.max(0, this.money(d.amount) - this.money(d.paidAmount))),
        status: d.status,
      })),
    };
  }

  private async orders(tenantId: string, query: ReportQuery): Promise<Dataset> {
    const from = periodStart(query.period);
    const rows = await this.prisma.db.order.findMany({
      where: { tenantId, deletedAt: null, ...(from ? { createdAt: { gte: from } } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    const revenue = rows
      .filter((o) => o.status === 'PAID' || o.status === 'DELIVERED')
      .reduce((s, o) => s + this.money(o.total), 0);
    return {
      title: 'Orders Report',
      stats: [
        { label: 'Orders', value: String(rows.length) },
        { label: 'Revenue', value: fmtNum(revenue) },
      ],
      columns: [
        { key: 'number', label: 'Order #' },
        { key: 'customer', label: 'Customer', width: 2 },
        { key: 'status', label: 'Status' },
        { key: 'paymentMethod', label: 'Payment' },
        { key: 'total', label: 'Total', align: 'right' },
        { key: 'date', label: 'Date' },
      ],
      rows: rows.map((o) => ({
        number: o.orderNumber,
        customer: o.customerName,
        status: o.status,
        paymentMethod: o.paymentMethod || '—',
        total: fmtNum(this.money(o.total)),
        date: fmtDate(o.createdAt),
      })),
    };
  }

  private async products(tenantId: string, query: ReportQuery): Promise<Dataset> {
    const from = periodStart(query.period);
    const rows = await this.prisma.db.product.findMany({
      where: { tenantId, deletedAt: null, ...(from ? { createdAt: { gte: from } } : {}) },
      orderBy: { name: 'asc' },
    });
    const value = rows.reduce((s, p) => s + this.money(p.price) * (p.stock ?? 0), 0);
    return {
      title: 'Products Report',
      stats: [
        { label: 'Products', value: String(rows.length) },
        { label: 'Inventory Value', value: fmtNum(value) },
      ],
      columns: [
        { key: 'name', label: 'Product', width: 3 },
        { key: 'barcode', label: 'Barcode' },
        { key: 'price', label: 'Price', align: 'right' },
        { key: 'stock', label: 'Stock', align: 'right' },
        { key: 'value', label: 'Value', align: 'right' },
      ],
      rows: rows.map((p) => ({
        name: p.name,
        barcode: p.barcode || '—',
        price: fmtNum(this.money(p.price)),
        stock: String(p.stock ?? 0),
        value: fmtNum(this.money(p.price) * (p.stock ?? 0)),
      })),
    };
  }

  private async staff(tenantId: string, query: ReportQuery): Promise<Dataset> {
    const from = periodStart(query.period);
    const rows = await this.prisma.db.staff.findMany({
      where: { tenantId, ...(from ? { createdAt: { gte: from } } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return {
      title: 'Staff Report',
      stats: [{ label: 'Members', value: String(rows.length) }],
      columns: [
        { key: 'name', label: 'Name', width: 2 },
        { key: 'email', label: 'Email', width: 3 },
        { key: 'permissions', label: 'Permissions', width: 3 },
        { key: 'status', label: 'Status' },
        { key: 'lastLogin', label: 'Last Login' },
      ],
      rows: rows.map((s) => ({
        name: s.name,
        email: s.email,
        permissions: s.permissions.join(', ') || '—',
        status: s.status,
        lastLogin: fmtDate(s.lastLogin),
      })),
    };
  }

  toCsv(datasets: Dataset[]): string {
    const esc = (v: string | number) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const blocks = datasets.map((d) => {
      const header = d.columns.map((c) => esc(c.label)).join(',');
      const body = d.rows.map((r) => d.columns.map((c) => esc(r[c.key] ?? '')).join(',')); 
      return [`# ${d.title}`, header, ...body].join('\n');
    });
    return blocks.join('\n\n');
  }
}
