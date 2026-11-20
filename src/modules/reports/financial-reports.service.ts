import { FinDocStatus, PurchaseDocStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireTenantId } from "../../lib/tenantDb.js";
import type { TenantId } from "../../types/tenant.js";
import * as accountingReports from "../accounting/reports.service.js";
import * as financeStatements from "../finance/statements.service.js";
import { n, parseRange, round4 } from "./period.js";

export async function incomeStatement(tenantId: TenantId, from?: string, to?: string) {
  const data = await accountingReports.incomeStatement(tenantId, from, to);
  return {
    ...data,
    definitions: {
      totalRevenue: "GL REVENUE accounts: sum(credit - debit) on posted journals in period",
      totalExpenses: "GL EXPENSE accounts: sum(debit - credit) on posted journals in period",
      netIncome: "totalRevenue - totalExpenses (accounting net income, not cash)",
    },
  };
}

export async function balanceSheet(tenantId: TenantId, asOf?: string) {
  const data = await accountingReports.balanceSheet(tenantId, asOf);
  return {
    ...data,
    definitions: {
      totalAssets: "GL ASSET net (debit - credit) as of date",
      totalLiabilities: "GL LIABILITY net (credit - debit)",
      totalEquity: "GL EQUITY net + period netIncome",
    },
  };
}

export async function cashFlow(tenantId: TenantId, from?: string, to?: string) {
  const [gl, treasury] = await Promise.all([
    accountingReports.cashFlowStatement(tenantId, from, to),
    financeStatements.cashFlowSummary(tenantId, from, to),
  ]);
  return {
    from: from ?? null,
    to: to ?? null,
    glCashFlow: gl,
    treasuryCashFlow: treasury,
    definitions: {
      glCashFlow: "Posted journal lines on CASH/BANK systemRole accounts",
      treasuryCashFlow: "Immutable TreasuryMovement IN/OUT in period (cashbook)",
    },
  };
}

export async function trialBalance(tenantId: TenantId, from?: string, to?: string) {
  return accountingReports.trialBalance(tenantId, from, to);
}

export async function generalLedger(
  tenantId: TenantId,
  accountId: string,
  from?: string,
  to?: string
) {
  return accountingReports.generalLedger(tenantId, accountId, from, to);
}

export async function customerBalances(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const entries = await prisma.customerLedgerEntry.groupBy({
    by: ["customerId", "direction"],
    where: { organizationId: tid },
    _sum: { amount: true },
  });
  const customers = await prisma.customer.findMany({
    where: { organizationId: tid },
    select: { id: true, code: true, name: true },
  });
  const names = new Map(customers.map((c) => [c.id, c]));
  const map = new Map<string, number>();
  for (const e of entries) {
    const signed = e.direction === "DEBIT" ? n(e._sum.amount) : -n(e._sum.amount);
    map.set(e.customerId, (map.get(e.customerId) ?? 0) + signed);
  }
  const rows = [...map.entries()]
    .map(([customerId, balance]) => ({
      customerId,
      code: names.get(customerId)?.code ?? "",
      name: names.get(customerId)?.name ?? "",
      /** Positive = customer owes (receivable). */
      outstandingBalance: round4(balance),
    }))
    .filter((r) => Math.abs(r.outstandingBalance) > 0.0001)
    .sort((a, b) => b.outstandingBalance - a.outstandingBalance);

  return {
    definitions: {
      outstandingBalance:
        "Sum(customer ledger DEBIT amounts) - Sum(CREDIT amounts). Positive = receivable.",
    },
    totalReceivable: round4(
      rows.filter((r) => r.outstandingBalance > 0).reduce((s, r) => s + r.outstandingBalance, 0)
    ),
    rows,
    items: rows,
  };
}

