import { AccountingEventType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

export async function listPostingRules(tenantId: TenantId) {
  return prisma.accountingPostingRule.findMany({
    where: { organizationId: requireTenantId(tenantId) },
    include: {
      debitAccount: true,
      creditAccount: true,
      debitSecondary: true,
      creditSecondary: true,
    },
    orderBy: { eventType: "asc" },
  });
}

export async function updatePostingRule(
  tenantId: TenantId,
  eventType: AccountingEventType,
  data: {
    autoPost?: boolean;
    isActive?: boolean;
    debitAccountId?: string | null;
    creditAccountId?: string | null;
    debitSecondaryId?: string | null;
    creditSecondaryId?: string | null;
    description?: string | null;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  if (eventType === AccountingEventType.MANUAL) {
    throw new AppError("MANUAL event type has no posting rule", 400);
  }

  const existing = await prisma.accountingPostingRule.findUnique({
    where: { organizationId_eventType: { organizationId: tid, eventType } },
  });

  const debitId = data.debitAccountId !== undefined ? data.debitAccountId : existing?.debitAccountId;
  const creditId =
    data.creditAccountId !== undefined ? data.creditAccountId : existing?.creditAccountId;
  if (!debitId || !creditId) {
    throw new AppError("debitAccountId and creditAccountId are required", 400);
  }

  // Validate accounts belong to tenant
  for (const id of [debitId, creditId, data.debitSecondaryId, data.creditSecondaryId]) {
    if (!id) continue;
    const acc = await prisma.glAccount.findFirst({ where: { id, organizationId: tid } });
    if (!acc) throw new AppError(`GL account not found: ${id}`, 404);
  }

  return prisma.accountingPostingRule.upsert({
    where: { organizationId_eventType: { organizationId: tid, eventType } },
    create: {
      organizationId: tid,
      eventType,
      autoPost: data.autoPost ?? false,
      isActive: data.isActive ?? true,
      isSystemDefault: false,
      debitAccountId: debitId,
      creditAccountId: creditId,
      debitSecondaryId: data.debitSecondaryId ?? null,
      creditSecondaryId: data.creditSecondaryId ?? null,
      description: data.description,
      updatedByUserId: userId,
    },
    update: {
      ...(data.autoPost !== undefined ? { autoPost: data.autoPost } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.debitAccountId !== undefined ? { debitAccountId: data.debitAccountId } : {}),
      ...(data.creditAccountId !== undefined ? { creditAccountId: data.creditAccountId } : {}),
      ...(data.debitSecondaryId !== undefined ? { debitSecondaryId: data.debitSecondaryId } : {}),
      ...(data.creditSecondaryId !== undefined
        ? { creditSecondaryId: data.creditSecondaryId }
        : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      updatedByUserId: userId,
    },
    include: {
      debitAccount: true,
      creditAccount: true,
      debitSecondary: true,
      creditSecondary: true,
    },
  });
}
