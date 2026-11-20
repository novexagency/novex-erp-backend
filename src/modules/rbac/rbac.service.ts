import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { allPermissionDefs } from "./permissions.catalog.js";
import type { z } from "zod";
import type {
  assignRoleSchema,
  createRoleSchema,
  unassignRoleSchema,
  updateRoleSchema,
} from "./rbac.validation.js";

export async function syncPermissionCatalog() {
  const defs = allPermissionDefs();
  // Batch create missing permissions; updates for existing codes happen in seed.
  await prisma.permission.createMany({
    data: defs,
    skipDuplicates: true,
  });
  return defs.length;
}

export async function listPermissions(grouped = true) {
  const permissions = await prisma.permission.findMany({
    orderBy: [{ module: "asc" }, { action: "asc" }],
  });

  if (!grouped) return { permissions };

  const groups: Record<string, typeof permissions> = {};
  for (const p of permissions) {
    const key = p.module;
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }
  return { permissions, groups };
}

export async function listRoles(tenantId: TenantId) {
  const roles = await prisma.role.findMany({
    where: { organizationId: tenantId },
    include: {
      rolePermissions: { include: { permission: true } },
      _count: { select: { memberRoles: true } },
    },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });

  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    assignedUsers: r._count.memberRoles,
    permissions: r.rolePermissions.map((rp) => ({
      id: rp.permission.id,
      code: rp.permission.code,
      module: rp.permission.module,
      action: rp.permission.action,
    })),
  }));
}

export async function getRole(tenantId: TenantId, roleId: string) {
  const role = await prisma.role.findFirst({
    where: { id: roleId, organizationId: tenantId },
    include: {
      rolePermissions: { include: { permission: true } },
      _count: { select: { memberRoles: true } },
    },
  });
  if (!role) throw new AppError("Role not found", 404);
  return role;
}

async function resolvePermissionIds(codes: string[]) {
  if (codes.length === 0) return [] as string[];
  const unique = [...new Set(codes)];
  const found = await prisma.permission.findMany({
    where: { code: { in: unique } },
  });
  if (found.length !== unique.length) {
    const have = new Set(found.map((p) => p.code));
    const missing = unique.filter((c) => !have.has(c));
    throw new AppError(`Unknown permission codes: ${missing.join(", ")}`, 400);
  }
  return found.map((p) => p.id);
}

/**
 * Prevent privilege escalation: actor may only grant permissions they possess
 * (platform superadmin exempt).
 */
export function assertNoPrivilegeEscalation(
  actorPermissionCodes: string[],
  requestedCodes: string[],
  isSuperAdmin: boolean
) {
  if (isSuperAdmin) return;
  const owned = new Set(actorPermissionCodes);
  if (owned.has("users:manage")) {
    // Full user/role administrators can grant any catalog permission within tenant
    return;
  }
  const illegal = requestedCodes.filter((c) => !owned.has(c));
  if (illegal.length > 0) {
    throw new AppError(
      "Cannot assign permissions you do not possess",
      403
    );
  }
}

export async function createRole(
  tenantId: TenantId,
  data: z.infer<typeof createRoleSchema>,
  actor: { permissionCodes: string[]; isSuperAdmin: boolean }
) {
  assertNoPrivilegeEscalation(
    actor.permissionCodes,
    data.permissionCodes,
    actor.isSuperAdmin
  );

  const existing = await prisma.role.findFirst({
    where: { organizationId: tenantId, name: data.name },
  });
  if (existing) throw new AppError("Role name already exists", 409);

  const permissionIds = await resolvePermissionIds(data.permissionCodes);

  const role = await prisma.role.create({
    data: {
      organizationId: tenantId,
      name: data.name,
      description: data.description ?? null,
      isSystem: false,
      rolePermissions: {
        create: permissionIds.map((permissionId) => ({ permissionId })),
      },
    },
    include: {
      rolePermissions: { include: { permission: true } },
    },
  });

  return role;
}

