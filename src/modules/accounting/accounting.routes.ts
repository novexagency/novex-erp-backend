import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { requireAnyPermission } from "../../middleware/requirePermission.js";
import { requireTenant, tenantContext } from "../../middleware/tenantContext.js";
import { validate } from "../../middleware/validate.js";
import * as c from "./accounting.controller.js";
import {
  createJournalSchema,
  fiscalYearSchema,
  glAccountSchema,
  periodSchema,
  postingRuleSchema,
  reopenPeriodSchema,
  reverseJournalSchema,
  updateGlAccountSchema,
  updateJournalSchema,
} from "./accounting.validation.js";

const router = Router();
router.use(authGuard, tenantContext, requireTenant);

const view = requireAnyPermission(
  "accounting:read",
  "accounting:view",
  "accounting:manage",
  "finance:read",
  "finance:manage"
);
const create = requireAnyPermission("accounting:create", "accounting:manage");
const post = requireAnyPermission("accounting:post", "accounting:manage", "accounting:approve");
const configure = requireAnyPermission("accounting:configure", "accounting:manage");
const reopen = requireAnyPermission("accounting:reopen", "accounting:manage");

// COA
router.get("/accounts", view, c.listAccounts);
router.post("/accounts/seed-defaults", configure, c.seedDefaults);
router.post("/accounts", configure, validate(glAccountSchema), c.createAccount);
router.get("/accounts/:id", view, c.getAccount);
router.patch("/accounts/:id", configure, validate(updateGlAccountSchema), c.updateAccount);

// Fiscal years & periods
router.get("/fiscal-years", view, c.listFiscalYears);
router.post("/fiscal-years", configure, validate(fiscalYearSchema), c.createFiscalYear);
router.post("/fiscal-years/:id/close", configure, c.closeFiscalYear);
router.get("/periods", view, c.listPeriods);
router.post("/periods", configure, validate(periodSchema), c.createPeriod);
router.post("/periods/:id/close", configure, c.closePeriod);
router.post("/periods/:id/lock", configure, c.lockPeriod);
router.post("/periods/:id/reopen", reopen, validate(reopenPeriodSchema), c.reopenPeriod);

// Posting rules (per event type)
router.get("/posting-rules", view, c.listRules);
router.patch("/posting-rules/:eventType", configure, validate(postingRuleSchema), c.updateRule);

// Journals
router.get("/journals", view, c.listJournals);
router.post("/journals", create, validate(createJournalSchema), c.createJournal);
router.get("/journals/:id", view, c.getJournal);
router.patch("/journals/:id", create, validate(updateJournalSchema), c.updateJournal);
router.post("/journals/:id/post", post, c.postJournal);
router.post("/journals/:id/reverse", post, validate(reverseJournalSchema), c.reverseJournal);

// Reports
router.get("/reports/trial-balance", view, c.trialBalance);
router.get("/reports/general-ledger", view, c.generalLedger);
router.get("/reports/income-statement", view, c.incomeStatement);
router.get("/reports/balance-sheet", view, c.balanceSheet);
router.get("/reports/cash-flow", view, c.cashFlow);
router.get("/reports/account-statement", view, c.accountStatement);
router.get("/reports/journals", view, c.journalReport);

export default router;
