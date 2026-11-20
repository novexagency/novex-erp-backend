import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { requireAnyPermission } from "../../middleware/requirePermission.js";
import { requireTenant, tenantContext } from "../../middleware/tenantContext.js";
import { validate } from "../../middleware/validate.js";
import * as c from "./pos.controller.js";
import {
  approveSessionSchema,
  cancelSaleSchema,
  cashMovementSchema,
  checkoutSchema,
  closeSessionSchema,
  openSessionSchema,
  receiptConfigSchema,
  refundSchema,
} from "./pos.validation.js";

const router = Router();
router.use(authGuard, tenantContext, requireTenant);

const view = requireAnyPermission("sales:view", "sales:read", "sales_invoices:view", "inventory:view");
const cashier = requireAnyPermission(
  "sales:create",
  "sales:manage",
  "sales_invoices:create",
  "sales:update"
);
const approve = requireAnyPermission("sales:approve", "sales:manage", "sales_invoices:approve");

router.get("/products/search", view, c.searchProducts);
router.get("/barcode", view, c.barcodeLookup);
router.get("/barcode/:barcode", view, c.barcodeLookup);

router.get("/sessions", view, c.listSessions);
router.get("/sessions/current", cashier, c.myOpenSession);
router.post("/sessions/open", cashier, validate(openSessionSchema), c.openSession);
router.get("/sessions/:id", view, c.getSession);
router.post("/sessions/:id/cash-movements", cashier, validate(cashMovementSchema), c.cashMovement);
router.post("/sessions/:id/close", cashier, validate(closeSessionSchema), c.closeSession);
router.post("/sessions/:id/approve", approve, validate(approveSessionSchema), c.approveSession);

router.post("/checkout", cashier, validate(checkoutSchema), c.doCheckout);
router.get("/sales", view, c.listSales);
router.get("/sales/:id", view, c.getSale);
router.post("/sales/:id/cancel", cashier, validate(cancelSaleSchema), c.cancelSale);
router.post("/sales/:id/refund", cashier, validate(refundSchema), c.refundSale);
router.get("/sales/:id/receipt", view, c.printReceipt);

router.get("/receipt-config", view, c.getReceiptConfig);
router.put("/receipt-config", cashier, validate(receiptConfigSchema), c.upsertReceiptConfig);

export default router;
