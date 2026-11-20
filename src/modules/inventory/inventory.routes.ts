import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { requireAnyPermission } from "../../middleware/requirePermission.js";
import { requireTenant, tenantContext } from "../../middleware/tenantContext.js";
import { validate } from "../../middleware/validate.js";
import * as c from "./inventory.controller.js";
import {
  barcodeGenerateSchema,
  barcodeLabelsSchema,
  barcodeScanSchema,
  openingStockSchema,
  reservationSchema,
  stockAdjustmentSchema,
  stockCountCreateSchema,
  stockCountLinesSchema,
  stockIssueSchema,
  stockReturnSchema,
} from "./inventory.validation.js";

const router = Router();
router.use(authGuard, tenantContext, requireTenant);

const view = requireAnyPermission(
  "inventory:view",
  "inventory:read",
  "stock_counts:view",
  "stock_adjustments:view"
);
const manage = requireAnyPermission(
  "inventory:manage",
  "inventory:update",
  "inventory:create",
  "stock_adjustments:create",
  "stock_adjustments:update",
  "stock_counts:create",
  "stock_counts:update"
);
const approve = requireAnyPermission(
  "inventory:manage",
  "stock_counts:approve",
  "stock_adjustments:approve"
);

router.get("/stock", view, c.listStock);
router.get("/stock/:productId", view, c.getStock);
router.get("/movements", view, c.listMovements);
router.post("/barcode/generate", manage, validate(barcodeGenerateSchema), c.barcodeGenerate);
router.post("/barcode/labels", manage, validate(barcodeLabelsSchema), c.barcodeLabels);
router.get("/barcode/scans", view, c.barcodeScanList);
router.post("/barcode/scans", view, validate(barcodeScanSchema), c.barcodeScanCreate);
router.get("/barcode", view, c.barcodeLookup);
router.get("/barcode/:barcode", view, c.barcodeLookup);
router.get("/valuation", view, c.valuation);
router.get("/lots", view, c.listLots);

router.get("/alerts/low-stock", view, c.lowStock);
router.get("/alerts/reorder", view, c.reorder);
router.get("/reports/slow-moving", view, c.slowMoving);
router.get("/reports/aging", view, c.aging);
router.get("/reports/expiry", view, c.expiry);

router.get("/opening-stocks", view, c.listOpenings);
router.post("/opening-stocks", manage, validate(openingStockSchema), c.createOpening);
router.post("/opening-stocks/:id/post", manage, c.postOpening);

router.post("/adjustments", manage, validate(stockAdjustmentSchema), c.createAdj);
router.post("/adjustments/:id/post", manage, c.postAdj);

router.get("/issues", view, c.listIssues);
router.post("/issues", manage, validate(stockIssueSchema), c.createIssue);
router.post("/issues/:id/post", manage, c.postIssue);

router.get("/returns", view, c.listReturns);
router.post("/returns", manage, validate(stockReturnSchema), c.createReturn);
router.post("/returns/:id/post", manage, c.postReturn);

router.get("/reservations", view, c.listReservations);
router.post("/reservations", manage, validate(reservationSchema), c.createReservation);
router.post("/reservations/:id/release", manage, c.releaseReservation);

router.get("/counts", view, c.listCounts);
router.post("/counts", manage, validate(stockCountCreateSchema), c.createCount);
router.get("/counts/:id", view, c.getCount);
router.patch("/counts/:id/lines", manage, validate(stockCountLinesSchema), c.recordCount);
router.post("/counts/:id/submit", manage, c.submitCount);
router.post("/counts/:id/approve", approve, c.approveCount);
router.post("/counts/:id/post", manage, c.postCount);

export default router;
