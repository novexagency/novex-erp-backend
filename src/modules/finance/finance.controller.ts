import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../utils/AppError.js";
import * as accounts from "./accounts.service.js";
import * as expenses from "./expenses.service.js";
import * as statements from "./statements.service.js";
import * as vouchers from "./vouchers.service.js";

function tid(req: Request) {
  if (!req.tenant) throw new AppError("Tenant context required", 403);
  return req.tenant.tenantId;
}
function uid(req: Request) {
  if (!req.user?.id) throw new AppError("Authenticated user required", 401);
  return req.user.id;
}
function param(v: string | string[] | undefined) {
  if (typeof v === "string" && v) return v;
  throw new AppError("Missing route parameter", 400);
}
function qstr(v: unknown) {
  return typeof v === "string" ? v : undefined;
}

// —— Accounts ——
export const createCashbox = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await accounts.createCashbox(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listCashboxes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await accounts.listCashboxes(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createBankAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await accounts.createBankAccount(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listBankAccounts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await accounts.listBankAccounts(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const postManualMovement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await accounts.postManualMovement(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const createTransfer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await accounts.createTransfer(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listTransfers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await statements.listTransfers(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const postTransfer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await accounts.postTransfer(tid(req), param(req.params.id), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const cancelTransfer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await accounts.cancelTransfer(
      tid(req),
      param(req.params.id),
      req.body.reason,
      uid(req),
      req.body.authorized
    );
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const reconcile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await accounts.reconcileAccount(tid(req), req.body);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};

// —— Receipts ——
export const createReceipt = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await vouchers.createFinReceipt(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listReceipts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await vouchers.listFinReceipts(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const postReceipt = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await vouchers.postFinReceipt(tid(req), param(req.params.id), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const cancelReceipt = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await vouchers.cancelFinReceipt(
      tid(req),
      param(req.params.id),
      req.body.reason,
      uid(req),
      req.body.authorized
    );
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

// —— Payments ——
export const createPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await vouchers.createFinPayment(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listPayments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await vouchers.listFinPayments(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const postPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await vouchers.postFinPayment(tid(req), param(req.params.id), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const cancelPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await vouchers.cancelFinPayment(
      tid(req),
      param(req.params.id),
      req.body.reason,
      uid(req),
      req.body.authorized
    );
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

// —— Expenses ——
export const createCostCenter = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await expenses.createCostCenter(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listCostCenters = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await expenses.listCostCenters(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createExpense = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await expenses.createExpense(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listExpenses = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: { items: await expenses.listExpenses(tid(req), qstr(req.query.status)) },
    });
  } catch (e) {
    next(e);
  }
};
export const approveExpense = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await expenses.approveExpense(tid(req), param(req.params.id), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const postExpense = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await expenses.postExpense(tid(req), param(req.params.id), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const cancelExpense = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await expenses.cancelExpense(
      tid(req),
      param(req.params.id),
      req.body.reason,
      uid(req),
      req.body.authorized
    );
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const addExpenseAttachment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await expenses.addExpenseAttachment(tid(req), param(req.params.id), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const createRecurringExpense = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await expenses.createRecurringExpense(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listRecurringExpenses = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await expenses.listRecurringExpenses(tid(req)) } });
  } catch (e) {
    next(e);
  }
};

// —— Statements / reports ——
export const cashboxStatement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await statements.cashboxStatement(
      tid(req),
      param(req.params.id),
      qstr(req.query.from),
      qstr(req.query.to)
    );
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const bankStatement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await statements.bankStatement(
      tid(req),
      param(req.params.id),
      qstr(req.query.from),
      qstr(req.query.to)
    );
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const dashboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await statements.treasuryDashboard(tid(req)) });
  } catch (e) {
    next(e);
  }
};
export const cashFlow = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await statements.cashFlowSummary(tid(req), qstr(req.query.from), qstr(req.query.to));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const balances = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await statements.accountBalances(tid(req)) });
  } catch (e) {
    next(e);
  }
};
export const expenseReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await expenses.expenseReport(tid(req), qstr(req.query.from), qstr(req.query.to));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const verifyIntegrity = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await statements.verifyTreasuryIntegrity(tid(req), req.body);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
