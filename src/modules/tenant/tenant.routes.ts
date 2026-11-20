import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { requireTenant, tenantContext } from "../../middleware/tenantContext.js";
import { validate } from "../../middleware/validate.js";
import {
  createTenantUserSchema,
  issuePasswordResetSchema,
  setMemberStatusSchema,
  setUserActiveSchema,
} from "../auth/auth.validation.js";
import * as tenantController from "./tenant.controller.js";
import * as tenantUsersController from "./tenantUsers.controller.js";
import { switchTenantSchema, updateTenantConfigSchema } from "./tenant.validation.js";

const router = Router();

router.use(authGuard);

router.get("/memberships", tenantController.listMyTenants);

router.post(
  "/switch",
  validate(switchTenantSchema),
  tenantController.switchTenant
);

router.use(tenantContext, requireTenant);

router.get("/context", tenantController.getContext);
router.get("/modules", tenantController.getModules);
router.get("/entitlements", tenantController.getEntitlements);
router.patch(
  "/config",
  validate(updateTenantConfigSchema),
  tenantController.updateConfig
);

// Tenant user administration — requires users:manage (enforced in controller)
router.get("/users", tenantUsersController.listUsers);
router.post(
  "/users",
  validate(createTenantUserSchema),
  tenantUsersController.createUser
);
router.get("/auth-events", tenantUsersController.listAuthEvents);
router.post(
  "/users/password-reset",
  validate(issuePasswordResetSchema),
  tenantUsersController.issuePasswordReset
);
router.get("/users/:userId/sessions", tenantUsersController.listUserSessions);
router.delete(
  "/users/:userId/sessions/:sessionId",
  tenantUsersController.revokeUserSession
);
router.patch(
  "/users/:userId/active",
  validate(setUserActiveSchema),
  tenantUsersController.setUserActive
);
router.patch(
  "/users/:userId/membership-status",
  validate(setMemberStatusSchema),
  tenantUsersController.setMemberStatus
);

export default router;
