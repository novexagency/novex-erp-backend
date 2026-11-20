import {
  AuthEventType,
  MemberStatus,
  SubscriptionStatus,
  type User,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import {
  generateRefreshToken,
  hashToken,
  refreshExpiryDate,
  signAccessToken,
} from "../../lib/tokens.js";
import { AppError } from "../../utils/AppError.js";
import { recordAuthEvent } from "./auth.events.js";
import type {
  ChangePasswordInput,
  ConfirmPasswordResetInput,
  LoginInput,
} from "./auth.validation.js";

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const RESET_TOKEN_HOURS = 2;

export type RequestMeta = {
  ipAddress?: string;
  userAgent?: string;
};

export type PublicMembership = {
  organizationId: string;
  organizationName: string;
  organizationCode: string;
  jobTitle?: string | null;
  status: string;
  roles: string[];
  subscriptionStatus?: string | null;
  tenantActive: boolean;
};

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  avatarUrl?: string | null;
  isSuperAdmin: boolean;
  isActive: boolean;
  lastLoginAt?: string | null;
  memberships?: PublicMembership[];
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    isSuperAdmin: user.isSuperAdmin,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

export async function fetchUserWithMemberships(userId: string): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        include: {
          organization: {
            include: {
              subscriptions: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
          memberRoles: { include: { role: true } },
        },
      },
    },
  });

  if (!user) return null;

  return {
    ...toPublicUser(user),
    memberships: user.memberships.map((m) => ({
      organizationId: m.organization.id,
      organizationName: m.organization.name,
      organizationCode: m.organization.code,
      jobTitle: m.jobTitle,
      status: m.status,
      roles: m.memberRoles.map((mr) => mr.role.name),
      subscriptionStatus: m.organization.subscriptions[0]?.status ?? null,
      tenantActive: m.organization.isActive,
    })),
  };
}

function assertNotLocked(user: User) {
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError("Account temporarily locked. Try again later.", 423);
  }
}

async function registerFailedLogin(
  email: string,
  user: User | null,
  meta: RequestMeta
) {
  if (user) {
    const failedLoginCount = user.failedLoginCount + 1;
    const lockedUntil =
      failedLoginCount >= MAX_FAILED_LOGINS
        ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
        : null;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount,
        lockedUntil: lockedUntil ?? undefined,
      },
    });
  }

  await recordAuthEvent({
    type: AuthEventType.LOGIN_FAILED,
    userId: user?.id,
    emailAttempt: email,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

/**
 * Tenant login gate: non-platform users must have at least one ACTIVE membership
 * in an active tenant whose subscription is not SUSPENDED/CANCELLED.
 */
async function assertTenantLoginAllowed(user: User) {
  if (user.isSuperAdmin) return;

  const memberships = await prisma.organizationMember.findMany({
    where: { userId: user.id, status: MemberStatus.ACTIVE },
    include: {
      organization: {
        include: {
          subscriptions: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  const usable = memberships.filter((m) => {
    if (!m.organization.isActive) return false;
    const sub = m.organization.subscriptions[0];
    if (!sub) return true;
    return (
      sub.status === SubscriptionStatus.ACTIVE ||
      sub.status === SubscriptionStatus.TRIAL ||
      sub.status === SubscriptionStatus.PAST_DUE
    );
  });

  if (usable.length === 0) {
    throw new AppError(
      "No active tenant subscription available for this account",
      403
    );
  }
}

async function issueTokens(
  user: User,
  meta: RequestMeta = {}
): Promise<AuthTokens> {
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    isSuperAdmin: user.isSuperAdmin,
  });

  const refreshToken = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshExpiryDate(),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    },
  });

  return { accessToken, refreshToken };
}

export async function login(
  input: LoginInput,
  meta: RequestMeta = {}
): Promise<{ user: PublicUser; tokens: AuthTokens }> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user) {
    await registerFailedLogin(input.email, null, meta);
    throw new AppError("Invalid email or password", 401);
  }

  assertNotLocked(user);

  if (!user.isActive) {
    await registerFailedLogin(input.email, user, meta);
    throw new AppError("Invalid email or password", 401);
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    await registerFailedLogin(input.email, user, meta);
    throw new AppError("Invalid email or password", 401);
  }

  await assertTenantLoginAllowed(user);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    },
  });

  const tokens = await issueTokens(user, meta);
  const fullUser = (await fetchUserWithMemberships(user.id)) ?? toPublicUser(user);

  await recordAuthEvent({
    type: AuthEventType.LOGIN_SUCCESS,
    userId: user.id,
    emailAttempt: user.email,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    meta: { isSuperAdmin: user.isSuperAdmin },
  });

  return { user: fullUser, tokens };
}

