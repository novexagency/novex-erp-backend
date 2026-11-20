import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../utils/AppError.js";
import * as pricing from "./pricing.service.js";
import * as sales from "./sales.service.js";

function tid(req: Request) {
  if (!req.tenant) throw new AppError("Tenant context required", 403);
  return req.tenant.tenantId;
}
function param(v: string | string[] | undefined) {
  if (typeof v === "string" && v) return v;
  throw new AppError("Missing route parameter", 400);
}

export const listPriceLists = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await pricing.listPriceLists(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createPriceList = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await pricing.createPriceList(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const upsertPriceItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await pricing.upsertPriceListItem(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const setCustomerPrice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await pricing.setCustomerPriceOverride(tid(req), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listDiscountRules = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await pricing.listDiscountRules(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createDiscountRule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await pricing.createDiscountRule(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const resolvePrice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await pricing.resolveUnitPrice(tid(req), req.body);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};

export const listQuotations = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ success: true, data: { items: await sales.listQuotations(tid(req), status) } });
  } catch (e) {
    next(e);
  }
};
export const createQuotation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sales.createQuotation(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const getQuotation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await sales.getQuotation(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const updateQuotationStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sales.updateQuotationStatus(tid(req), param(req.params.id), req.body.status);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const convertQuotation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sales.convertQuotationToOrder(tid(req), param(req.params.id), req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const listOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ success: true, data: { items: await sales.listSalesOrders(tid(req), status) } });
  } catch (e) {
    next(e);
  }
};
export const createOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sales.createSalesOrder(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const getOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await sales.getSalesOrder(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const updateOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sales.updateSalesOrder(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const cancelOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sales.cancelSalesOrder(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const confirmOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await sales.confirmSalesOrder(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const reserveOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sales.reserveSalesOrder(tid(req), param(req.params.id), req.user?.id);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const deliverOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sales.deliverSalesOrder(tid(req), param(req.params.id), req.body, req.user?.id);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const listInvoices = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ success: true, data: { items: await sales.listSalesInvoices(tid(req), status) } });
  } catch (e) {
    next(e);
  }
};
export const createInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sales.createSalesInvoice(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const getInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await sales.getSalesInvoice(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const postInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sales.postSalesInvoice(tid(req), param(req.params.id), req.user?.id);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const cancelInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sales.cancelSalesInvoice(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const printInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await sales.getInvoicePrintPayload(tid(req), param(req.params.id));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};

export const listReceipts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await sales.listCustomerReceipts(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createReceipt = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sales.createCustomerReceipt(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const listReturns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await sales.listSalesReturns(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createReturn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sales.createSalesReturn(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const getReturn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await sales.getSalesReturn(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const postReturn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await sales.postSalesReturn(tid(req), param(req.params.id), req.user?.id);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
