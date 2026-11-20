import { ApprovalInstanceStatus, OpsTaskStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireTenantId } from "../../lib/tenantDb.js";
import type { TenantId } from "../../types/tenant.js";
import * as financeStatements from "../finance/statements.service.js";
import * as invBalances from "../inventory/balances.service.js";
import * as invReports from "../inventory/reports.service.js";
import * as financial from "./financial-reports.service.js";
import * as hr from "./hr-reports.service.js";
import { growthPct, parseRange, previousPeriod, round4 } from "./period.js";
import * as sales from "./sales-reports.service.js";

/**
 * Executive dashboard — all KPIs from live tenant data.
 * Revenue metrics are never labeled as profit.
 */
export async function executiveDashboard(
  tenantId: TenantId,
  from?: string,
  to?: string
) {
  const tid = requireTenantId(tenantId);
  const now = new Date();
  const defaultFrom = from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const defaultTo = to ?? now.toISOString();

  const [
    salesPeriod,
    purchases,
    expenses,
    income,
    treasury,
    valuation,
    lowStock,
    ar,
    ap,
    employees,
    pendingApprovals,
    overdueTasks,
    topProducts,
    topCustomers,
  ] = await Promise.all([
    sales.salesByPeriod(tid, defaultFrom, defaultTo),
    financial.purchasesTotal(tid, defaultFrom, defaultTo),
    financial.expensesTotal(tid, defaultFrom, defaultTo),
    financial.incomeStatement(tid, defaultFrom, defaultTo),
    financeStatements.treasuryDashboard(tid),
    invBalances.inventoryValuation(tid),
    invReports.lowStockAlerts(tid),
    financial.customerBalances(tid),
    financial.supplierBalances(tid),
    hr.employeeStats(tid),
    prisma.approvalInstance.count({
      where: {
        organizationId: tid,
        status: {
          in: [ApprovalInstanceStatus.PENDING, ApprovalInstanceStatus.ESCALATED],
        },
      },
    }),
    prisma.opsTask.count({
      where: {
        organizationId: tid,
        dueAt: { lt: now },
        status: { notIn: [OpsTaskStatus.DONE, OpsTaskStatus.CANCELLED] },
      },
    }),
    sales.salesByProduct(tid, defaultFrom, defaultTo),
    sales.salesByCustomer(tid, defaultFrom, defaultTo),
  ]);

  // Estimated operating profit indicator from operational ledgers (not GL net income):
  // sales revenue - purchases - treasury expenses. Clearly separated from GL netIncome.
  const estimatedOperatingResult = round4(
    salesPeriod.totalSales - purchases.totalPurchases - expenses.totalExpenses
  );

  return {
    generatedAt: now.toISOString(),
    period: { from: defaultFrom, to: defaultTo },
    definitions: {
      totalSales:
        "Posted SalesInvoice.totalAmount + completed PosSale(type=SALE).totalAmount in period (REVENUE, not profit)",
      salesGrowthPct: salesPeriod.definitions.salesGrowthPct,
      totalPurchases: purchases.definitions.totalPurchases,
      totalExpenses: expenses.definitions.totalExpenses,
      glNetIncome:
        "From posted GL journals: REVENUE − EXPENSE accounts (accounting net income)",
      estimatedOperatingResult:
        "totalSales − totalPurchases − posted treasury expenses — INDICATOR ONLY, not statutory profit",
      inventoryValue: "Sum of StockBalance.totalValue (WAC)",
      customerOutstanding: "Positive customer ledger balances (receivables)",
      supplierOutstanding: "Positive supplier ledger balances (payables)",
    },
    kpis: {
      totalSales: salesPeriod.totalSales,
      salesGrowthPct: salesPeriod.compare?.salesGrowthPct ?? null,
      totalPurchases: purchases.totalPurchases,
      totalExpenses: expenses.totalExpenses,
      glNetIncome: income.netIncome,
      estimatedOperatingResult,
      cashboxBalances: treasury.cashTotal,
      bankBalances: treasury.bankTotal,
      treasuryTotal: treasury.treasuryTotal,
      customerOutstanding: ar.totalReceivable,
      supplierOutstanding: ap.totalPayable,
      inventoryValue: valuation.totalValue,
      lowStockCount: lowStock.count,
      pendingApprovals,
      overdueTasks,
      ...employees,
    },
    treasury: {
      cashboxes: treasury.cashboxes,
      banks: treasury.banks,
    },
    lowStockProducts: lowStock.items.slice(0, 20),
    topSellingProducts: topProducts.rows.slice(0, 10),
    topCustomers: topCustomers.rows.slice(0, 10),
  };
}

export async function comparePeriods(
  tenantId: TenantId,
  from: string,
  to: string
) {
  const cur = parseRange(from, to);
  if (!cur.from || !cur.to) {
    return { error: "from and to required" };
  }
  const prev = previousPeriod(cur.from, cur.to);
  const [currentSales, previousSales, currentPurchases, previousPurchases, currentExpenses, previousExpenses] =
    await Promise.all([
      sales.salesRevenueTotal(tenantId, from, to),
      sales.salesRevenueTotal(tenantId, prev.from.toISOString(), prev.to.toISOString()),
      financial.purchasesTotal(tenantId, from, to),
      financial.purchasesTotal(tenantId, prev.from.toISOString(), prev.to.toISOString()),
      financial.expensesTotal(tenantId, from, to),
      financial.expensesTotal(tenantId, prev.from.toISOString(), prev.to.toISOString()),
    ]);

  return {
    current: { from, to, sales: currentSales, purchases: currentPurchases, expenses: currentExpenses },
    previous: {
      from: prev.from.toISOString(),
      to: prev.to.toISOString(),
      sales: previousSales,
      purchases: previousPurchases,
      expenses: previousExpenses,
    },
    growth: {
      salesPct: growthPct(currentSales.totalSales, previousSales.totalSales),
      purchasesPct: growthPct(currentPurchases.totalPurchases, previousPurchases.totalPurchases),
      expensesPct: growthPct(currentExpenses.totalExpenses, previousExpenses.totalExpenses),
    },
  };
}
