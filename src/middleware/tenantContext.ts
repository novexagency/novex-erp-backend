import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import * as tenantService from "../modules/tenant/tenant.service.js";
import { AppError } from "../utils/AppError.js";

/**
 * Resolves active tenant from authenticated user.
 * Optional hints (cookie / header) are verified against membership — never trusted alone.
 */
export async function tenantContext(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError("Authentication required", 401);
    }

    const headerTenant =
      (typeof req.headers["x-tenant-id"] === "string" && req.headers["x-tenant-id"]) ||
      (typeof req.headers["x-organization-id"] === "string" &&
        req.headers["x-organization-id"]) ||
      null;

    const cookieTenant =
      typeof req.cookies?.[env.TENANT_COOKIE_NAME] === "string"
        ? (req.cookies[env.TENANT_COOKIE_NAME] as string)
        : null;

    const requestedTenantId = headerTenant || cookieTenant || null;

    const tenantId = await tenantService.resolveActiveTenantId({
      userId: req.user.id,
      isSuperAdmin: req.user.isSuperAdmin,
      requestedTenantId,
    });

    req.tenant = await tenantService.buildTenantContext(
      req.user.id,
      tenantId,
      req.user.isSuperAdmin
    );

    // Persist verified tenant choice for subsequent browser calls
    res.cookie(env.TENANT_COOKIE_NAME, tenantId, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: env.COOKIE_SAME_SITE,
      path: "/",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    next();
  } catch (err) {
    next(err);
  }
}

/** Require tenant context already attached */
export function requireTenant(req: Request, _res: Response, next: NextFunction): void {
  if (!req.tenant) {
    next(new AppError("Tenant context required", 403));
    return;
  }
  next();
}
