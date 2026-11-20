import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../utils/AppError.js";
import { lookupByBarcode } from "../inventory/balances.service.js";
import * as checkout from "./checkout.service.js";
import * as sessions from "./sessions.service.js";

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

export const openSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sessions.openSession(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listSessions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ success: true, data: { items: await sessions.listSessions(tid(req), status) } });
  } catch (e) {
    next(e);
  }
};
export const getSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await sessions.getSession(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const myOpenSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sessions.getOpenSession(tid(req), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const cashMovement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sessions.recordCashMovement(tid(req), param(req.params.id), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const closeSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sessions.closeSession(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const approveSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sessions.approveSessionClose(
      tid(req),
      param(req.params.id),
      uid(req),
      req.body?.note
    );
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const searchProducts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    res.json({ success: true, data: { items: await checkout.searchProducts(tid(req), q) } });
  } catch (e) {
    next(e);
  }
};
export const barcodeLookup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const barcode = typeof req.query.barcode === "string" ? req.query.barcode : param(req.params.barcode);
    const data = await lookupByBarcode(tid(req), barcode);
    if (!data) throw new AppError("Barcode not found", 404);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};

export const doCheckout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await checkout.checkout(tid(req), req.body, uid(req));
    res.status(result.duplicate ? 200 : 201).json({
      success: true,
      data: { item: result.sale, duplicate: result.duplicate },
    });
  } catch (e) {
    next(e);
  }
};
export const listSales = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
    res.json({ success: true, data: { items: await checkout.listSales(tid(req), sessionId) } });
  } catch (e) {
    next(e);
  }
};
export const getSale = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await checkout.getSale(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const cancelSale = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await checkout.cancelSale(tid(req), param(req.params.id), req.body.reason, uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const refundSale = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await checkout.refundSale(tid(req), param(req.params.id), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const printReceipt = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await checkout.getReceiptPrint(tid(req), param(req.params.id));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const getReceiptConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await checkout.getReceiptConfig(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const upsertReceiptConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await checkout.upsertReceiptConfig(tid(req), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
