import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { LedgerDirection, LedgerEntryType, Prisma } from '@prisma/client';
import { ListLedgerQuery } from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate } from '../../pagination/pagination';
import { newId } from '../../ids/id';

export interface LedgerInput {
  tenantId: string;
  type: LedgerEntryType;
  direction: LedgerDirection;
  amount: number | string;
  currency?: string;
  refType?: string;
  refId?: string;
  dedupeKey?: string;
  description?: string;
  meta?: Record<string, unknown>;
  recordedBy?: string;
}

export interface LedgerSummary {
  credit: number;
  debit: number;
  net: number;
  byType: Record<string, number>;
  count: number;
}

export interface LedgerReconciliation {
  journals: number;
  lines: number;
  unbalancedJournals: number;
  balanced: boolean;
  /** Journal trial balance per account (debit/credit totals). */
  trialBalance: Array<{ account: string; debit: number; credit: number; net: number }>;
  /** Single-entry ledger totals for cross-checking. */
  ledger: { credit: number; debit: number; net: number };
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The single writer for the append-only financial records.
 *
 * Every ledger entry is written together with a BALANCED double-entry journal
 * (one debit + one credit line) in the same transaction, keyed by the same
 * dedupe key. The single-entry `ledger_entries` cash book is retained for the
 * existing reporting surface; the journal provides a trial balance and a
 * reconciliation invariant (debits == credits per journal).
 *
 * The DB trigger (0006_finance / 0013_m11_correctness) blocks UPDATE/DELETE on
 * both the ledger and the journal.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveKey(input: LedgerInput): string {
    if (input.dedupeKey) return input.dedupeKey;
    if (input.refId) return `${input.type}:${input.refType ?? ''}:${input.refId}`;
    return `${input.type}:${newId()}`;
  }

  // Money-in increases the cash asset, money-out decreases it. The counterparty
  // account depends on the transaction type.
  private journalLines(input: LedgerInput): Array<{ account: string; direction: LedgerDirection }> {
    const contra = input.type === 'refund' ? 'refunds' : input.type === 'adjustment' ? 'adjustments' : 'revenue';
    return input.direction === 'credit'
      ? [
          { account: 'cash', direction: 'debit' },
          { account: contra, direction: 'credit' },
        ]
      : [
          { account: contra, direction: 'debit' },
          { account: 'cash', direction: 'credit' },
        ];
  }

  async record(input: LedgerInput): Promise<{ entry: unknown; created: boolean }> {
    const dedupeKey = this.resolveKey(input);
    const currency = (input.currency ?? 'TZS').toUpperCase();
    const amount = round2(Number(input.amount));
    if (!(amount > 0)) throw new InternalServerErrorException('Ledger amount must be positive');

    // ON CONFLICT DO NOTHING keeps the surrounding transaction usable on a
    // replay (catching P2002 inside a Postgres tx would abort it).
    const res = await this.prisma.db.ledgerEntry.createMany({
      data: [
        {
          id: newId(),
          tenantId: input.tenantId,
          type: input.type,
          direction: input.direction,
          amount: String(amount),
          currency,
          refType: input.refType ?? '',
          refId: input.refId ?? '',
          dedupeKey,
          description: input.description ?? '',
          meta: (input.meta ?? {}) as object,
          recordedBy: input.recordedBy ?? '',
        },
      ],
      skipDuplicates: true,
    });

    // Post the balanced journal for this financial event (idempotent).
    await this.postJournal(input, dedupeKey, amount, currency);

    const entry = await this.prisma.db.ledgerEntry.findFirst({ where: { tenantId: input.tenantId, dedupeKey } });
    return { entry, created: res.count > 0 };
  }

