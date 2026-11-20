import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError.js";

/**
 * Backend authorization guard — never rely on frontend visibility alone.
 * Requires `authGuard` + `tenantContext` to have run (or platform superadmin).
 */
export function requirePermission(...requiredCodes: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!req.user) {
        throw new AppError("Authentication required", 401);
      }

      // Platform superadmin may operate across tenants for Central Control tasks
      if (req.user.isSuperAdmin) {
        next();
        return;
      }

      if (!req.tenant) {
        throw new AppError("Tenant context required", 403);
      }

      if (requiredCodes.length === 0) {
        next();
        return;
      }

      const owned = new Set(req.tenant.membership.permissionCodes);
      // Legacy aliases
      if (owned.has("users:manage")) {
        owned.add("users:view");
        owned.add("users:create");
        owned.add("users:update");
        owned.add("users:delete");
        owned.add("roles:view");
        owned.add("roles:create");
        owned.add("roles:update");
        owned.add("roles:delete");
        owned.add("roles:approve");
      }
      if (owned.has("org:manage")) {
        owned.add("settings:view");
        owned.add("settings:update");
      }

      const missing = requiredCodes.filter((code) => !owned.has(code));
      if (missing.length > 0) {
        throw new AppError("Insufficient permissions", 403);
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Any-of permission helper */
export function requireAnyPermission(...codes: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!req.user) throw new AppError("Authentication required", 401);
      if (req.user.isSuperAdmin) {
        next();
        return;
      }
      if (!req.tenant) throw new AppError("Tenant context required", 403);

      const owned = new Set(req.tenant.membership.permissionCodes);
      if (owned.has("users:manage")) {
        owned.add("roles:view");
        owned.add("roles:create");
        owned.add("roles:update");
        owned.add("roles:delete");
        for (const c of codes) owned.add(c);
      }
      if (owned.has("org:manage")) {
        owned.add("settings:view");
        owned.add("settings:update");
      }
      if (owned.has("inventory:manage")) {
        owned.add("inventory:view");
        owned.add("inventory:update");
        owned.add("inventory:delete");
      }

      const ok = codes.some((c) => owned.has(c));
      if (!ok) throw new AppError("Insufficient permissions", 403);
      next();
    } catch (err) {
      next(err);
    }
  };
}
