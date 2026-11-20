import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../utils/AppError.js";
import * as tenantService from "../tenant/tenant.service.js";
import * as companyService from "./company.service.js";
import type { z } from "zod";
import type {
  updateCompanyProfileSchema,
  updateSystemConfigSchema,
  updateWarehouseLocationSchema,
  updateWarehouseSchema,
  upsertWarehouseSchema,
  warehouseLocationSchema,
} from "./company.validation.js";

function requireTenantCtx(req: Request) {
  if (!req.user || !req.tenant) throw new AppError("Tenant context required", 403);
  return req.tenant;
}

function assertCanManageCompany(req: Request) {
  const tenant = requireTenantCtx(req);
  const roles = tenant.membership.roles.map((r) => r.toLowerCase());
  const ok =
    req.user!.isSuperAdmin ||
    roles.some((r) =>
      ["owner", "administrator", "company administrator", "tenant owner"].includes(r)
    ) ||
    tenant.membership.permissionCodes.includes("org:manage");
  if (!ok) throw new AppError("Insufficient permissions", 403);
}

function param(value: string | string[] | undefined): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new AppError("Missing route parameter", 400);
}

export async function getCompany(req: Request, res: Response, next: NextFunction) {
  try {
    const tenant = requireTenantCtx(req);
    const data = await companyService.getCompanyBundle(tenant.tenantId);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    assertCanManageCompany(req);
    const body = req.body as z.infer<typeof updateCompanyProfileSchema>;
    const profile = await companyService.updateCompanyProfile(req.tenant!.tenantId, body);
    await tenantService.recordTenantActivity({
      tenantId: req.tenant!.tenantId,
      userId: req.user!.id,
      action: "COMPANY_PROFILE_UPDATE",
      entity: "Organization",
      entityId: req.tenant!.tenantId,
      meta: body,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    });
    res.status(200).json({ success: true, data: { profile } });
  } catch (err) {
    next(err);
  }
}

export async function updateSystemConfig(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    assertCanManageCompany(req);
    const body = req.body as z.infer<typeof updateSystemConfigSchema>;
    const config = await companyService.updateSystemConfig(req.tenant!.tenantId, body);
    await tenantService.recordTenantActivity({
      tenantId: req.tenant!.tenantId,
      userId: req.user!.id,
      action: "SYSTEM_CONFIG_UPDATE",
      entity: "TenantSystemConfig",
      entityId: config.id,
      meta: body,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    });
    const bundle = await companyService.getCompanyBundle(req.tenant!.tenantId);
    res.status(200).json({ success: true, data: { systemConfig: bundle.systemConfig } });
  } catch (err) {
    next(err);
  }
}

export async function getWarehouse(req: Request, res: Response, next: NextFunction) {
  try {
    const tenant = requireTenantCtx(req);
    const warehouse = await companyService.getWarehouse(tenant.tenantId);
    res.status(200).json({ success: true, data: { warehouse } });
  } catch (err) {
    next(err);
  }
}

export async function upsertWarehouse(req: Request, res: Response, next: NextFunction) {
  try {
    assertCanManageCompany(req);
    const body = req.body as z.infer<typeof upsertWarehouseSchema>;
    const warehouse = await companyService.upsertWarehouse(req.tenant!.tenantId, body);
    await tenantService.recordTenantActivity({
      tenantId: req.tenant!.tenantId,
      userId: req.user!.id,
      action: "WAREHOUSE_UPSERT",
      entity: "Warehouse",
      entityId: warehouse.id,
      meta: { code: warehouse.code },
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    });
    res.status(200).json({ success: true, data: { warehouse } });
  } catch (err) {
    next(err);
  }
}

export async function updateWarehouse(req: Request, res: Response, next: NextFunction) {
  try {
    assertCanManageCompany(req);
    const warehouseId = param(req.params.warehouseId);
    const body = req.body as z.infer<typeof updateWarehouseSchema>;
    const warehouse = await companyService.updateWarehouse(
      req.tenant!.tenantId,
      warehouseId,
      body
    );
    res.status(200).json({ success: true, data: { warehouse } });
  } catch (err) {
    next(err);
  }
}

export async function addLocation(req: Request, res: Response, next: NextFunction) {
  try {
    assertCanManageCompany(req);
    const body = req.body as z.infer<typeof warehouseLocationSchema>;
    const location = await companyService.addWarehouseLocation(
      req.tenant!.tenantId,
      body
    );
    res.status(201).json({ success: true, data: { location } });
  } catch (err) {
    next(err);
  }
}

export async function updateLocation(req: Request, res: Response, next: NextFunction) {
  try {
    assertCanManageCompany(req);
    const locationId = param(req.params.locationId);
    const body = req.body as z.infer<typeof updateWarehouseLocationSchema>;
    const location = await companyService.updateWarehouseLocation(
      req.tenant!.tenantId,
      locationId,
      body
    );
    res.status(200).json({ success: true, data: { location } });
  } catch (err) {
    next(err);
  }
}

export async function deleteLocation(req: Request, res: Response, next: NextFunction) {
  try {
    assertCanManageCompany(req);
    const locationId = param(req.params.locationId);
    await companyService.deleteWarehouseLocation(req.tenant!.tenantId, locationId);
    res.status(200).json({ success: true, message: "Location deleted" });
  } catch (err) {
    next(err);
  }
}
