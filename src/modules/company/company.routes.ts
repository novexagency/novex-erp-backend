import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { requireAnyPermission } from "../../middleware/requirePermission.js";
import { requireTenant, tenantContext } from "../../middleware/tenantContext.js";
import { validate } from "../../middleware/validate.js";
import * as companyController from "./company.controller.js";
import {
  updateCompanyProfileSchema,
  updateSystemConfigSchema,
  updateWarehouseLocationSchema,
  updateWarehouseSchema,
  upsertWarehouseSchema,
  warehouseLocationSchema,
} from "./company.validation.js";

const router = Router();

router.use(authGuard, tenantContext, requireTenant);

router.get(
  "/",
  requireAnyPermission("settings:view", "org:manage"),
  companyController.getCompany
);
router.patch(
  "/profile",
  requireAnyPermission("settings:update", "org:manage"),
  validate(updateCompanyProfileSchema),
  companyController.updateProfile
);
router.patch(
  "/system-config",
  requireAnyPermission("settings:update", "org:manage"),
  validate(updateSystemConfigSchema),
  companyController.updateSystemConfig
);

router.get(
  "/warehouse",
  requireAnyPermission("inventory:view", "inventory:read", "org:manage"),
  companyController.getWarehouse
);
router.put(
  "/warehouse",
  requireAnyPermission("inventory:update", "inventory:manage", "org:manage"),
  validate(upsertWarehouseSchema),
  companyController.upsertWarehouse
);
router.patch(
  "/warehouse/:warehouseId",
  requireAnyPermission("inventory:update", "inventory:manage", "org:manage"),
  validate(updateWarehouseSchema),
  companyController.updateWarehouse
);

router.post(
  "/warehouse/locations",
  requireAnyPermission("inventory:update", "inventory:manage", "org:manage"),
  validate(warehouseLocationSchema),
  companyController.addLocation
);
router.patch(
  "/warehouse/locations/:locationId",
  requireAnyPermission("inventory:update", "inventory:manage", "org:manage"),
  validate(updateWarehouseLocationSchema),
  companyController.updateLocation
);
router.delete(
  "/warehouse/locations/:locationId",
  requireAnyPermission("inventory:delete", "inventory:manage", "org:manage"),
  companyController.deleteLocation
);

export default router;