  private async postJournal(input: LedgerInput, dedupeKey: string, amount: number, currency: string): Promise<void> {
    const journalId = newId();
    const created = await this.prisma.db.journalEntry.createMany({
      data: [
        {
          id: journalId,
          tenantId: input.tenantId,
          refType: input.refType ?? '',
          refId: input.refId ?? '',
          dedupeKey,
          description: input.description ?? '',
        },
      ],
      skipDuplicates: true,
    });
    if (created.count === 0) return; // already posted (replay)

    const lines = this.journalLines(input);
    const debit = lines.filter((l) => l.direction === 'debit').reduce((s) => s + amount, 0);
    const credit = lines.filter((l) => l.direction === 'credit').reduce((s) => s + amount, 0);
    if (round2(debit) !== round2(credit)) {
      // Defensive: a journal must never be persisted unbalanced.
      throw new InternalServerErrorException(`Unbalanced journal for ${dedupeKey}: debit=${debit} credit=${credit}`);
    }

    await this.prisma.db.journalLine.createMany({
      data: lines.map((line) => ({
        id: newId(),
        tenantId: input.tenantId,
        journalId,
        account: line.account,
        direction: line.direction,
        amount: String(amount),
        currency,
      })),
    });
  }

  async list(tenantId: string, query: ListLedgerQuery) {
    const where: Prisma.LedgerEntryWhereInput = { tenantId };
    if (query.type) where.type = query.type;
    if (query.direction) where.direction = query.direction;
    const page = await paginate<{ id: string }>({
      findMany: (args) => this.prisma.db.ledgerEntry.findMany(args as never) as Promise<{ id: string }[]>,
      where: where as Record<string, unknown>,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return { success: true, count: page.items.length, entries: page.items, nextCursor: page.nextCursor };
  }

  async summary(tenantId: string): Promise<LedgerSummary> {
    const rows = await this.prisma.db.ledgerEntry.groupBy({
      by: ['type', 'direction'],
      where: { tenantId },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const out: LedgerSummary = { credit: 0, debit: 0, net: 0, byType: {}, count: 0 };
    for (const row of rows) {
      const total = Number(row._sum.amount ?? 0);
      out.byType[row.type] = (out.byType[row.type] ?? 0) + total;
      out[row.direction] = (out[row.direction] ?? 0) + total;
      out.count += row._count._all;
    }
    out.net = out.credit - out.debit;
    return out;
  }

  /**
   * Reconciliation invariant: every journal's debits must equal its credits.
   * Returns the trial balance and a cross-check against the single-entry ledger.
   */
  async reconcile(tenantId: string): Promise<LedgerReconciliation> {
    const [journals, lines, unbalancedRows, lineGroups, ledger] = await Promise.all([
      this.prisma.db.journalEntry.count({ where: { tenantId } }),
      this.prisma.db.journalLine.count({ where: { tenantId } }),
      this.prisma.db.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM (
          SELECT j.id
          FROM "journal_entries" j
          JOIN "journal_lines" l ON l."journal_id" = j."id"
          WHERE j."tenant_id" = ${tenantId}::uuid
          GROUP BY j.id
          HAVING sum(CASE WHEN l."direction" = 'debit' THEN l."amount" ELSE 0 END)
               <> sum(CASE WHEN l."direction" = 'credit' THEN l."amount" ELSE 0 END)
        ) t
      `,
      this.prisma.db.journalLine.groupBy({ by: ['account', 'direction'], where: { tenantId }, _sum: { amount: true } }),
      this.summary(tenantId),
    ]);

    const byAccount = new Map<string, { debit: number; credit: number }>();
    for (const row of lineGroups) {
      const acc = byAccount.get(row.account) ?? { debit: 0, credit: 0 };
      acc[row.direction] += Number(row._sum.amount ?? 0);
      byAccount.set(row.account, acc);
    }
    const trialBalance = [...byAccount.entries()].map(([account, v]) => ({
      account,
      debit: round2(v.debit),
      credit: round2(v.credit),
      net: round2(v.debit - v.credit),
    }));

    const unbalancedJournals = Number(unbalancedRows[0]?.count ?? 0);
    return {
      journals,
      lines,
      unbalancedJournals,
      balanced: unbalancedJournals === 0,
      trialBalance,
      ledger: { credit: round2(ledger.credit), debit: round2(ledger.debit), net: round2(ledger.net) },
    };
  }
}
