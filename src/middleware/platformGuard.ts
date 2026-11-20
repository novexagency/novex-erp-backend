import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

/**
 * NOVEX Central Control Panel guard.
 * Allows: (1) authenticated superadmin users, or (2) PLATFORM_SERVICE_KEY header
 * for machine-to-machine sync from novex_admin_back.
 */
export function platformGuard(req: Request, _res: Response, next: NextFunction): void {
  const key = req.header("x-platform-key") || req.header("X-Platform-Key");
  if (env.PLATFORM_SERVICE_KEY && key && key === env.PLATFORM_SERVICE_KEY) {
    (req as Request & { platformService?: boolean }).platformService = true;
    next();
    return;
  }

  if (!req.user?.isSuperAdmin) {
    next(new AppError("Platform access denied", 403));
    return;
  }
  next();
}
