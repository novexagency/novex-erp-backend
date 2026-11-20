import { Prisma, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { TENANT_BUSINESS_MODULE_CODES } from "../../types/tenant.js";
import { usageMetrics } from "./entitlements.service.js";
import { getTenantDetail } from "./provision.service.js";

export async function listTenantsDetailed(opts?: { status?: string; q?: string }) {
  const orgs = await prisma.organization.findMany({
    where: {
      ...(opts?.q
        ? {
            OR: [
              { name: { contains: opts.q, mode: "insensitive" } },
              { code: { contains: opts.q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(opts?.status === "inactive" ? { isActive: false } : {}),
      ...(opts?.status === "active" ? { isActive: true } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      subscriptions: { orderBy: { createdAt: "desc" }, take: 1 },
      modules: true,
      _count: { select: { members: true } },
    },
  });

  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    code: o.code,
    isActive: o.isActive,
    defaultLocale: o.defaultLocale,
    timezone: o.timezone,
    baseCurrency: o.baseCurrency,
    createdAt: o.createdAt,
    memberCount: o._count.members,
    enabledModuleCount: o.modules.filter((m) => m.enabled).length,
    subscription: o.subscriptions[0]
      ? {
          planCode: o.subscriptions[0].planCode,
          status: o.subscriptions[0].status,
          seats: o.subscriptions[0].seats,
          endsAt: o.subscriptions[0].endsAt,
          gracePeriodEndsAt: o.subscriptions[0].gracePeriodEndsAt,
        }
      : null,
  }));
}

export async function updateSubscription(
  tenantId: string,
  data: {
    planCode?: string;
    status?: SubscriptionStatus;
    seats?: number;
    endsAt?: string | null;
    trialEndsAt?: string | null;
    gracePeriodEndsAt?: string | null;
    renew?: boolean;
  }
) {
  const org = await prisma.organization.findUnique({ where: { id: tenantId } });
  if (!org) throw new AppError("Tenant not found", 404);

  let sub = await prisma.tenantSubscription.findFirst({
    where: { organizationId: tenantId },
    orderBy: { createdAt: "desc" },
  });
  if (!sub) {
    sub = await prisma.tenantSubscription.create({
      data: {
        organizationId: tenantId,
        planCode: data.planCode ?? "standard",
        status: data.status ?? SubscriptionStatus.ACTIVE,
        seats: data.seats ?? 10,
      },
    });
  }

  const updated = await prisma.tenantSubscription.update({
    where: { id: sub.id },
    data: {
      planCode: data.planCode,
      status: data.status,
      seats: data.seats,
      endsAt:
        data.endsAt === undefined
          ? undefined
          : data.endsAt
            ? new Date(data.endsAt)
            : null,
      trialEndsAt:
        data.trialEndsAt === undefined
          ? undefined
          : data.trialEndsAt
            ? new Date(data.trialEndsAt)
            : null,
      gracePeriodEndsAt:
        data.gracePeriodEndsAt === undefined
          ? undefined
          : data.gracePeriodEndsAt
            ? new Date(data.gracePeriodEndsAt)
            : null,
      renewedAt: data.renew ? new Date() : undefined,
    },
  });

  // Mirror suspension onto organization.isActive for hard block
  if (
    data.status === SubscriptionStatus.SUSPENDED ||
    data.status === SubscriptionStatus.CANCELLED
  ) {
    await prisma.organization.update({
      where: { id: tenantId },
      data: { isActive: false },
    });
  }
  if (
    data.status === SubscriptionStatus.ACTIVE ||
    data.status === SubscriptionStatus.TRIAL ||
    data.status === SubscriptionStatus.PAST_DUE
  ) {
    await prisma.organization.update({
      where: { id: tenantId },
      data: { isActive: true },
    });
  }

  await prisma.tenantActivity.create({
    data: {
      organizationId: tenantId,
      action: "SUBSCRIPTION_UPDATED",
      entity: "TenantSubscription",
      entityId: updated.id,
      meta: data as object,
    },
  });

  return getTenantDetail(tenantId);
}

export async function setModules(
  tenantId: string,
  modules: Array<{ moduleCode: string; enabled: boolean }>
) {
  const org = await prisma.organization.findUnique({ where: { id: tenantId } });
  if (!org) throw new AppError("Tenant not found", 404);

  for (const m of modules) {
    if (
      !(TENANT_BUSINESS_MODULE_CODES as readonly string[]).includes(m.moduleCode)
    ) {
      // Allow custom codes but prefer catalog
    }
    await prisma.tenantModule.upsert({
      where: {
        organizationId_moduleCode: {
          organizationId: tenantId,
          moduleCode: m.moduleCode,
        },
      },
      update: { enabled: m.enabled },
      create: {
        organizationId: tenantId,
        moduleCode: m.moduleCode,
        enabled: m.enabled,
      },
    });
  }

  await prisma.tenantActivity.create({
    data: {
      organizationId: tenantId,
      action: "MODULES_UPDATED",
      entity: "TenantModule",
      entityId: tenantId,
      meta: { modules },
    },
  });

  return getTenantDetail(tenantId);
}

export async function setEntitlements(
  tenantId: string,
  entitlements: Array<{ code: string; enabled?: boolean; limits?: unknown }>
) {
  const org = await prisma.organization.findUnique({ where: { id: tenantId } });
  if (!org) throw new AppError("Tenant not found", 404);

  for (const e of entitlements) {
    await prisma.tenantEntitlement.upsert({
      where: {
        organizationId_code: { organizationId: tenantId, code: e.code },
      },
      update: {
        enabled: e.enabled ?? true,
        limits:
          e.limits === undefined ? undefined : (e.limits as Prisma.InputJsonValue),
      },
      create: {
        organizationId: tenantId,
        code: e.code,
        enabled: e.enabled ?? true,
        limits: (e.limits as Prisma.InputJsonValue) ?? undefined,
      },
    });
  }

  return getTenantDetail(tenantId);
}

export async function tenantStatus(tenantId: string) {
  const detail = await getTenantDetail(tenantId);
  const usage = await usageMetrics(tenantId);
  const recentErrors = await prisma.tenantActivity.findMany({
    where: {
      organizationId: tenantId,
      action: { contains: "ERROR" },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return {
    ...detail,
    usage,
    recentErrors: recentErrors.map((e) => ({
      action: e.action,
      at: e.createdAt,
      meta: e.meta,
    })),
    applicationHealth: {
      orgActive: detail.isActive,
      subscriptionStatus: detail.subscription?.status ?? null,
      blocked:
        detail.subscription?.status === "SUSPENDED" ||
        detail.subscription?.status === "CANCELLED" ||
        !detail.isActive,
    },
  };
}

export async function grantSupportAccess(
  tenantId: string,
  data: {
    staffUserId: string;
    reason: string;
    hours?: number;
    authorizedByUserId?: string;
    scopes?: unknown;
  },
  meta?: { ipAddress?: string; userAgent?: string }
) {
  if (!data.reason?.trim() || data.reason.trim().length < 8) {
    throw new AppError("Support access requires an explicit reason (min 8 chars)", 400);
  }
  const org = await prisma.organization.findUnique({ where: { id: tenantId } });
  if (!org) throw new AppError("Tenant not found", 404);

  const hours = data.hours ?? 4;
  const endsAt = new Date(Date.now() + hours * 3600_000);

  const grant = await prisma.platformSupportAccess.create({
    data: {
      organizationId: tenantId,
      staffUserId: data.staffUserId,
      reason: data.reason.trim(),
      authorizedByUserId: data.authorizedByUserId,
      scopes: (data.scopes as Prisma.InputJsonValue) ?? { readOnly: true },
      endsAt,
    },
  });

  await prisma.platformSupportAccessLog.create({
    data: {
      organizationId: tenantId,
      staffUserId: data.staffUserId,
      accessId: grant.id,
      action: "GRANTED",
      reason: data.reason.trim(),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      meta: { hours, endsAt },
    },
  });

  return grant;
}

export async function revokeSupportAccess(
  accessId: string,
  actorUserId: string,
  meta?: { ipAddress?: string; userAgent?: string }
) {
  const grant = await prisma.platformSupportAccess.findUnique({
    where: { id: accessId },
  });
  if (!grant) throw new AppError("Support access not found", 404);

  const updated = await prisma.platformSupportAccess.update({
    where: { id: accessId },
    data: { revokedAt: new Date() },
  });

  await prisma.platformSupportAccessLog.create({
    data: {
      organizationId: grant.organizationId,
      staffUserId: actorUserId,
      accessId,
      action: "REVOKED",
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    },
  });

  return updated;
}

export async function listSupportAccess(tenantId: string) {
  return prisma.platformSupportAccess.findMany({
    where: { organizationId: tenantId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function listSupportAccessLogs(tenantId: string) {
  return prisma.platformSupportAccessLog.findMany({
    where: { organizationId: tenantId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export function moduleCatalog() {
  return [...TENANT_BUSINESS_MODULE_CODES];
}
