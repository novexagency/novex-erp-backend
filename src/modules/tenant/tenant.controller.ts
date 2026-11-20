import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import * as tenantService from "./tenant.service.js";
import { switchTenantSchema, updateTenantConfigSchema } from "./tenant.validation.js";
import type { z } from "zod";

export async function listMyTenants(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const tenants = await tenantService.listMembershipsForUser(req.user.id);
    res.status(200).json({ success: true, data: { tenants } });
  } catch (err) {
    next(err);
  }
}

export async function getContext(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.tenant) throw new AppError("Tenant context required", 403);
    res.status(200).json({ success: true, data: { tenant: req.tenant } });
  } catch (err) {
    next(err);
  }
}

export async function switchTenant(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const body = req.body as z.infer<typeof switchTenantSchema>;

    const ctx = await tenantService.buildTenantContext(
      req.user.id,
      body.tenantId,
      req.user.isSuperAdmin
    );

    res.cookie(env.TENANT_COOKIE_NAME, body.tenantId, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: env.COOKIE_SAME_SITE,
      path: "/",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    await tenantService.recordTenantActivity({
      tenantId: body.tenantId,
      userId: req.user.id,
      action: "TENANT_SWITCH",
      entity: "Organization",
      entityId: body.tenantId,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    });

    res.status(200).json({ success: true, data: { tenant: ctx } });
  } catch (err) {
    next(err);
  }
}

export async function getModules(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.tenant) throw new AppError("Tenant context required", 403);
    res.status(200).json({ success: true, data: { modules: req.tenant.modules } });
  } catch (err) {
    next(err);
  }
}

export async function getEntitlements(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.tenant) throw new AppError("Tenant context required", 403);
    res.status(200).json({
      success: true,
      data: {
        subscription: req.tenant.subscription,
        entitlements: req.tenant.entitlements,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function updateConfig(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user || !req.tenant) throw new AppError("Tenant context required", 403);
    const body = req.body as z.infer<typeof updateTenantConfigSchema>;

    const updated = await tenantService.updateTenantConfig(req.tenant.tenantId, body);
    await tenantService.recordTenantActivity({
      tenantId: req.tenant.tenantId,
      userId: req.user.id,
      action: "TENANT_CONFIG_UPDATE",
      entity: "Organization",
      entityId: req.tenant.tenantId,
      meta: body,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    });

    const ctx = await tenantService.buildTenantContext(
      req.user.id,
      updated.id,
      req.user.isSuperAdmin
    );

    res.status(200).json({ success: true, data: { tenant: ctx } });
  } catch (err) {
    next(err);
  }
}
