import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../utils/AppError.js";
import * as inventory from "./inventory.service.js";
import * as purchasing from "./purchasing.service.js";
import * as suppliers from "./suppliers.service.js";

function tid(req: Request) {
  if (!req.tenant) throw new AppError("Tenant context required", 403);
  return req.tenant.tenantId;
}
function param(v: string | string[] | undefined) {
  if (typeof v === "string" && v) return v;
  throw new AppError("Missing route parameter", 400);
}

// Suppliers
export const listSupplierCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await suppliers.listCategories(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createSupplierCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await suppliers.createCategory(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listSuppliers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await suppliers.listSuppliers(tid(req), {
      ...(req.query as Record<string, unknown>),
      categoryId: typeof req.query.categoryId === "string" ? req.query.categoryId : undefined,
    });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const getSupplier = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await suppliers.getSupplier(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const createSupplier = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await suppliers.createSupplier(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateSupplier = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await suppliers.updateSupplier(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const archiveSupplier = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await suppliers.archiveSupplier(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const supplierFinancial = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await suppliers.getSupplierFinancial(tid(req), param(req.params.id));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};

// Purchase requests
export const listPRs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ success: true, data: { items: await purchasing.listPurchaseRequests(tid(req), status) } });
  } catch (e) {
    next(e);
  }
};
export const createPR = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await purchasing.createPurchaseRequest(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const getPR = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await purchasing.getPurchaseRequest(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const submitPR = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await purchasing.submitPurchaseRequest(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const approvePR = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await purchasing.approvePurchaseRequest(tid(req), param(req.params.id), req.user?.id);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const rejectPR = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await purchasing.rejectPurchaseRequest(
      tid(req),
      param(req.params.id),
      req.body?.reason,
      req.user?.id
    );
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

// Purchase orders
export const listPOs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ success: true, data: { items: await purchasing.listPurchaseOrders(tid(req), status) } });
  } catch (e) {
    next(e);
  }
};
export const createPO = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await purchasing.createPurchaseOrder(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const getPO = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await purchasing.getPurchaseOrder(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const issuePO = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await purchasing.issuePurchaseOrder(tid(req), param(req.params.id), req.user?.id);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const addPoAttachment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await purchasing.addPoAttachment(tid(req), param(req.params.id), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

// GRN
export const listGRNs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ success: true, data: { items: await purchasing.listGoodsReceipts(tid(req), status) } });
  } catch (e) {
    next(e);
  }
};
export const createGRN = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await purchasing.createGoodsReceipt(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const getGRN = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await purchasing.getGoodsReceipt(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const postGRN = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await purchasing.postGoodsReceipt(tid(req), param(req.params.id), req.user?.id);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

// Invoices
export const listInvoices = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ success: true, data: { items: await purchasing.listPurchaseInvoices(tid(req), status) } });
  } catch (e) {
    next(e);
  }
};
export const createInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await purchasing.createPurchaseInvoice(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const getInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await purchasing.getPurchaseInvoice(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const postInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await purchasing.postPurchaseInvoice(tid(req), param(req.params.id), req.user?.id);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

// Payments
export const listPayments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await purchasing.listSupplierPayments(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await purchasing.createSupplierPayment(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

// Returns
export const listReturns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await purchasing.listPurchaseReturns(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createReturn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await purchasing.createPurchaseReturn(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const getReturn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await purchasing.getPurchaseReturn(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const postReturn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await purchasing.postPurchaseReturn(tid(req), param(req.params.id), req.user?.id);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

// Inventory foundation
export const listStock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await inventory.listStockBalances(tid(req)) });
  } catch (e) {
    next(e);
  }
};
export const getStock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await inventory.getStockBalance(tid(req), param(req.params.productId)) });
  } catch (e) {
    next(e);
  }
};
export const listMovements = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await inventory.listMovements(tid(req), {
      productId: typeof req.query.productId === "string" ? req.query.productId : undefined,
      referenceType: typeof req.query.referenceType === "string" ? req.query.referenceType : undefined,
      referenceId: typeof req.query.referenceId === "string" ? req.query.referenceId : undefined,
    });
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const createAdjustment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await inventory.createStockAdjustment(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const postAdjustment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await inventory.postStockAdjustment(tid(req), param(req.params.id), req.user?.id);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
