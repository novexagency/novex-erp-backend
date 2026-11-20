import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../utils/AppError.js";
import * as balances from "./balances.service.js";
import * as barcode from "./barcode.service.js";
import * as counts from "./counts.service.js";
import * as documents from "./documents.service.js";
import * as reports from "./reports.service.js";

function tid(req: Request) {
  if (!req.tenant) throw new AppError("Tenant context required", 403);
  return req.tenant.tenantId;
}
function param(v: string | string[] | undefined) {
  if (typeof v === "string" && v) return v;
  throw new AppError("Missing route parameter", 400);
}

export const listStock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await balances.listStockBalances(tid(req), {
      lowStockOnly: req.query.lowStockOnly === "true",
      search: typeof req.query.search === "string" ? req.query.search : undefined,
    });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const getStock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await balances.getStockBalance(tid(req), param(req.params.productId)) });
  } catch (e) {
    next(e);
  }
};
export const listMovements = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await balances.listMovements(tid(req), {
      productId: typeof req.query.productId === "string" ? req.query.productId : undefined,
      referenceType: typeof req.query.referenceType === "string" ? req.query.referenceType : undefined,
      referenceId: typeof req.query.referenceId === "string" ? req.query.referenceId : undefined,
      type: typeof req.query.type === "string" ? req.query.type : undefined,
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
    });
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const barcodeLookup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const barcode = typeof req.query.barcode === "string" ? req.query.barcode : param(req.params.barcode);
    const data = await balances.lookupByBarcode(tid(req), barcode);
    if (!data) throw new AppError("Barcode not found", 404);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};

export const barcodeGenerate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await barcode.generateBarcode(tid(req), req.body);
    res.status(201).json({ success: true, data });
  } catch (e) {
    next(e);
  }
};

export const barcodeLabels = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pdf = await barcode.buildLabelsPdf(tid(req), req.body);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="barcode-labels.pdf"');
    res.status(200).send(pdf);
  } catch (e) {
    next(e);
  }
};

export const barcodeScanCreate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await barcode.recordBarcodeScan(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const barcodeScanList = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await barcode.listBarcodeScans(tid(req), {
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      barcode: typeof req.query.barcode === "string" ? req.query.barcode : undefined,
      result: typeof req.query.result === "string" ? req.query.result : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const valuation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await balances.inventoryValuation(tid(req)) });
  } catch (e) {
    next(e);
  }
};

export const createOpening = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await documents.createOpeningStock(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const postOpening = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await documents.postOpeningStock(tid(req), param(req.params.id), req.user?.id);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listOpenings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await documents.listOpeningStocks(tid(req)) } });
  } catch (e) {
    next(e);
  }
};

export const createAdj = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await documents.createStockAdjustment(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const postAdj = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await documents.postStockAdjustment(tid(req), param(req.params.id), req.user?.id);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const createIssue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await documents.createStockIssue(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const postIssue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await documents.postStockIssue(tid(req), param(req.params.id), req.user?.id);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listIssues = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await documents.listStockIssues(tid(req)) } });
  } catch (e) {
    next(e);
  }
};

export const createReturn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await documents.createStockReturn(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const postReturn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await documents.postStockReturn(tid(req), param(req.params.id), req.user?.id);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listReturns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await documents.listStockReturns(tid(req)) } });
  } catch (e) {
    next(e);
  }
};

export const createReservation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await documents.createReservation(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const releaseReservation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await documents.releaseReservation(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listReservations = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await documents.listReservations(tid(req)) } });
  } catch (e) {
    next(e);
  }
};

export const createCount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await counts.createStockCount(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const recordCount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await counts.recordCountQuantities(tid(req), param(req.params.id), req.body.lines);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const getCount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await counts.getStockCount(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const listCounts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await counts.listStockCounts(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const submitCount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await counts.submitStockCount(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const approveCount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await counts.approveStockCount(tid(req), param(req.params.id), req.user?.id);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const postCount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await counts.postStockCount(tid(req), param(req.params.id), req.user?.id);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const lowStock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await reports.lowStockAlerts(tid(req)) });
  } catch (e) {
    next(e);
  }
};
export const reorder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await reports.reorderAlerts(tid(req)) });
  } catch (e) {
    next(e);
  }
};
export const slowMoving = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Number(req.query.days) || 90;
    res.json({ success: true, data: await reports.slowMovingReport(tid(req), days) });
  } catch (e) {
    next(e);
  }
};
export const aging = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await reports.inventoryAging(tid(req)) });
  } catch (e) {
    next(e);
  }
};
export const expiry = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const withinDays = Number(req.query.withinDays) || 60;
    res.json({ success: true, data: await reports.expiryReport(tid(req), withinDays) });
  } catch (e) {
    next(e);
  }
};
export const listLots = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
    res.json({ success: true, data: { items: await reports.listLots(tid(req), productId) } });
  } catch (e) {
    next(e);
  }
};