export async function refresh(
  rawRefreshToken: string | undefined,
  meta: RequestMeta = {}
): Promise<{ user: PublicUser; tokens: AuthTokens }> {
  if (!rawRefreshToken) {
    throw new AppError("Refresh token required", 401);
  }

  const tokenHash = hashToken(rawRefreshToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new AppError("Invalid refresh token", 401);
  }

  if (!stored.user.isActive) {
    throw new AppError("Invalid refresh token", 401);
  }

  assertNotLocked(stored.user);
  await assertTenantLoginAllowed(stored.user);

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const tokens = await issueTokens(stored.user, meta);
  const fullUser =
    (await fetchUserWithMemberships(stored.user.id)) ?? toPublicUser(stored.user);

  await recordAuthEvent({
    type: AuthEventType.REFRESH,
    userId: stored.user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { user: fullUser, tokens };
}

export async function logout(
  rawRefreshToken: string | undefined,
  meta: RequestMeta = {},
  userId?: string
): Promise<void> {
  if (rawRefreshToken) {
    const tokenHash = hashToken(rawRefreshToken);
    const updated = await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (updated.count > 0 || userId) {
      await recordAuthEvent({
        type: AuthEventType.LOGOUT,
        userId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }
    return;
  }

  if (userId) {
    await recordAuthEvent({
      type: AuthEventType.LOGOUT,
      userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }
}

export async function me(userId: string): Promise<PublicUser> {
  const user = await fetchUserWithMemberships(userId);
  if (!user || !user.isActive) {
    throw new AppError("Authentication required", 401);
  }
  return user;
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  meta: RequestMeta = {}
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) {
    throw new AppError("Authentication required", 401);
  }

  const ok = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!ok) {
    throw new AppError("Current password is incorrect", 400);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(input.newPassword) },
  });

  // Revoke all other sessions after password change
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await recordAuthEvent({
    type: AuthEventType.PASSWORD_CHANGE,
    userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

export async function issuePasswordResetToken(options: {
  targetUserId: string;
  createdByUserId: string;
  meta?: RequestMeta;
}): Promise<{ resetToken: string; expiresAt: Date }> {
  const target = await prisma.user.findUnique({ where: { id: options.targetUserId } });
  if (!target) {
    throw new AppError("User not found", 404);
  }

  const raw = generateRefreshToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_HOURS * 60 * 60 * 1000);

  await prisma.passwordResetToken.create({
    data: {
      userId: target.id,
      tokenHash: hashToken(raw),
      expiresAt,
      createdBy: options.createdByUserId,
    },
  });

  await recordAuthEvent({
    type: AuthEventType.PASSWORD_RESET_REQUEST,
    userId: target.id,
    ipAddress: options.meta?.ipAddress,
    userAgent: options.meta?.userAgent,
    meta: { createdBy: options.createdByUserId },
  });

  // Returned once to admin/internal caller — never logged.
  return { resetToken: raw, expiresAt };
}

export async function confirmPasswordReset(
  input: ConfirmPasswordResetInput,
  meta: RequestMeta = {}
): Promise<void> {
  const tokenHash = hashToken(input.token);
  const stored = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
    throw new AppError("Invalid or expired reset token", 400);
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: stored.userId },
      data: {
        passwordHash,
        failedLoginCount: 0,
        lockedUntil: null,
        isActive: true,
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: stored.id },
      data: { usedAt: new Date() },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await recordAuthEvent({
    type: AuthEventType.PASSWORD_RESET_CONFIRM,
    userId: stored.userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

export async function listSessions(userId: string) {
  const sessions = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      ipAddress: true,
      userAgent: true,
    },
  });

  return sessions.map((s) => ({
    id: s.id,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
  }));
}

export async function revokeSession(
  userId: string,
  sessionId: string,
  meta: RequestMeta = {}
) {
  const result = await prisma.refreshToken.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (result.count === 0) {
    throw new AppError("Session not found", 404);
  }

  await recordAuthEvent({
    type: AuthEventType.SESSION_REVOKE,
    userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    meta: { sessionId },
  });
}

export async function revokeAllSessions(
  userId: string,
  meta: RequestMeta = {},
  exceptTokenHash?: string
) {
  await prisma.refreshToken.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptTokenHash ? { NOT: { tokenHash: exceptTokenHash } } : {}),
    },
    data: { revokedAt: new Date() },
  });

  await recordAuthEvent({
    type: AuthEventType.SESSION_REVOKE,
    userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    meta: { all: true },
  });
}

