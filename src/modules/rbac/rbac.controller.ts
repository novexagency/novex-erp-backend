import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../utils/AppError.js";
import * as tenantService from "../tenant/tenant.service.js";
import * as rbacService from "./rbac.service.js";
import type { z } from "zod";
import type {
  assignRoleSchema,
  createRoleSchema,
  unassignRoleSchema,
  updateRoleSchema,
} from "./rbac.validation.js";

function actor(req: Request) {
  if (!req.user || !req.tenant) throw new AppError("Tenant context required", 403);
  return {
    permissionCodes: req.tenant.membership.permissionCodes,
    isSuperAdmin: req.user.isSuperAdmin,
  };
}

function param(value: string | string[] | undefined): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new AppError("Missing route parameter", 400);
}

export async function listPermissions(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await rbacService.listPermissions(true);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function listRoles(req: Request, res: Response, next: NextFunction) {
  try {
    const roles = await rbacService.listRoles(req.tenant!.tenantId);
    res.status(200).json({ success: true, data: { roles } });
  } catch (err) {
    next(err);
  }
}

export async function getRole(req: Request, res: Response, next: NextFunction) {
  try {
    const roleId = param(req.params.roleId);
    const role = await rbacService.getRole(req.tenant!.tenantId, roleId);
    res.status(200).json({
      success: true,
      data: {
        role: {
          id: role.id,
          name: role.name,
          description: role.description,
          isSystem: role.isSystem,
          assignedUsers: role._count.memberRoles,
          permissions: role.rolePermissions.map((rp) => ({
            id: rp.permission.id,
            code: rp.permission.code,
            module: rp.permission.module,
            action: rp.permission.action,
          })),
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function createRole(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as z.infer<typeof createRoleSchema>;
    const role = await rbacService.createRole(req.tenant!.tenantId, body, actor(req));
    await tenantService.recordTenantActivity({
      tenantId: req.tenant!.tenantId,
      userId: req.user!.id,
      action: "ROLE_CREATE",
      entity: "Role",
      entityId: role.id,
      meta: { name: role.name },
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    });
    res.status(201).json({ success: true, data: { role } });
  } catch (err) {
    next(err);
  }
}

export async function updateRole(req: Request, res: Response, next: NextFunction) {
  try {
    const roleId = param(req.params.roleId);
    const body = req.body as z.infer<typeof updateRoleSchema>;
    const role = await rbacService.updateRole(
      req.tenant!.tenantId,
      roleId,
      body,
      actor(req)
    );
    await tenantService.recordTenantActivity({
      tenantId: req.tenant!.tenantId,
      userId: req.user!.id,
      action: "ROLE_UPDATE",
      entity: "Role",
      entityId: role.id,
      meta: body,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    });
    res.status(200).json({ success: true, data: { role } });
  } catch (err) {
    next(err);
  }
}

export async function deleteRole(req: Request, res: Response, next: NextFunction) {
  try {
    const roleId = param(req.params.roleId);
    await rbacService.deleteRole(req.tenant!.tenantId, roleId);
    await tenantService.recordTenantActivity({
      tenantId: req.tenant!.tenantId,
      userId: req.user!.id,
      action: "ROLE_DELETE",
      entity: "Role",
      entityId: roleId,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    });
    res.status(200).json({ success: true, message: "Role deleted" });
  } catch (err) {
    next(err);
  }
}

export async function assignRole(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as z.infer<typeof assignRoleSchema>;
    const assignment = await rbacService.assignRole(
      req.tenant!.tenantId,
      body,
      actor(req)
    );
    await tenantService.recordTenantActivity({
      tenantId: req.tenant!.tenantId,
      userId: req.user!.id,
      action: "ROLE_ASSIGN",
      entity: "MemberRole",
      entityId: assignment.id,
      meta: body,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    });
    res.status(200).json({ success: true, data: { assignment } });
  } catch (err) {
    next(err);
  }
}

export async function unassignRole(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as z.infer<typeof unassignRoleSchema>;
    await rbacService.unassignRole(req.tenant!.tenantId, body);
    await tenantService.recordTenantActivity({
      tenantId: req.tenant!.tenantId,
      userId: req.user!.id,
      action: "ROLE_UNASSIGN",
      entity: "MemberRole",
      meta: body,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    });
    res.status(200).json({ success: true, message: "Role unassigned" });
  } catch (err) {
    next(err);
  }
}

export async function memberRoles(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = param(req.params.userId);
    const member = await rbacService.listMemberRoles(req.tenant!.tenantId, userId);
    res.status(200).json({ success: true, data: { member } });
  } catch (err) {
    next(err);
  }
}
