import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { requireAnyPermission } from "../../middleware/requirePermission.js";
import { requireTenant, tenantContext } from "../../middleware/tenantContext.js";
import { validate } from "../../middleware/validate.js";
import * as c from "./masterData.controller.js";
import {
  brandSchema,
  categorySchema,
  currencySchema,
  departmentSchema,
  documentSequenceSchema,
  expenseCategorySchema,
  jobTitleSchema,
  paymentMethodSchema,
  productSchema,
  productVariantSchema,
  taxSchema,
  unitConversionSchema,
  unitSchema,
} from "./masterData.validation.js";
import { z } from "zod";

const router = Router();
router.use(authGuard, tenantContext, requireTenant);

const viewProducts = requireAnyPermission("products:view", "inventory:read", "inventory:view");
const manageProducts = requireAnyPermission("products:create", "products:update", "inventory:manage");
const viewCats = requireAnyPermission("categories:view", "products:view", "inventory:view", "inventory:read");
const manageCats = requireAnyPermission("categories:create", "categories:update", "inventory:manage");
const viewSettings = requireAnyPermission("settings:view", "org:manage");
const manageSettings = requireAnyPermission("settings:update", "org:manage");

// Categories
router.get("/categories", viewCats, c.listCategories);
router.post("/categories", manageCats, validate(categorySchema), c.createCategory);
router.patch("/categories/:id", manageCats, validate(categorySchema.partial()), c.updateCategory);
router.post("/categories/:id/archive", manageCats, c.archiveCategory);

// Products
router.get("/products", viewProducts, c.listProducts);
router.get("/products/export", viewProducts, c.exportProducts);
router.post(
  "/products/import",
  manageProducts,
  validate(
    z.object({
      rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
      dryRun: z.boolean().optional(),
    })
  ),
  c.importProducts
);
router.get("/products/:id", viewProducts, c.getProduct);
router.post("/products", manageProducts, validate(productSchema), c.createProduct);
router.patch("/products/:id", manageProducts, validate(productSchema.partial()), c.updateProduct);
router.post("/products/:id/archive", manageProducts, c.archiveProduct);
router.post("/products/:id/variants", manageProducts, validate(productVariantSchema), c.addVariant);
router.get("/products/:id/price-history", viewProducts, c.priceHistory);

// Brands
router.get("/brands", viewProducts, c.listBrands);
router.post("/brands", manageProducts, validate(brandSchema), c.createBrand);
router.patch("/brands/:id", manageProducts, validate(brandSchema.partial()), c.updateBrand);
router.post("/brands/:id/archive", manageProducts, c.archiveBrand);

// Units
router.get("/units", viewProducts, c.listUnits);
router.post("/units", manageProducts, validate(unitSchema), c.createUnit);
router.patch("/units/:id", manageProducts, validate(unitSchema.partial()), c.updateUnit);
router.post("/units/:id/archive", manageProducts, c.archiveUnit);
router.get("/unit-conversions", viewProducts, c.listConversions);
router.post("/unit-conversions", manageProducts, validate(unitConversionSchema), c.upsertConversion);
router.post(
  "/unit-conversions/convert",
  viewProducts,
  validate(
    z.object({
      fromUnitId: z.string().uuid(),
      toUnitId: z.string().uuid(),
      qty: z.number(),
    })
  ),
  c.convertQty
);

// Taxes
router.get("/taxes", viewSettings, c.listTaxes);
router.post("/taxes", manageSettings, validate(taxSchema), c.createTax);
router.patch("/taxes/:id", manageSettings, validate(taxSchema.partial()), c.updateTax);
router.post("/taxes/:id/archive", manageSettings, c.archiveTax);

// Payment methods
router.get("/payment-methods", viewSettings, c.listPaymentMethods);
router.post("/payment-methods", manageSettings, validate(paymentMethodSchema), c.createPaymentMethod);
router.patch("/payment-methods/:id", manageSettings, validate(paymentMethodSchema.partial()), c.updatePaymentMethod);
router.post("/payment-methods/:id/archive", manageSettings, c.archivePaymentMethod);

// Expense categories
router.get("/expense-categories", viewSettings, c.listExpenseCategories);
router.post("/expense-categories", manageSettings, validate(expenseCategorySchema), c.createExpenseCategory);
router.patch("/expense-categories/:id", manageSettings, validate(expenseCategorySchema.partial()), c.updateExpenseCategory);
router.post("/expense-categories/:id/archive", manageSettings, c.archiveExpenseCategory);

// Currencies
router.get("/currencies", viewSettings, c.listCurrencies);
router.post("/currencies", manageSettings, validate(currencySchema), c.createCurrency);
router.patch("/currencies/:id", manageSettings, validate(currencySchema.partial()), c.updateCurrency);
router.post("/currencies/:id/archive", manageSettings, c.archiveCurrency);

// Departments & job titles
router.get("/departments", viewSettings, c.listDepartments);
router.post("/departments", manageSettings, validate(departmentSchema), c.createDepartment);
router.patch("/departments/:id", manageSettings, validate(departmentSchema.partial()), c.updateDepartment);
router.get("/job-titles", viewSettings, c.listJobTitles);
router.post("/job-titles", manageSettings, validate(jobTitleSchema), c.createJobTitle);
router.patch("/job-titles/:id", manageSettings, validate(jobTitleSchema.partial()), c.updateJobTitle);
router.post("/job-titles/:id/archive", manageSettings, c.archiveJobTitle);

// Document sequences
router.get("/document-sequences", viewSettings, c.listSequences);
router.put("/document-sequences", manageSettings, validate(documentSequenceSchema), c.upsertSequence);

export default router;
