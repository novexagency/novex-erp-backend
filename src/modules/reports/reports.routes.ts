import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { requireAnyPermission } from "../../middleware/requirePermission.js";
import { requireTenant, tenantContext } from "../../middleware/tenantContext.js";
import { validate } from "../../middleware/validate.js";
import * as c from "./reports.controller.js";
import { createScheduleSchema, updateScheduleSchema } from "./reports.validation.js";

const router = Router();
router.use(authGuard, tenantContext, requireTenant);

const dash = requireAnyPermission("dashboard:read", "dashboard:manage", "reports:read", "reports:manage");
const reports = requireAnyPermission("reports:read", "reports:manage");
const finance = requireAnyPermission(
  "reports:finance",
  "reports:manage",
  "reports:read",
  "accounting:read",
  "accounting:view",
  "finance:read",
  "finance:view"
);
const salesPerm = requireAnyPermission("reports:sales", "reports:manage", "reports:read", "sales:read", "sales:view");
const invPerm = requireAnyPermission(
  "reports:inventory",
  "reports:manage",
  "reports:read",
  "inventory:read",
  "inventory:view"
);
const hrPerm = requireAnyPermission("reports:hr", "reports:manage", "reports:read", "hr:read", "hr:view");
const exportPerm = requireAnyPermission("reports:export", "reports:manage");

// Schedules (before export middleware — JSON APIs; run needs export)
router.get("/schedules", reports, c.listSchedules);
router.post("/schedules", exportPerm, validate(createScheduleSchema), c.createSchedule);
router.patch("/schedules/:id", exportPerm, validate(updateScheduleSchema), c.updateSchedule);
router.delete("/schedules/:id", exportPerm, c.deleteSchedule);
router.post("/schedules/:id/run", exportPerm, c.runSchedule);
router.get("/schedules/runs/:runId/download", exportPerm, c.downloadScheduleRun);

// Export formats use the same handlers (?format=csv|xlsx|pdf). Export permission required for non-json.
router.use((req, res, next) => {
  const format = typeof req.query.format === "string" ? req.query.format : "json";
  if (format === "json") return next();
  return exportPerm(req, res, next);
});

router.get("/dashboard/executive", dash, c.getExecutive);
router.get("/compare", reports, c.compare);

router.get("/financial/income-statement", finance, c.incomeStatement);
router.get("/financial/balance-sheet", finance, c.balanceSheet);
router.get("/financial/cash-flow", finance, c.cashFlow);
router.get("/financial/trial-balance", finance, c.trialBalance);
router.get("/financial/general-ledger", finance, c.generalLedger);
router.get("/financial/customer-balances", finance, c.customerBalances);
router.get("/financial/supplier-balances", finance, c.supplierBalances);
router.get("/financial/expenses", finance, c.expenseAnalysis);

router.get("/sales/by-period", salesPerm, c.salesByPeriod);
router.get("/sales/by-customer", salesPerm, c.salesByCustomer);
router.get("/sales/by-product", salesPerm, c.salesByProduct);
router.get("/sales/by-employee", salesPerm, c.salesByEmployee);
router.get("/sales/returns", salesPerm, c.salesReturns);
router.get("/sales/discounts", salesPerm, c.discounts);

router.get("/inventory/stock", invPerm, c.currentStock);
router.get("/inventory/valuation", invPerm, c.stockValuation);
router.get("/inventory/movements", invPerm, c.stockMovements);
router.get("/inventory/low-stock", invPerm, c.lowStock);
router.get("/inventory/aging", invPerm, c.inventoryAging);
router.get("/inventory/count-differences", invPerm, c.stockCountDiffs);
router.get("/inventory/product-profitability", invPerm, c.productProfitability);

router.get("/hr/attendance", hrPerm, c.attendance);
router.get("/hr/absence", hrPerm, c.absence);
router.get("/hr/overtime", hrPerm, c.overtime);
router.get("/hr/leave-balances", hrPerm, c.leaveBalances);
router.get("/hr/payroll-summary", hrPerm, c.payrollSummary);

export default router;
