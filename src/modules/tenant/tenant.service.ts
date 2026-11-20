import { MemberStatus, SubscriptionStatus, type LocaleCode } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/AppError.js";
import {
  TENANT_BUSINESS_MODULE_CODES,
  type TenantContext,
  type TenantId,
} from "../../types/tenant.js";

const BLOCKED_SUBSCRIPTION = new Set<SubscriptionStatus>([
  SubscriptionStatus.SUSPENDED,
  SubscriptionStatus.CANCELLED,
]);

export async function listMembershipsForUser(userId: string) {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId, status: MemberStatus.ACTIVE },
    include: {
      organization: true,
      memberRoles: { include: { role: true } },
    },
    orderBy: { joinedAt: "asc" },
  });

  return memberships
    .filter((m) => m.organization.isActive)
    .map((m) => ({
      tenantId: m.organizationId,
      organizationId: m.organizationId,
      code: m.organization.code,
      name: m.organization.name,
      defaultLocale: m.organization.defaultLocale,
      roles: m.memberRoles.map((mr) => mr.role.name),
    }));
}

export async function userHasTenantAccess(
  userId: string,
  tenantId: TenantId,
  isSuperAdmin: boolean
): Promise<boolean> {
  if (isSuperAdmin) {
    const org = await prisma.organization.findFirst({
      where: { id: tenantId, isActive: true },
      select: { id: true },
    });
    return Boolean(org);
  }

  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId: tenantId, userId },
    },
    include: { organization: true },
  });

  return Boolean(
    membership &&
      membership.status === MemberStatus.ACTIVE &&
      membership.organization.isActive
  );
}

export async function buildTenantContext(
  userId: string,
  tenantId: TenantId,
  isSuperAdmin: boolean
): Promise<TenantContext> {
  const allowed = await userHasTenantAccess(userId, tenantId, isSuperAdmin);
  if (!allowed) {
    throw new AppError("Tenant access denied", 403);
  }

  const organization = await prisma.organization.findUnique({
    where: { id: tenantId },
  });
  if (!organization || !organization.isActive) {
    throw new AppError("Tenant not found", 404);
  }

  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId: tenantId, userId },
    },
    include: {
      memberRoles: {
        include: {
          role: {
            include: {
              rolePermissions: { include: { permission: true } },
            },
          },
        },
      },
    },
  });

  const roles: string[] = [];
  const permissionCodes = new Set<string>();

  if (membership) {
    if (membership.status !== MemberStatus.ACTIVE && !isSuperAdmin) {
      throw new AppError("Membership is not active for this tenant", 403);
    }
    for (const mr of membership.memberRoles) {
      roles.push(mr.role.name);
      for (const rp of mr.role.rolePermissions) {
        permissionCodes.add(rp.permission.code);
      }
    }
  } else if (isSuperAdmin) {
    roles.push("PlatformSuperAdmin");
  }

  const [subscription, entitlements, modules] = await Promise.all([
    prisma.tenantSubscription.findFirst({
      where: { organizationId: tenantId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.tenantEntitlement.findMany({ where: { organizationId: tenantId } }),
    prisma.tenantModule.findMany({ where: { organizationId: tenantId } }),
  ]);

  if (
    !isSuperAdmin &&
    subscription &&
    BLOCKED_SUBSCRIPTION.has(subscription.status)
  ) {
    throw new AppError("Tenant subscription is not active", 403);
  }

  return {
    tenantId: organization.id,
    code: organization.code,
    name: organization.name,
    defaultLocale: organization.defaultLocale,
    timezone: organization.timezone,
    baseCurrency: organization.baseCurrency,
    isActive: organization.isActive,
    membership: {
      memberId: membership?.id ?? "platform-bypass",
      status: membership?.status ?? MemberStatus.ACTIVE,
      jobTitle: membership?.jobTitle ?? null,
      roles,
      permissionCodes: [...permissionCodes],
    },
    subscription: subscription
      ? {
          planCode: subscription.planCode,
          status: subscription.status,
          seats: subscription.seats,
        }
      : null,
    entitlements: entitlements.map((e) => ({
      code: e.code,
      enabled: e.enabled,
      limits: e.limits,
    })),
    modules: modules.map((m) => ({
      moduleCode: m.moduleCode,
      enabled: m.enabled,
      config: m.config,
    })),
  };
}

export async function resolveActiveTenantId(options: {
  userId: string;
  isSuperAdmin: boolean;
  requestedTenantId?: string | null;
}): Promise<TenantId> {
  const memberships = await listMembershipsForUser(options.userId);

  if (options.requestedTenantId) {
    const ok = await userHasTenantAccess(
      options.userId,
      options.requestedTenantId,
      options.isSuperAdmin
    );
    if (!ok) {
      throw new AppError("Tenant access denied", 403);
    }
    return options.requestedTenantId;
  }

  if (memberships[0]) {
    return memberships[0].tenantId;
  }

  if (options.isSuperAdmin) {
    const first = await prisma.organization.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    });
    if (first) return first.id;
  }

  throw new AppError("No tenant available for this user", 403);
}

