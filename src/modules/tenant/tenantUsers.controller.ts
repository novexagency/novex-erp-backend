import type { NextFunction, Request, Response } from "express";
import { MemberStatus } from "@prisma/client";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import * as authService from "../auth/auth.service.js";
import type { z } from "zod";
import {
  createTenantUserSchema,
  issuePasswordResetSchema,
  listAuthEventsQuerySchema,
  listTenantUsersQuerySchema,
  revokeUserSessionSchema,
  setMemberStatusSchema,
  setUserActiveSchema,
} from "../auth/auth.validation.js";
import * as tenantUsersService from "./tenantUsers.service.js";

function meta(req: Request) {
  return {
    ipAddress: req.ip,
    userAgent: req.get("user-agent") || undefined,
  };
}

function param(value: string | string[] | undefined): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new AppError("Missing route parameter", 400);
}

/** users:manage (or Owner/Administrator role names / platform superadmin). */
function assertUsersManage(req: Request) {
  if (!req.user || !req.tenant) {
    throw new AppError("Tenant context required", 403);
  }
  const roles = req.tenant.membership.roles.map((r) => r.toLowerCase());
  const allowed =
    req.user.isSuperAdmin ||
    roles.some((r) =>
      ["owner", "administrator", "company administrator", "tenant owner"].includes(r)
    ) ||
    req.tenant.membership.permissionCodes.includes("users:manage");

  if (!allowed) {
    throw new AppError("Insufficient permissions — users:manage required", 403);
  }
}

export async function listUsers(req: Request, res: Response, next: NextFunction) {
  try {
    assertUsersManage(req);
    const query = listTenantUsersQuerySchema.parse(req.query);
    const data = await tenantUsersService.listTenantUsers(req.tenant!.tenantId, query);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function createUser(req: Request, res: Response, next: NextFunction) {
  try {
    assertUsersManage(req);
    const body = req.body as z.infer<typeof createTenantUserSchema>;
    const result = await tenantUsersService.createTenantUser(
      req.tenant!.tenantId,
      body,
      {
        id: req.user!.id,
        isSuperAdmin: req.user!.isSuperAdmin,
        permissionCodes: req.tenant!.membership.permissionCodes,
      }
    );
    res.status(201).json({
      success: true,
      data: {
        item: result.item,
        createdUser: result.createdUser,
        resetToken: result.resetToken,
        resetTokenExpiresAt: result.resetTokenExpiresAt,
        delivery: result.delivery,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function listUserSessions(req: Request, res: Response, next: NextFunction) {
  try {
    assertUsersManage(req);
    const userId = param(req.params.userId);
    const sessions = await tenantUsersService.listUserSessions(
      req.tenant!.tenantId,
      userId
    );
    res.status(200).json({ success: true, data: { sessions } });
  } catch (err) {
    next(err);
  }
}

export async function revokeUserSession(req: Request, res: Response, next: NextFunction) {
  try {
    assertUsersManage(req);
    const userId = param(req.params.userId);
    const sessionId = param(req.params.sessionId);
    const body = revokeUserSessionSchema.parse(req.body ?? {});
    const allowCurrent =
      body.allowCurrent === true ||
      req.query.allowCurrent === "true" ||
      req.query.allowCurrent === "1";

    await tenantUsersService.revokeUserSession(
      req.tenant!.tenantId,
      userId,
      sessionId,
      {
        id: req.user!.id,
        currentRefreshToken: req.cookies?.[env.REFRESH_COOKIE_NAME] as string | undefined,
        allowCurrent,
        meta: meta(req),
      }
    );
    res.status(200).json({ success: true, message: "Session revoked" });
  } catch (err) {
    next(err);
  }
}

export async function listAuthEvents(req: Request, res: Response, next: NextFunction) {
  try {
    assertUsersManage(req);
    const query = listAuthEventsQuerySchema.parse(req.query);
    const data = await tenantUsersService.listTenantAuthEvents(
      req.tenant!.tenantId,
      query
    );
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function issuePasswordReset(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    assertUsersManage(req);
    const body = req.body as z.infer<typeof issuePasswordResetSchema>;

    if (!req.user!.isSuperAdmin) {
      const memberships = await authService.fetchUserWithMemberships(body.userId);
      const inTenant = memberships?.memberships?.some(
        (m) => m.organizationId === req.tenant!.tenantId
      );
      if (!inTenant) throw new AppError("User not found in this tenant", 404);
    }

    const result = await authService.issuePasswordResetToken({
      targetUserId: body.userId,
      createdByUserId: req.user!.id,
      meta: meta(req),
    });

    res.status(201).json({
      success: true,
      data: {
        resetToken: result.resetToken,
        expiresAt: result.expiresAt.toISOString(),
        delivery: "internal_admin_handoff",
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function setUserActive(req: Request, res: Response, next: NextFunction) {
  try {
    assertUsersManage(req);
    const body = req.body as z.infer<typeof setUserActiveSchema>;
    const userId = param(req.params.userId);

    if (!req.user!.isSuperAdmin) {
      const memberships = await authService.fetchUserWithMemberships(userId);
      const inTenant = memberships?.memberships?.some(
        (m) => m.organizationId === req.tenant!.tenantId
      );
      if (!inTenant) throw new AppError("User not found in this tenant", 404);
    }

    const user = await authService.setUserActiveState({
      targetUserId: userId,
      isActive: body.isActive,
      actorUserId: req.user!.id,
      meta: meta(req),
    });

    res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
}

export async function setMemberStatus(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    assertUsersManage(req);
    const body = req.body as z.infer<typeof setMemberStatusSchema>;
    const userId = param(req.params.userId);

    const membership = await authService.setMemberStatus({
      tenantId: req.tenant!.tenantId,
      targetUserId: userId,
      status: body.status as MemberStatus,
      actorUserId: req.user!.id,
      meta: meta(req),
    });

    res.status(200).json({ success: true, data: { membership } });
  } catch (err) {
    next(err);
  }
}
