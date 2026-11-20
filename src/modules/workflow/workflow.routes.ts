import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { requireAnyPermission } from "../../middleware/requirePermission.js";
import { requireTenant, tenantContext } from "../../middleware/tenantContext.js";
import { validate } from "../../middleware/validate.js";
import * as c from "./workflow.controller.js";
import {
  approveSchema,
  createDefinitionSchema,
  createDelegationSchema,
  createDocumentSchema,
  delegateSchema,
  docCategorySchema,
  docTagSchema,
  jobRecipientsSchema,
  linkSchema,
  rejectSchema,
  replaceStepsSchema,
  updateDefinitionSchema,
  updateDocumentSchema,
  versionSchema,
} from "./workflow.validation.js";

const router = Router();
router.use(authGuard, tenantContext, requireTenant);

const wfRead = requireAnyPermission("workflow:read", "workflow:manage", "workflow:approve");
const wfConfig = requireAnyPermission("workflow:configure", "workflow:manage");
const wfApprove = requireAnyPermission("workflow:approve", "workflow:manage");
const docRead = requireAnyPermission("documents:read", "documents:manage");
const docManage = requireAnyPermission("documents:manage");
const notifRead = requireAnyPermission("notifications:read", "notifications:manage", "workflow:read");
const notifManage = requireAnyPermission("notifications:manage", "workflow:manage");

// Definitions
router.get("/definitions", wfRead, c.listDefinitions);
router.post("/definitions", wfConfig, validate(createDefinitionSchema), c.createDefinition);
router.get("/definitions/:id", wfRead, c.getDefinition);
router.patch("/definitions/:id", wfConfig, validate(updateDefinitionSchema), c.updateDefinition);
router.post("/definitions/:id/steps", wfConfig, validate(replaceStepsSchema), c.replaceSteps);

// Approvals
router.get("/approvals/inbox", wfApprove, c.inbox);
router.post("/approvals/escalations/refresh", wfConfig, c.refreshEscalations);
router.get("/approvals", wfRead, c.listApprovals);
router.get("/approvals/:id", wfRead, c.getApproval);
router.post("/approvals/:id/approve", wfApprove, validate(approveSchema), c.approve);
router.post("/approvals/:id/reject", wfApprove, validate(rejectSchema), c.reject);
router.post("/approvals/:id/delegate", wfApprove, validate(delegateSchema), c.delegate);

// Delegations
router.get("/delegations", wfConfig, c.listDelegations);
router.post("/delegations", wfConfig, validate(createDelegationSchema), c.createDelegation);
router.post("/delegations/:id/revoke", wfConfig, c.revokeDelegation);

// Documents
router.get("/documents/categories", docRead, c.listDocCategories);
router.post("/documents/categories", docManage, validate(docCategorySchema), c.createDocCategory);
router.get("/documents/tags", docRead, c.listDocTags);
router.post("/documents/tags", docManage, validate(docTagSchema), c.createDocTag);
router.get("/documents", docRead, c.listDocuments);
router.post("/documents", docManage, validate(createDocumentSchema), c.createDocument);
router.get("/documents/:id", docRead, c.getDocument);
router.patch("/documents/:id", docManage, validate(updateDocumentSchema), c.updateDocument);
router.post("/documents/:id/archive", docManage, c.archiveDocument);
router.post("/documents/:id/versions", docManage, validate(versionSchema), c.addVersion);
router.post("/documents/:id/links", docManage, validate(linkSchema), c.linkDocument);
router.get("/documents/:id/download", docRead, c.downloadDocument);

// Notifications
router.get("/notifications", notifRead, c.listNotifications);
router.post("/notifications/read-all", notifRead, c.markAllRead);
router.post(
  "/notifications/jobs/low-stock",
  notifManage,
  validate(jobRecipientsSchema),
  c.jobLowStock
);
router.post(
  "/notifications/jobs/expiring-documents",
  notifManage,
  validate(jobRecipientsSchema),
  c.jobExpiringDocs
);
router.post("/notifications/:id/read", notifRead, c.markRead);

export default router;
