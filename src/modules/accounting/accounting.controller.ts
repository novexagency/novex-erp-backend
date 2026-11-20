import type { NextFunction, Request, Response } from "express";
import { AccountingEventType } from "@prisma/client";
import { AppError } from "../../utils/AppError.js";
import * as coa from "./coa.service.js";
import * as journals from "./journal.service.js";
import * as periods from "./periods.service.js";
import * as reports from "./reports.service.js";
import * as rules from "./rules.service.js";

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

// COA
export const seedDefaults = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await coa.seedDefaults(tid(req));
    res.status(201).json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const listAccounts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await coa.listAccounts(tid(req), {
      status: qstr(req.query.status),
      type: qstr(req.query.type),
    });
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const createAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await coa.createAccount(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await coa.updateAccount(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const getAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await coa.getAccount(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};

// Periods
export const listFiscalYears = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await periods.listFiscalYears(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createFiscalYear = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await periods.createFiscalYear(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const closeFiscalYear = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await periods.closeFiscalYear(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listPeriods = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await periods.listPeriods(tid(req), qstr(req.query.fiscalYearId));
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const createPeriod = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await periods.createPeriod(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const closePeriod = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await periods.closePeriod(tid(req), param(req.params.id), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const lockPeriod = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await periods.lockPeriod(tid(req), param(req.params.id), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const reopenPeriod = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await periods.reopenPeriod(
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

// Rules
export const listRules = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await rules.listPostingRules(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const updateRule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventType = param(req.params.eventType) as AccountingEventType;
    const item = await rules.updatePostingRule(tid(req), eventType, req.body, uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

// Journals
export const listJournals = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await journals.listJournals(tid(req), {
      status: qstr(req.query.status),
      eventType: qstr(req.query.eventType),
      from: qstr(req.query.from),
      to: qstr(req.query.to),
    });
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const getJournal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: { item: await journals.getJournal(tid(req), param(req.params.id)) },
    });
  } catch (e) {
    next(e);
  }
};
export const createJournal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await journals.createManualJournal(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateJournal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await journals.updateDraftJournal(tid(req), param(req.params.id), req.body, uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const postJournal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await journals.postJournal(tid(req), param(req.params.id), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const reverseJournal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await journals.reverseJournal(
      tid(req),
      param(req.params.id),
      req.body.reason,
      uid(req),
      req.body.authorized
    );
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};

// Reports
export const trialBalance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await reports.trialBalance(tid(req), qstr(req.query.from), qstr(req.query.to));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const generalLedger = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = qstr(req.query.accountId);
    if (!accountId) throw new AppError("accountId query required", 400);
    const data = await reports.generalLedger(
      tid(req),
      accountId,
      qstr(req.query.from),
      qstr(req.query.to)
    );
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const incomeStatement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await reports.incomeStatement(tid(req), qstr(req.query.from), qstr(req.query.to));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const balanceSheet = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await reports.balanceSheet(tid(req), qstr(req.query.asOf));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const cashFlow = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await reports.cashFlowStatement(tid(req), qstr(req.query.from), qstr(req.query.to));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const accountStatement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = qstr(req.query.accountId) ?? param(req.params.accountId);
    const data = await reports.accountStatement(
      tid(req),
      accountId,
      qstr(req.query.from),
      qstr(req.query.to)
    );
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const journalReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await reports.journalReport(tid(req), qstr(req.query.from), qstr(req.query.to));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
