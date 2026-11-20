import { GlAccountStatus, GlAccountType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { seedAccountingDefaults } from "./seedDefaults.js";

export async function seedDefaults(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  // Seed outside interactive transaction — many sequential writes; Neon pool-friendly.
  return seedAccountingDefaults(prisma, tid);
}

export async function listAccounts(tenantId: TenantId, opts?: { status?: string; type?: string }) {
  const tid = requireTenantId(tenantId);
  return prisma.glAccount.findMany({
    where: {
      organizationId: tid,
      ...(opts?.status ? { status: opts.status as GlAccountStatus } : {}),
      ...(opts?.type ? { type: opts.type as GlAccountType } : {}),
    },
    orderBy: { code: "asc" },
  });
}

export async function createAccount(
  tenantId: TenantId,
  data: {
    code: string;
    name: string;
    nameAr?: string | null;
    type: GlAccountType;
    parentId?: string | null;
    isPostable?: boolean;
    systemRole?: string | null;
  }
) {
  const tid = requireTenantId(tenantId);
  if (data.parentId) {
    const parent = await prisma.glAccount.findUnique({ where: { id: data.parentId } });
    if (!parent) throw new AppError("Parent account not found", 404);
    assertSameTenant(parent.organizationId, tid);
  }
  try {
    return await prisma.glAccount.create({
      data: {
        organizationId: tid,
        code: data.code,
        name: data.name,
        nameAr: data.nameAr,
        type: data.type,
        parentId: data.parentId,
        isPostable: data.isPostable !== false,
        systemRole: data.systemRole,
        isSystem: false,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError("Duplicate account code", 409);
    }
    throw e;
  }
}

export async function updateAccount(
  tenantId: TenantId,
  id: string,
  data: Partial<{
    name: string;
    nameAr: string | null;
    parentId: string | null;
    isPostable: boolean;
    status: GlAccountStatus;
    systemRole: string | null;
  }>
) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.glAccount.findUnique({ where: { id } });
  if (!row) throw new AppError("Account not found", 404);
  assertSameTenant(row.organizationId, tid);
  if (row.isSystem && data.status === GlAccountStatus.INACTIVE) {
    // allow deactivate system accounts carefully
  }
  return prisma.glAccount.update({
    where: { id },
    data: {
      name: data.name,
      nameAr: data.nameAr,
      parentId: data.parentId,
      isPostable: data.isPostable,
      status: data.status,
      systemRole: data.systemRole,
    },
  });
}

export async function getAccount(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.glAccount.findUnique({ where: { id } });
  if (!row) throw new AppError("Account not found", 404);
  assertSameTenant(row.organizationId, tid);
  return row;
}