export async function listLoginHistory(userId: string, limit = 50) {
  const events = await prisma.authEvent.findMany({
    where: {
      userId,
      type: {
        in: [
          AuthEventType.LOGIN_SUCCESS,
          AuthEventType.LOGIN_FAILED,
          AuthEventType.LOGOUT,
          AuthEventType.PASSWORD_CHANGE,
          AuthEventType.SESSION_REVOKE,
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
    select: {
      id: true,
      type: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      organizationId: true,
    },
  });

  return events.map((e) => ({
    id: e.id,
    type: e.type,
    ipAddress: e.ipAddress,
    userAgent: e.userAgent,
    organizationId: e.organizationId,
    createdAt: e.createdAt.toISOString(),
  }));
}

export async function setUserActiveState(options: {
  targetUserId: string;
  isActive: boolean;
  actorUserId: string;
  meta?: RequestMeta;
}) {
  if (options.targetUserId === options.actorUserId && !options.isActive) {
    throw new AppError("Cannot deactivate your own account", 400);
  }

  const target = await prisma.user.findUnique({ where: { id: options.targetUserId } });
  if (!target) throw new AppError("User not found", 404);
  if (target.isSuperAdmin && !options.isActive) {
    throw new AppError("Cannot deactivate a platform superadmin this way", 403);
  }

  await prisma.user.update({
    where: { id: options.targetUserId },
    data: { isActive: options.isActive },
  });

  if (!options.isActive) {
    await prisma.refreshToken.updateMany({
      where: { userId: options.targetUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  await recordAuthEvent({
    type: options.isActive
      ? AuthEventType.ACCOUNT_ACTIVATED
      : AuthEventType.ACCOUNT_DEACTIVATED,
    userId: options.targetUserId,
    ipAddress: options.meta?.ipAddress,
    userAgent: options.meta?.userAgent,
    meta: { actorUserId: options.actorUserId },
  });

  return fetchUserWithMemberships(options.targetUserId);
}

export async function setMemberStatus(options: {
  tenantId: string;
  targetUserId: string;
  status: MemberStatus;
  actorUserId: string;
  meta?: RequestMeta;
}) {
  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: options.tenantId,
        userId: options.targetUserId,
      },
    },
  });

  if (!membership) {
    throw new AppError("Membership not found in this tenant", 404);
  }

  const updated = await prisma.organizationMember.update({
    where: { id: membership.id },
    data: { status: options.status },
  });

  if (options.status === MemberStatus.SUSPENDED) {
    // Do not revoke all global sessions if user has other tenants;
    // tenant middleware will block this tenant.
  }

  await recordAuthEvent({
    type:
      options.status === MemberStatus.ACTIVE
        ? AuthEventType.ACCOUNT_ACTIVATED
        : AuthEventType.ACCOUNT_DEACTIVATED,
    userId: options.targetUserId,
    organizationId: options.tenantId,
    ipAddress: options.meta?.ipAddress,
    userAgent: options.meta?.userAgent,
    meta: { actorUserId: options.actorUserId, status: options.status },
  });

  return updated;
}

/** Used by seed only */
export async function ensureAdminUser(data: {
  email: string;
  password: string;
  name: string;
}): Promise<PublicUser> {
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    return toPublicUser(existing);
  }

  const user = await prisma.user.create({
    data: {
      email: data.email,
      name: data.name,
      passwordHash: await hashPassword(data.password),
      isSuperAdmin: true,
    },
  });

  return toPublicUser(user);
}