export async function recordTenantActivity(input: {
  tenantId: TenantId;
  userId?: string;
  action: string;
  entity?: string;
  entityId?: string;
  meta?: unknown;
  ipAddress?: string;
  userAgent?: string;
}) {
  return prisma.tenantActivity.create({
    data: {
      organizationId: input.tenantId,
      userId: input.userId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      meta: input.meta as object | undefined,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
  });
}

export async function updateTenantConfig(
  tenantId: TenantId,
  data: { defaultLocale?: LocaleCode; timezone?: string; name?: string }
) {
  return prisma.organization.update({
    where: { id: tenantId },
    data,
  });
}

export async function ensureDefaultTenantSaaS(tenantId: TenantId) {
  const existingSub = await prisma.tenantSubscription.findFirst({
    where: { organizationId: tenantId },
  });
  if (!existingSub) {
    await prisma.tenantSubscription.create({
      data: {
        organizationId: tenantId,
        planCode: "standard",
        status: "ACTIVE",
        seats: 25,
      },
    });
  }

  const entitlementCodes = ["users.max", "storage.uploads", "modules.core"];
  for (const code of entitlementCodes) {
    await prisma.tenantEntitlement.upsert({
      where: { organizationId_code: { organizationId: tenantId, code } },
      update: { enabled: true },
      create: {
        organizationId: tenantId,
        code,
        enabled: true,
        limits: code === "users.max" ? { max: 25 } : undefined,
      },
    });
  }

  for (const moduleCode of TENANT_BUSINESS_MODULE_CODES) {
    await prisma.tenantModule.upsert({
      where: {
        organizationId_moduleCode: { organizationId: tenantId, moduleCode },
      },
      update: {},
      create: {
        organizationId: tenantId,
        moduleCode,
        enabled: true,
        config: {},
      },
    });
  }

  await prisma.organizationSetting.upsert({
    where: {
      organizationId_key: {
        organizationId: tenantId,
        key: "inventory.warehouseMode",
      },
    },
    update: { value: "single" },
    create: {
      organizationId: tenantId,
      key: "inventory.warehouseMode",
      value: "single",
      type: "string",
    },
  });

  await prisma.organizationSetting.upsert({
    where: {
      organizationId_key: {
        organizationId: tenantId,
        key: "i18n.supportedLocales",
      },
    },
    update: { value: "en,ar" },
    create: {
      organizationId: tenantId,
      key: "i18n.supportedLocales",
      value: "en,ar",
      type: "string",
    },
  });

  const { ensureSystemConfig, ensureDefaultWarehouse } = await import(
    "../company/company.service.js"
  );
  await ensureSystemConfig(tenantId);
  await ensureDefaultWarehouse(tenantId);

  const { ensureDefaultUnits, ensureDefaultCurrency } = await import(
    "../masterData/lookups.service.js"
  );
  await ensureDefaultUnits(tenantId);
  await ensureDefaultCurrency(tenantId);
}

/** Platform Central Control — list tenants (organizations) */
export async function listTenantsForPlatform() {
  return prisma.organization.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      defaultLocale: true,
      timezone: true,
      baseCurrency: true,
      isActive: true,
      createdAt: true,
      _count: { select: { members: true, modules: true } },
    },
  });
}
