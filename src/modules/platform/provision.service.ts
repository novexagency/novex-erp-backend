import {
  BranchType,
  MemberStatus,
  Prisma,
  SubscriptionStatus,
} from "@prisma/client";
import { hashPassword } from "../../lib/password.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { TENANT_BUSINESS_MODULE_CODES } from "../../types/tenant.js";
import { ensureDefaultTenantSaaS } from "../tenant/tenant.service.js";

export type ProvisionTenantInput = {
  name: string;
  code: string;
  baseCurrency?: string;
  defaultLocale?: "en" | "ar";
  timezone?: string;
  taxNumber?: string | null;
  planCode?: string;
  subscriptionStatus?: SubscriptionStatus;
  seats?: number;
  trialDays?: number;
  modules?: Array<{ moduleCode: string; enabled: boolean }>;
  entitlements?: Array<{ code: string; enabled?: boolean; limits?: unknown }>;
  admin?: {
    email: string;
    password: string;
    name: string;
  };
  seedAccountingDefaults?: boolean;
  externalRef?: string | null;
};

function slugCode(raw: string) {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export async function provisionTenant(input: ProvisionTenantInput) {
  const code = slugCode(input.code);
  if (!code) throw new AppError("Invalid tenant code", 400);

  const existing = await prisma.organization.findUnique({ where: { code } });
  if (existing) throw new AppError(`Tenant code already exists: ${code}`, 409);

  if (input.admin) {
    const taken = await prisma.user.findUnique({
      where: { email: input.admin.email.toLowerCase() },
    });
    if (taken) throw new AppError("Admin email already registered", 409);
  }

  const trialDays = input.trialDays ?? 14;
  const status = input.subscriptionStatus ?? SubscriptionStatus.TRIAL;
  const trialEndsAt =
    status === SubscriptionStatus.TRIAL
      ? new Date(Date.now() + trialDays * 86400000)
      : null;

  const org = await prisma.organization.create({
    data: {
      name: input.name.trim(),
      code,
      baseCurrency: input.baseCurrency ?? "EGP",
      defaultLocale: input.defaultLocale ?? "en",
      timezone: input.timezone ?? "Africa/Cairo",
      taxNumber: input.taxNumber,
      isActive: true,
    },
  });

  await prisma.branch.create({
    data: {
      organizationId: org.id,
      name: "Main Headquarters",
      code: "HQ-01",
      type: BranchType.HEADQUARTERS,
      country: "Egypt",
      isActive: true,
    },
  });

  // SaaS scaffold (warehouse, units, currency, settings, default modules)
  await ensureDefaultTenantSaaS(org.id);

  // Override subscription with provision values
  const sub = await prisma.tenantSubscription.findFirst({
    where: { organizationId: org.id },
  });
  if (sub) {
    await prisma.tenantSubscription.update({
      where: { id: sub.id },
      data: {
        planCode: input.planCode ?? "standard",
        status,
        seats: input.seats ?? 10,
        trialEndsAt,
        endsAt: trialEndsAt,
      },
    });
  }

  // Apply module overrides
  if (input.modules?.length) {
    for (const m of input.modules) {
      await prisma.tenantModule.upsert({
        where: {
          organizationId_moduleCode: {
            organizationId: org.id,
            moduleCode: m.moduleCode,
          },
        },
        update: { enabled: m.enabled },
        create: {
          organizationId: org.id,
          moduleCode: m.moduleCode,
          enabled: m.enabled,
        },
      });
    }
  } else {
    // Ensure full catalog exists (ensureDefaultTenantSaaS already upserts known codes)
    for (const moduleCode of TENANT_BUSINESS_MODULE_CODES) {
      await prisma.tenantModule.upsert({
        where: {
          organizationId_moduleCode: { organizationId: org.id, moduleCode },
        },
        update: {},
        create: { organizationId: org.id, moduleCode, enabled: true },
      });
    }
  }

  if (input.entitlements?.length) {
    for (const e of input.entitlements) {
      await prisma.tenantEntitlement.upsert({
        where: {
          organizationId_code: { organizationId: org.id, code: e.code },
        },
        update: {
          enabled: e.enabled ?? true,
          limits: e.limits === undefined ? undefined : (e.limits as Prisma.InputJsonValue),
        },
        create: {
          organizationId: org.id,
          code: e.code,
          enabled: e.enabled ?? true,
          limits: (e.limits as Prisma.InputJsonValue) ?? undefined,
        },
      });
    }
  }

  // System roles with full permission catalog
  const allPermissions = await prisma.permission.findMany();
  const ownerRole = await prisma.role.create({
    data: {
      organizationId: org.id,
      name: "Owner",
      description: "Tenant Owner",
      isSystem: true,
    },
  });
  const adminRole = await prisma.role.create({
    data: {
      organizationId: org.id,
      name: "Administrator",
      description: "Tenant Administrator",
      isSystem: true,
    },
  });
  await prisma.rolePermission.createMany({
    data: allPermissions.flatMap((p) => [
      { roleId: ownerRole.id, permissionId: p.id },
      { roleId: adminRole.id, permissionId: p.id },
    ]),
    skipDuplicates: true,
  });

  let adminUserId: string | null = null;
  let adminEmail: string | null = null;
  if (input.admin) {
    const passwordHash = await hashPassword(input.admin.password);
    const user = await prisma.user.create({
      data: {
        email: input.admin.email.toLowerCase(),
        name: input.admin.name,
        passwordHash,
        isActive: true,
        isSuperAdmin: false,
      },
    });
    adminUserId = user.id;
    adminEmail = user.email;

    const branch = await prisma.branch.findFirst({
      where: { organizationId: org.id, code: "HQ-01" },
    });
    const member = await prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        jobTitle: "Owner",
        status: MemberStatus.ACTIVE,
      },
    });
    await prisma.memberRole.create({
      data: {
        memberId: member.id,
        roleId: ownerRole.id,
        branchId: branch?.id ?? null,
      },
    });
  }

  if (input.seedAccountingDefaults) {
    try {
      const { seedDefaults } = await import("../accounting/coa.service.js");
      await seedDefaults(org.id);
    } catch {
      // Optional — do not fail provision if accounting seed unavailable
    }
  }

  if (input.externalRef) {
    await prisma.organizationSetting.upsert({
      where: {
        organizationId_key: {
          organizationId: org.id,
          key: "platform.externalRef",
        },
      },
      update: { value: input.externalRef },
      create: {
        organizationId: org.id,
        key: "platform.externalRef",
        value: input.externalRef,
        type: "string",
      },
    });
  }

  await prisma.tenantActivity.create({
    data: {
      organizationId: org.id,
      action: "TENANT_PROVISIONED",
      entity: "Organization",
      entityId: org.id,
      meta: { code, planCode: input.planCode ?? "standard", status },
    },
  });

  return getTenantDetail(org.id, { adminUserId, adminEmail });
}

