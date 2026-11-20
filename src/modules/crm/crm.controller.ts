import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../utils/AppError.js";
import * as activities from "./activities.service.js";
import * as customers from "./customers.service.js";
import * as financial from "./financial.service.js";

function tid(req: Request) {
  if (!req.tenant) throw new AppError("Tenant context required", 403);
  return req.tenant.tenantId;
}
function param(v: string | string[] | undefined) {
  if (typeof v === "string" && v) return v;
  throw new AppError("Missing route parameter", 400);
}

export const listCustomers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await customers.listCustomers(tid(req), {
      ...(req.query as Record<string, unknown>),
      categoryId: typeof req.query.categoryId === "string" ? req.query.categoryId : undefined,
      groupId: typeof req.query.groupId === "string" ? req.query.groupId : undefined,
      tagId: typeof req.query.tagId === "string" ? req.query.tagId : undefined,
      type: typeof req.query.type === "string" ? req.query.type : undefined,
    });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};

export const getCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await customers.getCustomer(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const createCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await customers.createCustomer(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const updateCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await customers.updateCustomer(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const archiveCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await customers.archiveCustomer(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const listCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await customers.listCategories(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await customers.createCategory(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listGroups = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await customers.listGroups(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await customers.createGroup(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listTags = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await customers.listTags(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createTag = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await customers.createTag(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const financialSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await financial.getFinancialSummary(tid(req), param(req.params.id));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const statement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await financial.getCustomerStatement(tid(req), param(req.params.id), {
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
    });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const listLedger = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await financial.listLedger(tid(req), param(req.params.id));
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const addLedger = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await financial.addLedgerEntry(
      tid(req),
      param(req.params.id),
      req.body,
      req.user?.id
    );
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const timeline = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await activities.getTimeline(tid(req), param(req.params.id));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const listNotes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: { items: await activities.listNotes(tid(req), param(req.params.id)) },
    });
  } catch (e) {
    next(e);
  }
};
export const addNote = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await activities.addNote(tid(req), param(req.params.id), req.body.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listInteractions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: { items: await activities.listInteractions(tid(req), param(req.params.id)) },
    });
  } catch (e) {
    next(e);
  }
};
export const addInteraction = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await activities.addInteraction(
      tid(req),
      param(req.params.id),
      req.body,
      req.user?.id
    );
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listFollowUps = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: { items: await activities.listFollowUps(tid(req), param(req.params.id)) },
    });
  } catch (e) {
    next(e);
  }
};
export const addFollowUp = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await activities.addFollowUp(
      tid(req),
      param(req.params.id),
      req.body,
      req.user?.id
    );
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateFollowUp = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await activities.updateFollowUp(tid(req), param(req.params.followUpId), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listOpportunities = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: { items: await activities.listOpportunities(tid(req), param(req.params.id)) },
    });
  } catch (e) {
    next(e);
  }
};
export const addOpportunity = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await activities.addOpportunity(
      tid(req),
      param(req.params.id),
      req.body,
      req.user?.id
    );
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateOpportunity = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await activities.updateOpportunity(
      tid(req),
      param(req.params.opportunityId),
      req.body
    );
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
