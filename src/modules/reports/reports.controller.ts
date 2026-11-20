import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../utils/AppError.js";
import {
  contentDisposition,
  objectToTabular,
  renderExport,
  type ExportFormat,
} from "./export.util.js";
import * as executive from "./executive.service.js";
import * as financial from "./financial-reports.service.js";
import * as hr from "./hr-reports.service.js";
import * as inventory from "./inventory-reports.service.js";
import * as sales from "./sales-reports.service.js";
import * as schedules from "./schedules.service.js";

function tid(req: Request) {
  if (!req.tenant) throw new AppError("Tenant context required", 403);
  return req.tenant.tenantId;
}
function qstr(v: unknown) {
  return typeof v === "string" ? v : undefined;
}
function formatOf(req: Request): ExportFormat {
  const f = qstr(req.query.format) ?? "json";
  if (f === "json" || f === "csv" || f === "xlsx" || f === "pdf") return f;
  throw new AppError("Invalid format", 400);
}

async function sendReport(
  req: Request,
  res: Response,
  title: string,
  data: unknown
) {
  const format = formatOf(req);
  if (format === "json") {
    res.json({ success: true, data });
    return;
  }
  const tabular = objectToTabular(title, data);
  const exported = await renderExport(format, tabular);
  res.setHeader("Content-Type", exported.contentType);
  res.setHeader("Content-Disposition", contentDisposition(exported.filename));
  res.send(exported.body);
}

export const getExecutive = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await executive.executiveDashboard(
      tid(req),
      qstr(req.query.from),
      qstr(req.query.to)
    );
    await sendReport(req, res, "Executive_Dashboard", {
      ...data,
      rows: [
        {
          totalSales: data.kpis.totalSales,
          salesGrowthPct: data.kpis.salesGrowthPct,
          totalPurchases: data.kpis.totalPurchases,
          totalExpenses: data.kpis.totalExpenses,
          glNetIncome: data.kpis.glNetIncome,
          estimatedOperatingResult: data.kpis.estimatedOperatingResult,
          cashboxBalances: data.kpis.cashboxBalances,
          bankBalances: data.kpis.bankBalances,
          customerOutstanding: data.kpis.customerOutstanding,
          supplierOutstanding: data.kpis.supplierOutstanding,
          inventoryValue: data.kpis.inventoryValue,
          pendingApprovals: data.kpis.pendingApprovals,
          overdueTasks: data.kpis.overdueTasks,
        },
      ],
    });
  } catch (e) {
    next(e);
  }
};

export const compare = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = qstr(req.query.from);
    const to = qstr(req.query.to);
    if (!from || !to) throw new AppError("from and to are required", 400);
    const data = await executive.comparePeriods(tid(req), from, to);
    await sendReport(req, res, "Period_Comparison", data);
  } catch (e) {
    next(e);
  }
};

// Financial
export const incomeStatement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await financial.incomeStatement(tid(req), qstr(req.query.from), qstr(req.query.to));
    await sendReport(req, res, "Income_Statement", {
      ...data,
      rows: data.revenue.map((r) => ({ section: "revenue", ...r })).concat(
        data.expenses.map((r) => ({ section: "expense", ...r }))
      ),
    });
  } catch (e) {
    next(e);
  }
};
export const balanceSheet = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await financial.balanceSheet(tid(req), qstr(req.query.asOf));
    await sendReport(req, res, "Balance_Sheet", data);
  } catch (e) {
    next(e);
  }
};
export const cashFlow = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await financial.cashFlow(tid(req), qstr(req.query.from), qstr(req.query.to));
    await sendReport(req, res, "Cash_Flow", data);
  } catch (e) {
    next(e);
  }
};
export const trialBalance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await financial.trialBalance(tid(req), qstr(req.query.from), qstr(req.query.to));
    await sendReport(req, res, "Trial_Balance", data);
  } catch (e) {
    next(e);
  }
};
export const generalLedger = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = qstr(req.query.accountId);
    if (!accountId) throw new AppError("accountId required", 400);
    const data = await financial.generalLedger(
      tid(req),
      accountId,
      qstr(req.query.from),
      qstr(req.query.to)
    );
    await sendReport(req, res, "General_Ledger", { ...data, rows: data.entries });
  } catch (e) {
    next(e);
  }
};
export const customerBalances = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(req, res, "Customer_Balances", await financial.customerBalances(tid(req)));
  } catch (e) {
    next(e);
  }
};
export const supplierBalances = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(req, res, "Supplier_Balances", await financial.supplierBalances(tid(req)));
  } catch (e) {
    next(e);
  }
};
export const expenseAnalysis = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(
      req,
      res,
      "Expense_Analysis",
      await financial.expenseAnalysis(tid(req), qstr(req.query.from), qstr(req.query.to))
    );
  } catch (e) {
    next(e);
  }
};