export async function supplierBalances(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const entries = await prisma.supplierLedgerEntry.groupBy({
    by: ["supplierId", "direction"],
    where: { organizationId: tid },
    _sum: { amount: true },
  });
  const suppliers = await prisma.supplier.findMany({
    where: { organizationId: tid },
    select: { id: true, code: true, name: true },
  });
  const names = new Map(suppliers.map((s) => [s.id, s]));
  const map = new Map<string, number>();
  for (const e of entries) {
    // Payable: CREDIT increases what we owe; DEBIT decreases
    const signed = e.direction === "CREDIT" ? n(e._sum.amount) : -n(e._sum.amount);
    map.set(e.supplierId, (map.get(e.supplierId) ?? 0) + signed);
  }
  const rows = [...map.entries()]
    .map(([supplierId, balance]) => ({
      supplierId,
      code: names.get(supplierId)?.code ?? "",
      name: names.get(supplierId)?.name ?? "",
      /** Positive = we owe supplier (payable). */
      outstandingBalance: round4(balance),
    }))
    .filter((r) => Math.abs(r.outstandingBalance) > 0.0001)
    .sort((a, b) => b.outstandingBalance - a.outstandingBalance);

  return {
    definitions: {
      outstandingBalance:
        "Sum(supplier ledger CREDIT) - Sum(DEBIT). Positive = payable.",
    },
    totalPayable: round4(
      rows.filter((r) => r.outstandingBalance > 0).reduce((s, r) => s + r.outstandingBalance, 0)
    ),
    rows,
    items: rows,
  };
}

export async function expenseAnalysis(tenantId: TenantId, from?: string, to?: string) {
  const tid = requireTenantId(tenantId);
  const range = parseRange(from, to);
  const list = await prisma.expense.findMany({
    where: {
      organizationId: tid,
      status: FinDocStatus.POSTED,
      ...(range.from || range.to
        ? {
            expenseDate: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lte: range.to } : {}),
            },
          }
        : {}),
    },
    include: { category: true, costCenter: true },
  });

  const byCategory = new Map<string, { category: string; total: number; count: number }>();
  for (const e of list) {
    const key = e.category?.name ?? "Uncategorized";
    const cur = byCategory.get(key) ?? { category: key, total: 0, count: 0 };
    cur.total += n(e.totalAmount);
    cur.count += 1;
    byCategory.set(key, cur);
  }

  const rows = [...byCategory.values()]
    .map((r) => ({ ...r, total: round4(r.total) }))
    .sort((a, b) => b.total - a.total);

  return {
    from: from ?? null,
    to: to ?? null,
    totalExpenses: round4(list.reduce((s, e) => s + n(e.totalAmount), 0)),
    definitions: {
      totalExpenses: "Sum of posted Expense.totalAmount in period (treasury expenses, not GL)",
    },
    rows,
    items: rows,
    detail: list.map((e) => ({
      code: e.code,
      title: e.title,
      category: e.category?.name,
      totalAmount: n(e.totalAmount),
      expenseDate: e.expenseDate,
    })),
  };
}

export async function purchasesTotal(tenantId: TenantId, from?: string, to?: string) {
  const tid = requireTenantId(tenantId);
  const range = parseRange(from, to);
  const agg = await prisma.purchaseInvoice.aggregate({
    where: {
      organizationId: tid,
      status: PurchaseDocStatus.POSTED,
      ...(range.from || range.to
        ? {
            invoiceDate: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lte: range.to } : {}),
            },
          }
        : {}),
    },
    _sum: { totalAmount: true },
    _count: true,
  });
  return {
    from: from ?? null,
    to: to ?? null,
    totalPurchases: round4(n(agg._sum.totalAmount)),
    invoiceCount: agg._count,
    definitions: {
      totalPurchases: "Sum of posted PurchaseInvoice.totalAmount in period",
    },
  };
}

export async function expensesTotal(tenantId: TenantId, from?: string, to?: string) {
  const analysis = await expenseAnalysis(tenantId, from, to);
  return {
    from: analysis.from,
    to: analysis.to,
    totalExpenses: analysis.totalExpenses,
    definitions: analysis.definitions,
  };
}
