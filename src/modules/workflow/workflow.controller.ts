import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../utils/AppError.js";
import * as definitions from "./definitions.service.js";
import * as docs from "./documents.service.js";
import * as engine from "./engine.service.js";
import * as notifications from "./notifications.service.js";

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

export const listDefinitions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: { items: await definitions.listDefinitions(tid(req), qstr(req.query.documentType)) },
    });
  } catch (e) {
    next(e);
  }
};
export const getDefinition = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: { item: await definitions.getDefinition(tid(req), param(req.params.id)) },
    });
  } catch (e) {
    next(e);
  }
};
export const createDefinition = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await definitions.createDefinition(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateDefinition = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await definitions.updateDefinition(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const replaceSteps = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await definitions.replaceSteps(tid(req), param(req.params.id), req.body.steps);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const inbox = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await engine.inbox(tid(req), uid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const listApprovals = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await engine.listApprovals(tid(req), {
      documentType: qstr(req.query.documentType),
      documentId: qstr(req.query.documentId),
      status: qstr(req.query.status),
    });
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const getApproval = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: { item: await engine.getApproval(tid(req), param(req.params.id)) },
    });
  } catch (e) {
    next(e);
  }
};
export const approve = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await engine.approveInstance(
      tid(req),
      param(req.params.id),
      uid(req),
      req.body.comment
    );
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const reject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await engine.rejectInstance(
      tid(req),
      param(req.params.id),
      uid(req),
      req.body.rejectionReason
    );
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const delegate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await engine.delegateInstance(
      tid(req),
      param(req.params.id),
      uid(req),
      req.body.toUserId,
      req.body.comment
    );
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const refreshEscalations = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await engine.refreshEscalations(tid(req)) });
  } catch (e) {
    next(e);
  }
};

export const listDelegations = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await definitions.listDelegations(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createDelegation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await definitions.createDelegation(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const revokeDelegation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await definitions.revokeDelegation(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

// Documents
export const listDocCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await docs.listCategories(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createDocCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await docs.createCategory(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listDocTags = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await docs.listTags(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createDocTag = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await docs.createTag(tid(req), req.body.name);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listDocuments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await docs.listDocuments(tid(req), uid(req), {
      q: qstr(req.query.q),
      categoryId: qstr(req.query.categoryId),
      tag: qstr(req.query.tag),
      entityType: qstr(req.query.entityType),
      entityId: qstr(req.query.entityId),
    });
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const getDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: { item: await docs.getDocument(tid(req), param(req.params.id), uid(req)) },
    });
  } catch (e) {
    next(e);
  }
};
export const createDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await docs.createDocument(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await docs.updateDocument(tid(req), param(req.params.id), uid(req), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const archiveDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await docs.archiveDocument(tid(req), param(req.params.id), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const addVersion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await docs.addVersion(tid(req), param(req.params.id), uid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const linkDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await docs.linkDocument(
      tid(req),
      param(req.params.id),
      uid(req),
      req.body.entityType,
      req.body.entityId
    );
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const downloadDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: await docs.downloadDocument(tid(req), param(req.params.id), uid(req)),
    });
  } catch (e) {
    next(e);
  }
};

// Notifications
export const listNotifications = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await notifications.listNotifications(tid(req), uid(req), {
      unreadOnly: req.query.unreadOnly === "true",
    });
    const unread = await notifications.unreadCount(tid(req), uid(req));
    res.json({ success: true, data: { items, unread } });
  } catch (e) {
    next(e);
  }
};
export const markRead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await notifications.markRead(tid(req), param(req.params.id), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const markAllRead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await notifications.markAllRead(tid(req), uid(req)) });
  } catch (e) {
    next(e);
  }
};
export const jobLowStock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: await notifications.runLowStockJob(tid(req), req.body.recipientUserIds),
    });
  } catch (e) {
    next(e);
  }
};
export const jobExpiringDocs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: await notifications.runExpiringDocumentsJob(
        tid(req),
        req.body.recipientUserIds,
        req.body.withinDays
      ),
    });
  } catch (e) {
    next(e);
  }
};