export async function getTenantDetail(
  tenantId: string,
  extra?: { adminUserId?: string | null; adminEmail?: string | null }
) {
  const org = await prisma.organization.findUnique({
    where: { id: tenantId },
    include: {
      subscriptions: { orderBy: { createdAt: "desc" }, take: 1 },
      modules: { orderBy: { moduleCode: "asc" } },
      entitlements: { orderBy: { code: "asc" } },
      _count: { select: { members: true } },
    },
  });
  if (!org) throw new AppError("Tenant not found", 404);

  const lastActivity = await prisma.tenantActivity.findFirst({
    where: { organizationId: tenantId },
    orderBy: { createdAt: "desc" },
  });
  const lastLogin = await prisma.auditLog.findFirst({
    where: { organizationId: tenantId, action: "LOGIN" },
    orderBy: { createdAt: "desc" },
  });

  return {
    id: org.id,
    name: org.name,
    code: org.code,
    isActive: org.isActive,
    defaultLocale: org.defaultLocale,
    timezone: org.timezone,
    baseCurrency: org.baseCurrency,
    createdAt: org.createdAt,
    memberCount: org._count.members,
    subscription: org.subscriptions[0]
      ? {
          planCode: org.subscriptions[0].planCode,
          status: org.subscriptions[0].status,
          seats: org.subscriptions[0].seats,
          startsAt: org.subscriptions[0].startsAt,
          endsAt: org.subscriptions[0].endsAt,
          trialEndsAt: org.subscriptions[0].trialEndsAt,
          gracePeriodEndsAt: org.subscriptions[0].gracePeriodEndsAt,
          renewedAt: org.subscriptions[0].renewedAt,
        }
      : null,
    modules: org.modules.map((m) => ({
      moduleCode: m.moduleCode,
      enabled: m.enabled,
    })),
    entitlements: org.entitlements.map((e) => ({
      code: e.code,
      enabled: e.enabled,
      limits: e.limits,
    })),
    lastActivityAt: lastActivity?.createdAt ?? null,
    lastLoginAt: lastLogin?.createdAt ?? null,
    adminUserId: extra?.adminUserId ?? null,
    adminEmail: extra?.adminEmail ?? null,
  };
}
