import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { requireAnyPermission } from "../../middleware/requirePermission.js";
import { requireTenant, tenantContext } from "../../middleware/tenantContext.js";
import { validate } from "../../middleware/validate.js";
import * as c from "./procurement.controller.js";
import {
  goodsReceiptSchema,
  poAttachmentSchema,
  purchaseInvoiceSchema,
  purchaseOrderSchema,
  purchaseRequestSchema,
  purchaseReturnSchema,
  rejectRequestSchema,
  stockAdjustmentSchema,
  supplierCategorySchema,
  supplierPaymentSchema,
  supplierSchema,
} from "./procurement.validation.js";

const router = Router();
router.use(authGuard, tenantContext, requireTenant);

const view = requireAnyPermission(
  "suppliers:view",
  "purchases:view",
  "purchase_orders:view",
  "purchasing:read",
  "inventory:view",
  "inventory:read"
);
const manage = requireAnyPermission(
  "suppliers:create",
  "suppliers:update",
  "purchases:create",
  "purchases:update",
  "purchase_orders:create",
  "purchase_orders:update",
  "purchasing:manage",
  "inventory:manage",
  "inventory:update"
);
const approve = requireAnyPermission(
  "purchases:approve",
  "purchase_orders:approve",
  "purchasing:manage"
);

// Suppliers
router.get("/supplier-categories", view, c.listSupplierCategories);
router.post("/supplier-categories", manage, validate(supplierCategorySchema), c.createSupplierCategory);
router.get("/suppliers", view, c.listSuppliers);
router.post("/suppliers", manage, validate(supplierSchema), c.createSupplier);
router.get("/suppliers/:id", view, c.getSupplier);
router.patch("/suppliers/:id", manage, validate(supplierSchema.partial()), c.updateSupplier);
router.post("/suppliers/:id/archive", manage, c.archiveSupplier);
router.get("/suppliers/:id/financial", view, c.supplierFinancial);

// Purchase requests
router.get("/purchase-requests", view, c.listPRs);
router.post("/purchase-requests", manage, validate(purchaseRequestSchema), c.createPR);
router.get("/purchase-requests/:id", view, c.getPR);
router.post("/purchase-requests/:id/submit", manage, c.submitPR);
router.post("/purchase-requests/:id/approve", approve, c.approvePR);
router.post("/purchase-requests/:id/reject", approve, validate(rejectRequestSchema), c.rejectPR);

// Purchase orders
router.get("/purchase-orders", view, c.listPOs);
router.post("/purchase-orders", manage, validate(purchaseOrderSchema), c.createPO);
router.get("/purchase-orders/:id", view, c.getPO);
router.post("/purchase-orders/:id/issue", manage, c.issuePO);
router.post("/purchase-orders/:id/attachments", manage, validate(poAttachmentSchema), c.addPoAttachment);

// Goods receipts
router.get("/goods-receipts", view, c.listGRNs);
router.post("/goods-receipts", manage, validate(goodsReceiptSchema), c.createGRN);
router.get("/goods-receipts/:id", view, c.getGRN);
router.post("/goods-receipts/:id/post", manage, c.postGRN);

// Purchase invoices
router.get("/purchase-invoices", view, c.listInvoices);
router.post("/purchase-invoices", manage, validate(purchaseInvoiceSchema), c.createInvoice);
router.get("/purchase-invoices/:id", view, c.getInvoice);
router.post("/purchase-invoices/:id/post", manage, c.postInvoice);

// Payments
router.get("/supplier-payments", view, c.listPayments);
router.post("/supplier-payments", manage, validate(supplierPaymentSchema), c.createPayment);

// Returns
router.get("/purchase-returns", view, c.listReturns);
router.post("/purchase-returns", manage, validate(purchaseReturnSchema), c.createReturn);
router.get("/purchase-returns/:id", view, c.getReturn);
router.post("/purchase-returns/:id/post", manage, c.postReturn);

// Inventory foundation (single warehouse)
router.get("/stock", view, c.listStock);
router.get("/stock/:productId", view, c.getStock);
router.get("/inventory-movements", view, c.listMovements);
router.post("/stock-adjustments", manage, validate(stockAdjustmentSchema), c.createAdjustment);
router.post("/stock-adjustments/:id/post", manage, c.postAdjustment);

export default router;
