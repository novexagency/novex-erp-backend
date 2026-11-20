import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { platformGuard } from "../../middleware/platformGuard.js";
import { validate } from "../../middleware/validate.js";
import * as c from "./platform.controller.js";
import {
  entitlementsSchema,
  modulesSchema,
  provisionTenantSchema,
  subscriptionSchema,
  supportAccessSchema,
} from "./platform.validation.js";

const router = Router();

/** Superadmin JWT/cookie OR X-Platform-Key service auth for Control Panel sync. */
router.use((req, res, next) => {
  const key = req.header("x-platform-key") || req.header("X-Platform-Key");
  if (key) {
    platformGuard(req, res, next);
    return;
  }
  void authGuard(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    platformGuard(req, res, next);
  });
});

router.get("/health", c.getPlatformHealth);
router.get("/modules/catalog", c.getModuleCatalog);
router.get("/tenants", c.listTenants);
router.post("/tenants", validate(provisionTenantSchema), c.createTenant);
router.get("/tenants/:tenantId", c.getTenant);
router.get("/tenants/:tenantId/status", c.getTenantStatus);
router.patch(
  "/tenants/:tenantId/subscription",
  validate(subscriptionSchema),
  c.patchSubscription
);
router.put("/tenants/:tenantId/modules", validate(modulesSchema), c.putModules);
router.put(
  "/tenants/:tenantId/entitlements",
  validate(entitlementsSchema),
  c.putEntitlements
);
router.get("/tenants/:tenantId/support-access", c.listSupport);
router.post(
  "/tenants/:tenantId/support-access",
  validate(supportAccessSchema),
  c.grantSupport
);
router.post("/support-access/:accessId/revoke", c.revokeSupport);

export default router;
