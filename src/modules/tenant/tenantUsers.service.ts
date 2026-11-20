import { AuthEventType, MemberStatus, Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../../lib/password.js";
import { prisma } from "../../lib/prisma.js";
import { requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { hashToken } from "../../lib/tokens.js";
import { assertWithinUserSeatLimit } from "../platform/entitlements.service.js";
import { assertNoPrivilegeEscalation } from "../rbac/rbac.service.js";
import { recordAuthEvent } from "../auth/auth.events.js";
import * as authService from "../auth/auth.service.js";

export type TenantUserActor = {
  id: string;
  isSuperAdmin: boolean;
  permissionCodes: string[];
};

export type TenantUserListQuery = {
  search?: string;
  status?: "ACTIVE" | "SUSPENDED";
  page?: number;
  pageSize?: number;
};

const memberInclude = {
  user: {
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      isActive: true,
      lastLoginAt: true,
      failedLoginCount: true,
      lockedUntil: true,
      createdAt: true,
    },
  },
  memberRoles: {
    include: {
      role: { select: { id: true, name: true } },
    },
  },
} as const;

function mapTenantUser(m: {
  status: MemberStatus;
  user: {
    id: string;
    email: string;
    name: string;
    isActive: boolean;
    lastLoginAt: Date | null;
    failedLoginCount: number;
    lockedUntil: Date | null;
  };
  memberRoles: Array<{ role: { id: string; name: string } }>;
}) {
  return {
    id: m.user.id,
    name: m.user.name,
    email: m.user.email,
    isActive: m.user.isActive,
    membershipStatus: m.status,
    roles: m.memberRoles.map((mr) => ({ id: mr.role.id, name: mr.role.name })),
    lastLoginAt: m.user.lastLoginAt ? m.user.lastLoginAt.toISOString() : null,
    failedLoginCount: m.user.failedLoginCount,
    lockedUntil: m.user.lockedUntil ? m.user.lockedUntil.toISOString() : null,
  };
}

function randomUnusablePassword() {
  return `Ux${randomBytes(24).toString("base64url")}`;
}

export async function listTenantUsers(tenantId: TenantId, query: TenantUserListQuery = {}) {
  const tid = requireTenantId(tenantId);
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const search = query.search?.trim();

  const where: Prisma.OrganizationMemberWhereInput = {
    organizationId: tid,
    ...(query.status ? { status: query.status as MemberStatus } : {}),
    ...(search
      ? {
          OR: [
            { user: { name: { contains: search, mode: "insensitive" } } },
            { user: { email: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [total, members] = await Promise.all([
    prisma.organizationMember.count({ where }),
    prisma.organizationMember.findMany({
      where,
      include: memberInclude,
      orderBy: { joinedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items: members.map(mapTenantUser),
    page,
    pageSize,
    total,
  };
}

/**
 * Create or link a platform user into this tenant.
 * - Password never returned.
 * - If password omitted → issue reset token (admin handoff).
 * - Existing users in other orgs are linked (no duplicate User row).
 */
export async function createTenantUser(
  tenantId: TenantId,
  data: {
    email: string;
    name: string;
    password?: string | null;
    roleIds: string[];
    branchId?: string | null;
    membershipStatus?: "ACTIVE" | "INVITED" | "SUSPENDED";
  },
  actor: TenantUserActor
) {
  const tid = requireTenantId(tenantId);
  const email = data.email.trim().toLowerCase();
  const name = data.name.trim();
  if (!email || !name) throw new AppError("email and name are required", 400);
  if (!data.roleIds?.length) throw new AppError("At least one roleId is required", 400);

  const membershipStatus = (data.membershipStatus ?? "ACTIVE") as MemberStatus;
  if (
    membershipStatus !== MemberStatus.ACTIVE &&
    membershipStatus !== MemberStatus.INVITED &&
    membershipStatus !== MemberStatus.SUSPENDED
  ) {
    throw new AppError("Invalid membershipStatus", 400);
  }

  await assertWithinUserSeatLimit(tid);

  const roleBranchId = data.branchId ?? null;
  if (roleBranchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: roleBranchId, organizationId: tid },
    });
    if (!branch) throw new AppError("Branch not found", 404);
  }

  const roles = await prisma.role.findMany({
    where: { organizationId: tid, id: { in: data.roleIds } },
    include: { rolePermissions: { include: { permission: true } } },
  });
  if (roles.length !== data.roleIds.length) {
    throw new AppError("One or more roles were not found in this tenant", 404);
  }

  const rolePermissionCodes = [
    ...new Set(roles.flatMap((r) => r.rolePermissions.map((rp) => rp.permission.code))),
  ];
  assertNoPrivilegeEscalation(actor.permissionCodes, rolePermissionCodes, actor.isSuperAdmin);

  const existingUser = await prisma.user.findUnique({ where: { email } });
  const passwordProvided = Boolean(data.password?.trim());
  let createdUser = false;

  if (existingUser && passwordProvided) {
    throw new AppError(
      "User already exists — omit password to link them to this organization",
      409
    );
  }

  const membership = await prisma.$transaction(async (tx) => {
    let user = existingUser;
    if (!user) {
      const passwordHash = await hashPassword(
        passwordProvided ? data.password!.trim() : randomUnusablePassword()
      );
      user = await tx.user.create({
        data: {
          email,
          name,
          passwordHash,
          isActive: true,
        },
      });
      createdUser = true;
    } else if (user.name !== name) {
      await tx.user.update({ where: { id: user.id }, data: { name } });
      user = { ...user, name };
    }

    const existingMembership = await tx.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: tid, userId: user.id },
      },
    });
    if (existingMembership) {
      throw new AppError("User is already a member of this tenant", 409);
    }

    const created = await tx.organizationMember.create({
      data: {
        organizationId: tid,
        userId: user.id,
        status: membershipStatus,
      },
    });

    for (const roleId of data.roleIds) {
      await tx.memberRole.create({
        data: {
          memberId: created.id,
          roleId,
          branchId: roleBranchId,
        },
      });
    }

    return tx.organizationMember.findUniqueOrThrow({
      where: { id: created.id },
      include: memberInclude,
    });
  });

  let resetToken: string | null = null;
  let resetTokenExpiresAt: string | null = null;
  if (!passwordProvided) {
    const issued = await authService.issuePasswordResetToken({
      targetUserId: membership.userId,
      createdByUserId: actor.id,
    });
    resetToken = issued.resetToken;
    resetTokenExpiresAt = issued.expiresAt.toISOString();
  }

  await recordAuthEvent({
    type: AuthEventType.ACCOUNT_ACTIVATED,
    userId: membership.userId,
    organizationId: tid,
    meta: {
      actorUserId: actor.id,
      action: "tenant_user_create",
      createdUser,
      roleIds: data.roleIds,
      membershipStatus,
      resetIssued: !passwordProvided,
    } as Prisma.InputJsonValue,
  });

  return {
    item: mapTenantUser(membership),
    createdUser,
    resetToken,
    resetTokenExpiresAt,
    delivery: resetToken ? ("internal_admin_handoff" as const) : null,
  };
}

async function assertUserInTenant(tenantId: string, userId: string) {
  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId: tenantId, userId },
    },
  });
  if (!membership) throw new AppError("User not found in this tenant", 404);
  return membership;
}

