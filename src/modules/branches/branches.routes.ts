import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { requireAnyPermission } from "../../middleware/requirePermission.js";
import { requireTenant, tenantContext } from "../../middleware/tenantContext.js";
import { validate } from "../../middleware/validate.js";
import * as branchesController from "./branches.controller.js";
import { createBranchSchema, updateBranchSchema } from "./branches.validation.js";

const router = Router();

router.use(authGuard, tenantContext, requireTenant);

router.get(
  "/",
  requireAnyPermission("branches:read", "branches:manage", "org:manage"),
  branchesController.listBranches
);

router.post(
  "/",
  requireAnyPermission("branches:manage", "org:manage"),
  validate(createBranchSchema),
  branchesController.createBranch
);

router.patch(
  "/:id",
  requireAnyPermission("branches:manage", "org:manage"),
  validate(updateBranchSchema),
  branchesController.updateBranch
);

export default router;