// Sales
export const salesByPeriod = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(
      req,
      res,
      "Sales_By_Period",
      await sales.salesByPeriod(
        tid(req),
        qstr(req.query.from),
        qstr(req.query.to),
        qstr(req.query.bucket)
      )
    );
  } catch (e) {
    next(e);
  }
};
export const salesByCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(
      req,
      res,
      "Sales_By_Customer",
      await sales.salesByCustomer(tid(req), qstr(req.query.from), qstr(req.query.to))
    );
  } catch (e) {
    next(e);
  }
};
export const salesByProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(
      req,
      res,
      "Sales_By_Product",
      await sales.salesByProduct(tid(req), qstr(req.query.from), qstr(req.query.to))
    );
  } catch (e) {
    next(e);
  }
};
export const salesByEmployee = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(
      req,
      res,
      "Sales_By_Employee",
      await sales.salesByEmployee(tid(req), qstr(req.query.from), qstr(req.query.to))
    );
  } catch (e) {
    next(e);
  }
};
export const salesReturns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(
      req,
      res,
      "Sales_Returns",
      await sales.salesReturnsReport(tid(req), qstr(req.query.from), qstr(req.query.to))
    );
  } catch (e) {
    next(e);
  }
};
export const discounts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(
      req,
      res,
      "Discounts",
      await sales.discountsReport(tid(req), qstr(req.query.from), qstr(req.query.to))
    );
  } catch (e) {
    next(e);
  }
};

// Inventory
export const currentStock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(req, res, "Current_Stock", await inventory.currentStock(tid(req)));
  } catch (e) {
    next(e);
  }
};
export const stockValuation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(req, res, "Stock_Valuation", await inventory.stockValuation(tid(req)));
  } catch (e) {
    next(e);
  }
};
export const stockMovements = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(
      req,
      res,
      "Stock_Movements",
      await inventory.stockMovements(tid(req), qstr(req.query.from), qstr(req.query.to))
    );
  } catch (e) {
    next(e);
  }
};
export const lowStock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(req, res, "Low_Stock", await inventory.lowStock(tid(req)));
  } catch (e) {
    next(e);
  }
};
export const inventoryAging = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(req, res, "Inventory_Aging", await inventory.inventoryAging(tid(req)));
  } catch (e) {
    next(e);
  }
};
export const stockCountDiffs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(
      req,
      res,
      "Stock_Count_Differences",
      await inventory.stockCountDifferences(tid(req))
    );
  } catch (e) {
    next(e);
  }
};
export const productProfitability = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(
      req,
      res,
      "Product_Profitability",
      await inventory.productProfitability(tid(req), qstr(req.query.from), qstr(req.query.to))
    );
  } catch (e) {
    next(e);
  }
};

// HR
export const attendance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(
      req,
      res,
      "Attendance",
      await hr.attendanceReport(tid(req), qstr(req.query.from), qstr(req.query.to))
    );
  } catch (e) {
    next(e);
  }
};
export const absence = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(
      req,
      res,
      "Absence",
      await hr.absenceReport(tid(req), qstr(req.query.from), qstr(req.query.to))
    );
  } catch (e) {
    next(e);
  }
};
export const overtime = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(
      req,
      res,
      "Overtime",
      await hr.overtimeReport(tid(req), qstr(req.query.from), qstr(req.query.to))
    );
  } catch (e) {
    next(e);
  }
};
export const leaveBalances = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const year = qstr(req.query.year) ? Number(req.query.year) : undefined;
    await sendReport(req, res, "Leave_Balances", await hr.leaveBalancesReport(tid(req), year));
  } catch (e) {
    next(e);
  }
};
export const payrollSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sendReport(
      req,
      res,
      "Payroll_Summary",
      await hr.payrollSummary(tid(req), qstr(req.query.from), qstr(req.query.to))
    );
  } catch (e) {
    next(e);
  }
};

// ---- Schedules ----
function param(v: string | string[] | undefined) {
  if (typeof v === "string" && v) return v;
  throw new AppError("Missing route parameter", 400);
}

export const listSchedules = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await schedules.listSchedules(tid(req)) } });
  } catch (e) {
    next(e);
  }
};

export const createSchedule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await schedules.createSchedule(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const updateSchedule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await schedules.updateSchedule(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const deleteSchedule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await schedules.deleteSchedule(tid(req), param(req.params.id));
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
};

export const runSchedule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await schedules.runSchedule(tid(req), param(req.params.id), req.user?.id);
    res.status(201).json({
      success: true,
      data: {
        runId: result.runId,
        run: {
          id: result.run.id,
          scheduleId: result.run.scheduleId,
          startedAt: result.run.startedAt,
          finishedAt: result.run.finishedAt,
          status: result.run.status,
          fileId: result.run.filePublicId,
          fileSecureUrl: result.run.fileSecureUrl,
          fileName: result.run.fileName,
          error: result.run.error,
        },
        downloadPath: result.downloadPath,
      },
    });
  } catch (e) {
    next(e);
  }
};

export const downloadScheduleRun = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await schedules.getRun(tid(req), param(req.params.runId));
    if (run.status !== "SUCCESS" || !run.fileSecureUrl) {
      throw new AppError("Export file not available", 404);
    }
    res.setHeader("Content-Disposition", contentDisposition(run.fileName || "report.bin"));
    res.redirect(302, run.fileSecureUrl);
  } catch (e) {
    next(e);
  }
};
