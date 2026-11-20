/** Whitelisted report paths for scheduling (no free-form paths). */
export const REPORT_CATALOG = [
  "/tenant/reports/dashboard/executive",
  "/tenant/reports/compare",
  "/tenant/reports/financial/income-statement",
  "/tenant/reports/financial/balance-sheet",
  "/tenant/reports/financial/cash-flow",
  "/tenant/reports/financial/trial-balance",
  "/tenant/reports/financial/customer-balances",
  "/tenant/reports/financial/supplier-balances",
  "/tenant/reports/financial/expenses",
  "/tenant/reports/sales/by-period",
  "/tenant/reports/sales/by-customer",
  "/tenant/reports/sales/by-product",
  "/tenant/reports/sales/by-employee",
  "/tenant/reports/sales/returns",
  "/tenant/reports/sales/discounts",
  "/tenant/reports/inventory/stock",
  "/tenant/reports/inventory/valuation",
  "/tenant/reports/inventory/movements",
  "/tenant/reports/inventory/low-stock",
  "/tenant/reports/inventory/aging",
  "/tenant/reports/inventory/count-differences",
  "/tenant/reports/inventory/product-profitability",
  "/tenant/reports/hr/attendance",
  "/tenant/reports/hr/absence",
  "/tenant/reports/hr/overtime",
  "/tenant/reports/hr/leave-balances",
  "/tenant/reports/hr/payroll-summary",
] as const;

export type ReportCatalogPath = (typeof REPORT_CATALOG)[number];

export function isAllowedReportPath(path: string): path is ReportCatalogPath {
  return (REPORT_CATALOG as readonly string[]).includes(path);
}