export async function updateRole(
  tenantId: TenantId,
  roleId: string,
  data: z.infer<typeof updateRoleSchema>,
  actor: { permissionCodes: string[]; isSuperAdmin: boolean }
) {
  const role = await getRole(tenantId, roleId);

  if (role.isSystem && data.name && data.name !== role.name) {
    throw new AppError("System role name cannot be changed", 403);
  }

  if (data.permissionCodes) {
    assertNoPrivilegeEscalation(
      actor.permissionCodes,
      data.permissionCodes,
      actor.isSuperAdmin
    );
  }

  if (data.name && data.name !== role.name) {
    const clash = await prisma.role.findFirst({
      where: {
        organizationId: tenantId,
        name: data.name,
        NOT: { id: roleId },
      },
    });
    if (clash) throw new AppError("Role name already exists", 409);
  }

  const permissionIds = data.permissionCodes
    ? await resolvePermissionIds(data.permissionCodes)
    : null;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.role.update({
      where: { id: roleId },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
      },
    });

    if (permissionIds) {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissionIds.length) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
        });
      }
    }

    return tx.role.findUniqueOrThrow({
      where: { id: updated.id },
      include: { rolePermissions: { include: { permission: true } } },
    });
  });
}

export async function deleteRole(tenantId: TenantId, roleId: string) {
  const role = await getRole(tenantId, roleId);
  if (role.isSystem) {
    throw new AppError("System roles cannot be deleted", 403);
  }
  if (role._count.memberRoles > 0) {
    throw new AppError("Role is assigned to users and cannot be deleted", 409);
  }

  await prisma.role.delete({ where: { id: roleId } });
}

export async function assignRole(
  tenantId: TenantId,
  data: z.infer<typeof assignRoleSchema>,
  actor: { permissionCodes: string[]; isSuperAdmin: boolean }
) {
  const role = await getRole(tenantId, data.roleId);
  const roleCodes = role.rolePermissions.map((rp) => rp.permission.code);
  assertNoPrivilegeEscalation(actor.permissionCodes, roleCodes, actor.isSuperAdmin);

  const member = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: tenantId,
        userId: data.userId,
      },
    },
  });
  if (!member) throw new AppError("User is not a member of this tenant", 404);

  if (data.branchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: data.branchId, organizationId: tenantId },
    });
    if (!branch) throw new AppError("Branch not found in this tenant", 404);
  }

  const existing = await prisma.memberRole.findFirst({
    where: {
      memberId: member.id,
      roleId: data.roleId,
      branchId: data.branchId ?? null,
    },
  });

  if (existing) {
    return prisma.memberRole.findUniqueOrThrow({
      where: { id: existing.id },
      include: {
        role: true,
        member: {
          include: { user: { select: { id: true, email: true, name: true } } },
        },
      },
    });
  }

  return prisma.memberRole.create({
    data: {
      memberId: member.id,
      roleId: data.roleId,
      branchId: data.branchId ?? null,
    },
    include: {
      role: true,
      member: {
        include: { user: { select: { id: true, email: true, name: true } } },
      },
    },
  });
}

export async function unassignRole(
  tenantId: TenantId,
  data: z.infer<typeof unassignRoleSchema>
) {
  await getRole(tenantId, data.roleId);

  const member = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: tenantId,
        userId: data.userId,
      },
    },
  });
  if (!member) throw new AppError("User is not a member of this tenant", 404);

  const result = await prisma.memberRole.deleteMany({
    where: {
      memberId: member.id,
      roleId: data.roleId,
      branchId: data.branchId ?? null,
    },
  });

  if (result.count === 0) throw new AppError("Role assignment not found", 404);
}

export async function listMemberRoles(tenantId: TenantId, userId: string) {
  const member = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId: tenantId, userId },
    },
    include: {
      memberRoles: {
        include: {
          role: {
            include: { rolePermissions: { include: { permission: true } } },
          },
          branch: true,
        },
      },
      user: { select: { id: true, email: true, name: true, isActive: true } },
    },
  });
  if (!member) throw new AppError("User is not a member of this tenant", 404);
  return member;
}

/** Ensure Owner/Administrator system roles have the full current catalog */
export async function refreshSystemRolePermissions(tenantId: TenantId) {
  const all = await prisma.permission.findMany({ select: { id: true } });
  const systemRoles = await prisma.role.findMany({
    where: {
      organizationId: tenantId,
      name: { in: ["Owner", "Administrator"] },
      isSystem: true,
    },
    select: { id: true },
  });

  for (const role of systemRoles) {
    await prisma.rolePermission.createMany({
      data: all.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }
}
