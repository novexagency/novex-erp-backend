import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { requireAnyPermission } from "../../middleware/requirePermission.js";
import { requireTenant, tenantContext } from "../../middleware/tenantContext.js";
import { validate } from "../../middleware/validate.js";
import * as c from "./crm.controller.js";
import {
  customerCategorySchema,
  customerGroupSchema,
  customerSchema,
  customerTagSchema,
  followUpSchema,
  interactionSchema,
  ledgerEntrySchema,
  noteSchema,
  opportunitySchema,
} from "./crm.validation.js";

const router = Router();
router.use(authGuard, tenantContext, requireTenant);

const view = requireAnyPermission("customers:view", "sales:read", "sales:view");
const manage = requireAnyPermission("customers:create", "customers:update", "sales:manage");

router.get("/customers", view, c.listCustomers);
router.post("/customers", manage, validate(customerSchema), c.createCustomer);
router.get("/customers/:id", view, c.getCustomer);
router.patch("/customers/:id", manage, validate(customerSchema.partial()), c.updateCustomer);
router.post("/customers/:id/archive", manage, c.archiveCustomer);

router.get("/customers/:id/financial", view, c.financialSummary);
router.get("/customers/:id/statement", view, c.statement);
router.get("/customers/:id/ledger", view, c.listLedger);
router.post("/customers/:id/ledger", manage, validate(ledgerEntrySchema), c.addLedger);

router.get("/customers/:id/timeline", view, c.timeline);
router.get("/customers/:id/notes", view, c.listNotes);
router.post("/customers/:id/notes", manage, validate(noteSchema), c.addNote);
router.get("/customers/:id/interactions", view, c.listInteractions);
router.post("/customers/:id/interactions", manage, validate(interactionSchema), c.addInteraction);
router.get("/customers/:id/follow-ups", view, c.listFollowUps);
router.post("/customers/:id/follow-ups", manage, validate(followUpSchema), c.addFollowUp);
router.patch("/follow-ups/:followUpId", manage, validate(followUpSchema.partial()), c.updateFollowUp);
router.get("/customers/:id/opportunities", view, c.listOpportunities);
router.post("/customers/:id/opportunities", manage, validate(opportunitySchema), c.addOpportunity);
router.patch(
  "/opportunities/:opportunityId",
  manage,
  validate(opportunitySchema.partial()),
  c.updateOpportunity
);

router.get("/categories", view, c.listCategories);
router.post("/categories", manage, validate(customerCategorySchema), c.createCategory);
router.get("/groups", view, c.listGroups);
router.post("/groups", manage, validate(customerGroupSchema), c.createGroup);
router.get("/tags", view, c.listTags);
router.post("/tags", manage, validate(customerTagSchema), c.createTag);

export default router;
