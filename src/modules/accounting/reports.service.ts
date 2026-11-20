import { GlAccountType, JournalStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

function n(v: unknown) {
  return Number(v ?? 0);
}

async function postedLines(
  tid: string,
  opts?: { from?: string; to?: string; accountId?: string }
) {
  return prisma.journalLine.findMany({
    where: {
      organizationId: tid,
      ...(opts?.accountId ? { accountId: opts.accountId } : {}),
      journal: {
        organizationId: tid,
        status: JournalStatus.POSTED,
        ...(opts?.from || opts?.to
          ? {
              entryDate: {
                ...(opts?.from ? { gte: new Date(opts.from) } : {}),
                ...(opts?.to ? { lte: new Date(opts.to) } : {}),
              },
            }
          : {}),
      },
    },
    include: {
      account: true,
      journal: { select: { id: true, code: true, entryDate: true, description: true, eventType: true } },
    },
    orderBy: [{ journal: { entryDate: "asc" } }, { lineNo: "asc" }],
  });
}

export async function trialBalance(tenantId: TenantId, from?: string, to?: string) {
  const tid = requireTenantId(tenantId);
  const lines = await postedLines(tid, { from, to });
  const map = new Map<
    string,
    { accountId: string; code: string; name: string; type: GlAccountType; debit: number; credit: number }
  >();
  for (const l of lines) {
    const cur = map.get(l.accountId) ?? {
      accountId: l.accountId,
      code: l.account.code,
      name: l.account.name,
      type: l.account.type,
      debit: 0,
      credit: 0,
    };
    cur.debit += n(l.debit);
    cur.credit += n(l.credit);
    map.set(l.accountId, cur);
  }
  const accounts = [...map.values()]
    .map((a) => ({
      ...a,
      debit: Number(a.debit.toFixed(4)),
      credit: Number(a.credit.toFixed(4)),
      balance: Number((a.debit - a.credit).toFixed(4)),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const totalDebit = Number(accounts.reduce((s, a) => s + a.debit, 0).toFixed(4));
  const totalCredit = Number(accounts.reduce((s, a) => s + a.credit, 0).toFixed(4));
  return {
    from: from ?? null,
    to: to ?? null,
    accounts,
    totalDebit,
    totalCredit,
    balanced: Math.abs(totalDebit - totalCredit) < 0.01,
  };
}

export async function generalLedger(
  tenantId: TenantId,
  accountId: string,
  from?: string,
  to?: string
) {
  const tid = requireTenantId(tenantId);
  const account = await prisma.glAccount.findFirst({
    where: { id: accountId, organizationId: tid },
  });
  if (!account) throw new AppError("Account not found", 404);
  const lines = await postedLines(tid, { accountId, from, to });
  let running = 0;
  const entries = lines.map((l) => {
    running += n(l.debit) - n(l.credit);
    return {
      journalId: l.journal.id,
      journalCode: l.journal.code,
      entryDate: l.journal.entryDate,
      description: l.journal.description,
      eventType: l.journal.eventType,
      debit: n(l.debit),
      credit: n(l.credit),
      balance: Number(running.toFixed(4)),
      memo: l.memo,
    };
  });
  return {
    account: {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
    },
    from: from ?? null,
    to: to ?? null,
    entries,
    closingBalance: Number(running.toFixed(4)),
  };
}

export async function accountStatement(
  tenantId: TenantId,
  accountId: string,
  from?: string,
  to?: string
) {
  return generalLedger(tenantId, accountId, from, to);
}

export async function incomeStatement(tenantId: TenantId, from?: string, to?: string) {
  const tb = await trialBalance(tenantId, from, to);
  const revenue = tb.accounts.filter((a) => a.type === GlAccountType.REVENUE);
  const expenses = tb.accounts.filter((a) => a.type === GlAccountType.EXPENSE);
  // Revenue credit-normal: net = credit - debit; Expense debit-normal: net = debit - credit
  const revenueTotal = Number(
    revenue.reduce((s, a) => s + (a.credit - a.debit), 0).toFixed(4)
  );
  const expenseTotal = Number(
    expenses.reduce((s, a) => s + (a.debit - a.credit), 0).toFixed(4)
  );
  return {
    from: from ?? null,
    to: to ?? null,
    revenue: revenue.map((a) => ({ ...a, net: Number((a.credit - a.debit).toFixed(4)) })),
    expenses: expenses.map((a) => ({ ...a, net: Number((a.debit - a.credit).toFixed(4)) })),
    totalRevenue: revenueTotal,
    totalExpenses: expenseTotal,
    netIncome: Number((revenueTotal - expenseTotal).toFixed(4)),
  };
}

export async function balanceSheet(tenantId: TenantId, asOf?: string) {
  const tb = await trialBalance(tenantId, undefined, asOf);
  const assets = tb.accounts.filter((a) => a.type === GlAccountType.ASSET);
  const liabilities = tb.accounts.filter((a) => a.type === GlAccountType.LIABILITY);
  const equity = tb.accounts.filter((a) => a.type === GlAccountType.EQUITY);
  const pl = await incomeStatement(tenantId, undefined, asOf);

  const assetTotal = Number(assets.reduce((s, a) => s + (a.debit - a.credit), 0).toFixed(4));
  const liabilityTotal = Number(
    liabilities.reduce((s, a) => s + (a.credit - a.debit), 0).toFixed(4)
  );
  const equityTotal = Number(
    equity.reduce((s, a) => s + (a.credit - a.debit), 0).toFixed(4)
  );
  const equityWithPl = Number((equityTotal + pl.netIncome).toFixed(4));

  return {
    asOf: asOf ?? null,
    assets: assets.map((a) => ({ ...a, net: Number((a.debit - a.credit).toFixed(4)) })),
    liabilities: liabilities.map((a) => ({
      ...a,
      net: Number((a.credit - a.debit).toFixed(4)),
    })),
    equity: equity.map((a) => ({ ...a, net: Number((a.credit - a.debit).toFixed(4)) })),
    netIncome: pl.netIncome,
    totalAssets: assetTotal,
    totalLiabilities: liabilityTotal,
    totalEquity: equityWithPl,
    balanced: Math.abs(assetTotal - (liabilityTotal + equityWithPl)) < 0.01,
  };
}

/** Simple cash-flow from posted movements on CASH/BANK role accounts. */
export async function cashFlowStatement(tenantId: TenantId, from?: string, to?: string) {
  const tid = requireTenantId(tenantId);
  const cashAccounts = await prisma.glAccount.findMany({
    where: {
      organizationId: tid,
      systemRole: { in: ["CASH", "BANK"] },
      status: "ACTIVE",
    },
  });
  const ids = cashAccounts.map((a) => a.id);
  if (!ids.length) {
    return { from: from ?? null, to: to ?? null, inflow: 0, outflow: 0, net: 0, lines: [] };
  }

  const lines = await prisma.journalLine.findMany({
    where: {
      organizationId: tid,
      accountId: { in: ids },
      journal: {
        status: JournalStatus.POSTED,
        ...(from || to
          ? {
              entryDate: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
    },
    include: {
      account: true,
      journal: { select: { code: true, entryDate: true, eventType: true, description: true } },
    },
    orderBy: { journal: { entryDate: "asc" } },
  });

  let inflow = 0;
  let outflow = 0;
  const mapped = lines.map((l) => {
    const debit = n(l.debit);
    const credit = n(l.credit);
    inflow += debit;
    outflow += credit;
    return {
      journalCode: l.journal.code,
      entryDate: l.journal.entryDate,
      eventType: l.journal.eventType,
      accountCode: l.account.code,
      inflow: debit,
      outflow: credit,
      description: l.journal.description,
    };
  });

  return {
    from: from ?? null,
    to: to ?? null,
    inflow: Number(inflow.toFixed(4)),
    outflow: Number(outflow.toFixed(4)),
    net: Number((inflow - outflow).toFixed(4)),
    lines: mapped,
  };
}

export async function journalReport(tenantId: TenantId, from?: string, to?: string) {
  const tid = requireTenantId(tenantId);
  const items = await prisma.journalEntry.findMany({
    where: {
      organizationId: tid,
      ...(from || to
        ? {
            entryDate: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    },
    include: { lines: { include: { account: true }, orderBy: { lineNo: "asc" } } },
    orderBy: { entryDate: "asc" },
  });
  return {
    from: from ?? null,
    to: to ?? null,
    count: items.length,
    items,
  };
}
