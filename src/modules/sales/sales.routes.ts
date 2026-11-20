import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { requireAnyPermission } from "../../middleware/requirePermission.js";
import { requireTenant, tenantContext } from "../../middleware/tenantContext.js";
import { validate } from "../../middleware/validate.js";
import * as c from "./sales.controller.js";
import {
  customerPriceSchema,
  deliverSchema,
  discountRuleSchema,
  priceListItemSchema,
  priceListSchema,
  quotationSchema,
  quotationStatusSchema,
  receiptSchema,
  resolvePriceSchema,
  salesInvoiceSchema,
  cancelSalesOrderSchema,
  salesOrderSchema,
  salesReturnSchema,
} from "./sales.validation.js";

const router = Router();
router.use(authGuard, tenantContext, requireTenant);

const view = requireAnyPermission(
  "sales:view",
  "sales:read",
  "sales_invoices:view",
  "customers:view"
);
const manage = requireAnyPermission(
  "sales:create",
  "sales:update",
  "sales:manage",
  "sales_invoices:create",
  "sales_invoices:update"
);

router.get("/price-lists", view, c.listPriceLists);
router.post("/price-lists", manage, validate(priceListSchema), c.createPriceList);
router.put("/price-lists/:id/items", manage, validate(priceListItemSchema), c.upsertPriceItem);
router.post("/customer-prices", manage, validate(customerPriceSchema), c.setCustomerPrice);
router.get("/discount-rules", view, c.listDiscountRules);
router.post("/discount-rules", manage, validate(discountRuleSchema), c.createDiscountRule);
router.post("/resolve-price", view, validate(resolvePriceSchema), c.resolvePrice);

router.get("/quotations", view, c.listQuotations);
router.post("/quotations", manage, validate(quotationSchema), c.createQuotation);
router.get("/quotations/:id", view, c.getQuotation);
router.post("/quotations/:id/status", manage, validate(quotationStatusSchema), c.updateQuotationStatus);
router.post("/quotations/:id/convert", manage, c.convertQuotation);

router.get("/orders", view, c.listOrders);
router.post("/orders", manage, validate(salesOrderSchema), c.createOrder);
router.get("/orders/:id", view, c.getOrder);
router.patch("/orders/:id", manage, validate(salesOrderSchema), c.updateOrder);
router.post("/orders/:id/cancel", manage, validate(cancelSalesOrderSchema), c.cancelOrder);
router.post("/orders/:id/confirm", manage, c.confirmOrder);
router.post("/orders/:id/reserve", manage, c.reserveOrder);
router.post("/orders/:id/deliver", manage, validate(deliverSchema), c.deliverOrder);

router.get("/invoices", view, c.listInvoices);
router.post("/invoices", manage, validate(salesInvoiceSchema), c.createInvoice);
router.get("/invoices/:id", view, c.getInvoice);
router.post("/invoices/:id/post", manage, c.postInvoice);
router.post("/invoices/:id/cancel", manage, c.cancelInvoice);
router.get("/invoices/:id/print", view, c.printInvoice);

router.get("/receipts", view, c.listReceipts);
router.post("/receipts", manage, validate(receiptSchema), c.createReceipt);

router.get("/returns", view, c.listReturns);
router.post("/returns", manage, validate(salesReturnSchema), c.createReturn);
router.get("/returns/:id", view, c.getReturn);
router.post("/returns/:id/post", manage, c.postReturn);

export default router;
