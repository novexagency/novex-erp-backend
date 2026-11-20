import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { requireAnyPermission } from "../../middleware/requirePermission.js";
import { requireTenant, tenantContext } from "../../middleware/tenantContext.js";
import { validate } from "../../middleware/validate.js";
import * as c from "./finance.controller.js";
import {
  bankAccountSchema,
  cancelSchema,
  cashboxSchema,
  costCenterSchema,
  expenseAttachmentSchema,
  expenseSchema,
  integritySchema,
  manualMovementSchema,
  paymentSchema,
  receiptSchema,
  reconcileSchema,
  recurringExpenseSchema,
  transferSchema,
} from "./finance.validation.js";

const router = Router();
router.use(authGuard, tenantContext, requireTenant);

const view = requireAnyPermission("finance:read", "finance:view", "finance:manage");
const manage = requireAnyPermission("finance:manage", "finance:create", "finance:update");
const approve = requireAnyPermission("finance:manage", "finance:approve");

// Dashboard & reports
router.get("/dashboard", view, c.dashboard);
router.get("/balances", view, c.balances);
router.get("/cash-flow", view, c.cashFlow);
router.get("/reports/expenses", view, c.expenseReport);
router.post("/integrity", view, validate(integritySchema), c.verifyIntegrity);
router.post("/reconcile", manage, validate(reconcileSchema), c.reconcile);

// Cashboxes & banks
router.get("/cashboxes", view, c.listCashboxes);
router.post("/cashboxes", manage, validate(cashboxSchema), c.createCashbox);
router.get("/cashboxes/:id/statement", view, c.cashboxStatement);
router.get("/banks", view, c.listBankAccounts);
router.post("/banks", manage, validate(bankAccountSchema), c.createBankAccount);
router.get("/banks/:id/statement", view, c.bankStatement);

// Manual movements & transfers
router.post("/movements", manage, validate(manualMovementSchema), c.postManualMovement);
router.get("/transfers", view, c.listTransfers);
router.post("/transfers", manage, validate(transferSchema), c.createTransfer);
router.post("/transfers/:id/post", manage, c.postTransfer);
router.post("/transfers/:id/cancel", approve, validate(cancelSchema), c.cancelTransfer);

// Receipts
router.get("/receipts", view, c.listReceipts);
router.post("/receipts", manage, validate(receiptSchema), c.createReceipt);
router.post("/receipts/:id/post", manage, c.postReceipt);
router.post("/receipts/:id/cancel", approve, validate(cancelSchema), c.cancelReceipt);

// Payments
router.get("/payments", view, c.listPayments);
router.post("/payments", manage, validate(paymentSchema), c.createPayment);
router.post("/payments/:id/post", manage, c.postPayment);
router.post("/payments/:id/cancel", approve, validate(cancelSchema), c.cancelPayment);

// Cost centers & expenses
router.get("/cost-centers", view, c.listCostCenters);
router.post("/cost-centers", manage, validate(costCenterSchema), c.createCostCenter);
router.get("/expenses", view, c.listExpenses);
router.post("/expenses", manage, validate(expenseSchema), c.createExpense);
router.post("/expenses/:id/approve", approve, c.approveExpense);
router.post("/expenses/:id/post", manage, c.postExpense);
router.post("/expenses/:id/cancel", approve, validate(cancelSchema), c.cancelExpense);
router.post(
  "/expenses/:id/attachments",
  manage,
  validate(expenseAttachmentSchema),
  c.addExpenseAttachment
);
router.get("/recurring-expenses", view, c.listRecurringExpenses);
router.post(
  "/recurring-expenses",
  manage,
  validate(recurringExpenseSchema),
  c.createRecurringExpense
);

export default router;