export async function listUserSessions(tenantId: TenantId, userId: string) {
  const tid = requireTenantId(tenantId);
  await assertUserInTenant(tid, userId);
  return authService.listSessions(userId);
}

/**
 * Admin revoke of a target user's session.
 * If admin targets self and session is the current refresh cookie, require allowCurrent.
 */
export async function revokeUserSession(
  tenantId: TenantId,
  userId: string,
  sessionId: string,
  actor: {
    id: string;
    currentRefreshToken?: string;
    allowCurrent?: boolean;
    meta?: { ipAddress?: string; userAgent?: string };
  }
) {
  const tid = requireTenantId(tenantId);
  await assertUserInTenant(tid, userId);

  if (actor.id === userId && actor.currentRefreshToken) {
    const current = await prisma.refreshToken.findFirst({
      where: {
        id: sessionId,
        userId,
        tokenHash: hashToken(actor.currentRefreshToken),
        revokedAt: null,
      },
    });
    if (current && !actor.allowCurrent) {
      throw new AppError(
        "Revoking the current session requires allowCurrent=true",
        400
      );
    }
  }

  await authService.revokeSession(userId, sessionId, actor.meta);
}

export async function listTenantAuthEvents(
  tenantId: TenantId,
  query: {
    type?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  } = {}
) {
  const tid = requireTenantId(tenantId);
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

  const members = await prisma.organizationMember.findMany({
    where: { organizationId: tid },
    select: {
      userId: true,
      user: { select: { email: true } },
    },
  });
  const memberUserIds = members.map((m) => m.userId);
  const memberEmails = members.map((m) => m.user.email.toLowerCase());

  if (memberUserIds.length === 0 && memberEmails.length === 0) {
    return { items: [], page, pageSize, total: 0 };
  }

  const typeFilter =
    query.type && Object.values(AuthEventType).includes(query.type as AuthEventType)
      ? (query.type as AuthEventType)
      : undefined;

  const and: Prisma.AuthEventWhereInput[] = [
    {
      OR: [
        ...(memberUserIds.length ? [{ userId: { in: memberUserIds } }] : []),
        ...(memberEmails.length
          ? [
              {
                AND: [
                  { emailAttempt: { in: memberEmails } },
                  { OR: [{ userId: null }, { userId: { in: memberUserIds } }] },
                ],
              },
            ]
          : []),
      ],
    },
  ];
  if (typeFilter) and.push({ type: typeFilter });
  if (query.from || query.to) {
    and.push({
      createdAt: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      },
    });
  }

  // Org-scoped: member userIds, or LOGIN_FAILED rows whose emailAttempt matches a member
  // (covers writes where userId was null).
  const where: Prisma.AuthEventWhereInput = { AND: and };

  const [total, events] = await Promise.all([
    prisma.authEvent.count({ where }),
    prisma.authEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        type: true,
        emailAttempt: true,
        userId: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        organizationId: true,
      },
    }),
  ]);

  return {
    items: events.map((e) => ({
      id: e.id,
      type: e.type,
      emailAttempt: e.emailAttempt,
      userId: e.userId,
      ipAddress: e.ipAddress,
      userAgent: e.userAgent,
      createdAt: e.createdAt.toISOString(),
      // Scope marker for admin UI — event may be global; attribute to this tenant view
      organizationId: e.organizationId ?? tid,
    })),
    page,
    pageSize,
    total,
  };
}
