import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import {
  requireAnyPermission,
  requirePermission,
} from "../../middleware/requirePermission.js";
import { requireTenant, tenantContext } from "../../middleware/tenantContext.js";
import { validate } from "../../middleware/validate.js";
import * as rbacController from "./rbac.controller.js";
import {
  assignRoleSchema,
  createRoleSchema,
  unassignRoleSchema,
  updateRoleSchema,
} from "./rbac.validation.js";

const router = Router();

router.use(authGuard, tenantContext, requireTenant);

router.get(
  "/permissions",
  requireAnyPermission("roles:view", "users:manage"),
  rbacController.listPermissions
);

router.get(
  "/roles",
  requireAnyPermission("roles:view", "users:manage"),
  rbacController.listRoles
);
router.get(
  "/roles/:roleId",
  requireAnyPermission("roles:view", "users:manage"),
  rbacController.getRole
);
router.post(
  "/roles",
  requireAnyPermission("roles:create", "users:manage"),
  validate(createRoleSchema),
  rbacController.createRole
);
router.patch(
  "/roles/:roleId",
  requireAnyPermission("roles:update", "users:manage"),
  validate(updateRoleSchema),
  rbacController.updateRole
);
router.delete(
  "/roles/:roleId",
  requireAnyPermission("roles:delete", "users:manage"),
  rbacController.deleteRole
);

router.post(
  "/assignments",
  requireAnyPermission("roles:update", "users:manage"),
  validate(assignRoleSchema),
  rbacController.assignRole
);
router.post(
  "/assignments/remove",
  requireAnyPermission("roles:update", "users:manage"),
  validate(unassignRoleSchema),
  rbacController.unassignRole
);
router.get(
  "/members/:userId",
  requireAnyPermission("roles:view", "users:manage"),
  rbacController.memberRoles
);

export default router;
