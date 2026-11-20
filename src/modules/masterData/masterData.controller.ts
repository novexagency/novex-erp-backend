import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../utils/AppError.js";
import * as categoriesService from "./categories.service.js";
import * as lookups from "./lookups.service.js";
import * as productsService from "./products.service.js";

function tid(req: Request) {
  if (!req.tenant) throw new AppError("Tenant context required", 403);
  return req.tenant.tenantId;
}

function param(value: string | string[] | undefined) {
  if (typeof value === "string" && value) return value;
  throw new AppError("Missing route parameter", 400);
}

function q(req: Request) {
  return req.query as Record<string, unknown>;
}

// Categories
export const listCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await categoriesService.listCategories(tid(req), {
      ...q(req),
      tree: req.query.tree === "true",
      parentId: typeof req.query.parentId === "string" ? req.query.parentId : undefined,
    });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const createCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await categoriesService.createCategory(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await categoriesService.updateCategory(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const archiveCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await categoriesService.archiveCategory(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

// Products
export const listProducts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await productsService.listProducts(tid(req), {
      ...q(req),
      categoryId: typeof req.query.categoryId === "string" ? req.query.categoryId : undefined,
      brandId: typeof req.query.brandId === "string" ? req.query.brandId : undefined,
    });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const getProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await productsService.getProduct(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const createProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await productsService.createProduct(tid(req), req.body, req.user?.id);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await productsService.updateProduct(
      tid(req),
      param(req.params.id),
      req.body,
      req.user?.id
    );
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const archiveProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await productsService.archiveProduct(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const addVariant = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await productsService.addVariant(tid(req), param(req.params.id), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const priceHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await productsService.listPriceHistory(tid(req), param(req.params.id));
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const exportProducts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await productsService.exportProducts(tid(req));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const importProducts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await productsService.bulkImportProducts(
      tid(req),
      req.body.rows || [],
      req.body.dryRun !== false,
      req.user?.id
    );
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};

// Generic lookup helpers
function crudList(fn: (t: string, q: Record<string, unknown>) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await fn(tid(req), q(req));
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  };
}

export const listBrands = crudList(lookups.listBrands);
export const createBrand = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.createBrand(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateBrand = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.updateBrand(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const archiveBrand = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.archiveBrand(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const listUnits = crudList(lookups.listUnits);
export const createUnit = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.createUnit(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateUnit = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.updateUnit(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const archiveUnit = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.archiveUnit(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listConversions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await lookups.listConversions(tid(req));
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const upsertConversion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.upsertConversion(tid(req), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const convertQty = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const qty = await lookups.convertQty(
      tid(req),
      String(req.body.fromUnitId),
      String(req.body.toUnitId),
      Number(req.body.qty)
    );
    res.json({ success: true, data: { qty } });
  } catch (e) {
    next(e);
  }
};

export const listTaxes = crudList(lookups.listTaxes);
export const createTax = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.createTax(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateTax = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.updateTax(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const archiveTax = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.archiveTax(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const listPaymentMethods = crudList(lookups.listPaymentMethods);
export const createPaymentMethod = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.createPaymentMethod(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updatePaymentMethod = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.updatePaymentMethod(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const archivePaymentMethod = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.archivePaymentMethod(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const listExpenseCategories = crudList(lookups.listExpenseCategories);
export const createExpenseCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.createExpenseCategory(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateExpenseCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.updateExpenseCategory(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const archiveExpenseCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.archiveExpenseCategory(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const listCurrencies = crudList(lookups.listCurrencies);
export const createCurrency = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.createCurrency(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateCurrency = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.updateCurrency(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const archiveCurrency = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.archiveCurrency(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const listJobTitles = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await lookups.listJobTitles(tid(req), {
      ...q(req),
      departmentId: typeof req.query.departmentId === "string" ? req.query.departmentId : undefined,
    });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const createJobTitle = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.createJobTitle(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateJobTitle = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.updateJobTitle(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const archiveJobTitle = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.archiveJobTitle(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const listDepartments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await lookups.listDepartments(tid(req));
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const createDepartment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.createDepartment(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateDepartment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.updateDepartment(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

export const listSequences = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await lookups.listDocumentSequences(tid(req));
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const upsertSequence = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await lookups.upsertDocumentSequence(tid(req), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
