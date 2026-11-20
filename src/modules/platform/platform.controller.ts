import type { NextFunction, Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/AppError.js";
import * as platform from "./platform.service.js";
import { provisionTenant } from "./provision.service.js";
import { getTenantDetail } from "./provision.service.js";

function param(v: string | string[] | undefined) {
  if (typeof v === "string" && v) return v;
  throw new AppError("Missing route parameter", 400);
}

export async function listTenants(req: Request, res: Response, next: NextFunction) {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const tenants = await platform.listTenantsDetailed({ q, status });
    res.status(200).json({ success: true, data: { tenants } });
  } catch (err) {
    next(err);
  }
}

export async function getTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const tenant = await getTenantDetail(param(req.params.tenantId));
    res.json({ success: true, data: { tenant } });
  } catch (err) {
    next(err);
  }
}

export async function getTenantStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await platform.tenantStatus(param(req.params.tenantId));
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function createTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const tenant = await provisionTenant(req.body);
    res.status(201).json({ success: true, data: { tenant } });
  } catch (err) {
    next(err);
  }
}

export async function patchSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const tenant = await platform.updateSubscription(param(req.params.tenantId), req.body);
    res.json({ success: true, data: { tenant } });
  } catch (err) {
    next(err);
  }
}

export async function putModules(req: Request, res: Response, next: NextFunction) {
  try {
    const tenant = await platform.setModules(param(req.params.tenantId), req.body.modules);
    res.json({ success: true, data: { tenant } });
  } catch (err) {
    next(err);
  }
}

export async function putEntitlements(req: Request, res: Response, next: NextFunction) {
  try {
    const tenant = await platform.setEntitlements(
      param(req.params.tenantId),
      req.body.entitlements
    );
    res.json({ success: true, data: { tenant } });
  } catch (err) {
    next(err);
  }
}

export async function getModuleCatalog(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: { modules: platform.moduleCatalog() } });
  } catch (err) {
    next(err);
  }
}

export async function grantSupport(req: Request, res: Response, next: NextFunction) {
  try {
    const grant = await platform.grantSupportAccess(
      param(req.params.tenantId),
      {
        ...req.body,
        authorizedByUserId: req.user?.id,
      },
      { ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined }
    );
    res.status(201).json({ success: true, data: { grant } });
  } catch (err) {
    next(err);
  }
}

export async function revokeSupport(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = req.user?.id ?? "platform-service";
    const grant = await platform.revokeSupportAccess(param(req.params.accessId), actorId, {
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    });
    res.json({ success: true, data: { grant } });
  } catch (err) {
    next(err);
  }
}

export async function listSupport(req: Request, res: Response, next: NextFunction) {
  try {
    const items = await platform.listSupportAccess(param(req.params.tenantId));
    const logs = await platform.listSupportAccessLogs(param(req.params.tenantId));
    res.json({ success: true, data: { items, logs } });
  } catch (err) {
    next(err);
  }
}

export async function getPlatformHealth(_req: Request, res: Response, next: NextFunction) {
  try {
    const [tenantCount, userCount, staffCount, activeSubs, suspended] = await Promise.all([
      prisma.organization.count(),
      prisma.user.count(),
      prisma.platformStaff.count(),
      prisma.tenantSubscription.count({
        where: { status: { in: ["ACTIVE", "TRIAL", "PAST_DUE"] } },
      }),
      prisma.tenantSubscription.count({ where: { status: "SUSPENDED" } }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        namespace: "platform",
        phase: "18-platform-control",
        counts: {
          tenants: tenantCount,
          users: userCount,
          platformStaff: staffCount,
          activeSubscriptions: activeSubs,
          suspendedSubscriptions: suspended,
        },
        locales: ["en", "ar"],
        warehouseModeDefault: "single",
        moduleCatalog: platform.moduleCatalog(),
      },
    });
  } catch (err) {
    next(err);
  }
}
