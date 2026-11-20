import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { requireTenantId } from "../../lib/tenantDb.js";

type Limits = { max?: number; [k: string]: unknown };

function asLimits(v: unknown): Limits {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Limits;
  return {};
}

export async function getEntitlement(tenantId: TenantId, code: string) {
  const tid = requireTenantId(tenantId);
  return prisma.tenantEntitlement.findUnique({
    where: { organizationId_code: { organizationId: tid, code } },
  });
}

export async function assertWithinUserSeatLimit(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const [sub, ent, memberCount] = await Promise.all([
    prisma.tenantSubscription.findFirst({
      where: { organizationId: tid },
      orderBy: { createdAt: "desc" },
    }),
    getEntitlement(tid, "users.max"),
    prisma.organizationMember.count({
      where: { organizationId: tid, status: { in: ["ACTIVE", "INVITED"] } },
    }),
  ]);

  const seatLimit = sub?.seats ?? asLimits(ent?.limits).max ?? null;
  const entitlementMax = asLimits(ent?.limits).max;
  const max = entitlementMax ?? seatLimit;
  if (max != null && memberCount >= max) {
    throw new AppError(`User seat limit reached (${max})`, 403);
  }
}

export async function assertModuleEnabled(tenantId: TenantId, moduleCode: string) {
  const tid = requireTenantId(tenantId);
  const mod = await prisma.tenantModule.findUnique({
    where: {
      organizationId_moduleCode: { organizationId: tid, moduleCode },
    },
  });
  if (mod && !mod.enabled) {
    throw new AppError(`Module ${moduleCode} is disabled for this tenant`, 403);
  }
}

export async function usageMetrics(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const [
    members,
    activeMembers,
    products,
    customers,
    invoices,
    documents,
    repoDocs,
    uploadsSetting,
  ] = await Promise.all([
    prisma.organizationMember.count({ where: { organizationId: tid } }),
    prisma.organizationMember.count({
      where: { organizationId: tid, status: "ACTIVE" },
    }),
    prisma.product.count({ where: { organizationId: tid } }),
    prisma.customer.count({ where: { organizationId: tid } }),
    prisma.salesInvoice.count({ where: { organizationId: tid } }),
    prisma.employeeDocument.count({ where: { organizationId: tid } }),
    prisma.repoDocument.count({
      where: { organizationId: tid, archivedAt: null },
    }),
    getEntitlement(tid, "storage.uploads"),
  ]);

  const sub = await prisma.tenantSubscription.findFirst({
    where: { organizationId: tid },
    orderBy: { createdAt: "desc" },
  });
  const usersMax = await getEntitlement(tid, "users.max");
  const docsMax = await getEntitlement(tid, "documents.max");

  return {
    users: {
      total: members,
      active: activeMembers,
      limit: asLimits(usersMax?.limits).max ?? sub?.seats ?? null,
    },
    storage: {
      /** Placeholder metric — Cloudinary bytes not aggregated yet; limit from entitlement. */
      usedDocuments: documents + repoDocs,
      limit: asLimits(uploadsSetting?.limits).max ?? null,
    },
    documents: {
      employeeDocs: documents,
      repositoryDocs: repoDocs,
      limit: asLimits(docsMax?.limits).max ?? null,
    },
    catalog: { products, customers, salesInvoices: invoices },
  };
}
