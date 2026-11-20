import {
  Prisma,
  WorkflowApproverMode,
  WorkflowDocumentType,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

const defInclude = {
  steps: { orderBy: { level: "asc" as const } },
};

export async function listDefinitions(tenantId: TenantId, documentType?: string) {
  const tid = requireTenantId(tenantId);
  return prisma.workflowDefinition.findMany({
    where: {
      organizationId: tid,
      ...(documentType ? { documentType: documentType as WorkflowDocumentType } : {}),
    },
    include: defInclude,
    orderBy: { updatedAt: "desc" },
  });
}

export async function getDefinition(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.workflowDefinition.findUnique({
    where: { id },
    include: defInclude,
  });
  if (!row) throw new AppError("Workflow definition not found", 404);
  assertSameTenant(row.organizationId, tid);
  return row;
}

export async function getActiveDefinition(
  tenantId: TenantId,
  documentType: WorkflowDocumentType
) {
  const tid = requireTenantId(tenantId);
  return prisma.workflowDefinition.findFirst({
    where: { organizationId: tid, documentType, isActive: true },
    include: defInclude,
    orderBy: { updatedAt: "desc" },
  });
}

export async function createDefinition(
  tenantId: TenantId,
  data: {
    documentType: WorkflowDocumentType;
    name: string;
    isActive?: boolean;
    escalationHours?: number | null;
    steps?: Array<{
      level: number;
      name: string;
      approverMode?: WorkflowApproverMode;
      roleId?: string | null;
      userId?: string | null;
      amountLimit?: number | null;
      canDelegate?: boolean;
    }>;
  }
) {
  const tid = requireTenantId(tenantId);
  if (data.isActive !== false) {
    await prisma.workflowDefinition.updateMany({
      where: { organizationId: tid, documentType: data.documentType, isActive: true },
      data: { isActive: false },
    });
  }

  return prisma.workflowDefinition.create({
    data: {
      organizationId: tid,
      documentType: data.documentType,
      name: data.name,
      isActive: data.isActive ?? true,
      escalationHours: data.escalationHours,
      steps: data.steps?.length
        ? {
            create: data.steps.map((s) => ({
              organizationId: tid,
              level: s.level,
              name: s.name,
              approverMode: s.approverMode ?? WorkflowApproverMode.USER,
              roleId: s.roleId,
              userId: s.userId,
              amountLimit:
                s.amountLimit != null ? new Prisma.Decimal(s.amountLimit) : null,
              canDelegate: s.canDelegate ?? true,
            })),
          }
        : undefined,
    },
    include: defInclude,
  });
}

export async function updateDefinition(
  tenantId: TenantId,
  id: string,
  data: {
    name?: string;
    isActive?: boolean;
    escalationHours?: number | null;
  }
) {
  const tid = requireTenantId(tenantId);
  const existing = await getDefinition(tid, id);

  if (data.isActive === true) {
    await prisma.workflowDefinition.updateMany({
      where: {
        organizationId: tid,
        documentType: existing.documentType,
        isActive: true,
        NOT: { id },
      },
      data: { isActive: false },
    });
  }

  return prisma.workflowDefinition.update({
    where: { id },
    data: {
      name: data.name,
      isActive: data.isActive,
      escalationHours: data.escalationHours,
    },
    include: defInclude,
  });
}

export async function replaceSteps(
  tenantId: TenantId,
  definitionId: string,
  steps: Array<{
    level: number;
    name: string;
    approverMode?: WorkflowApproverMode;
    roleId?: string | null;
    userId?: string | null;
    amountLimit?: number | null;
    canDelegate?: boolean;
  }>
) {
  const tid = requireTenantId(tenantId);
  await getDefinition(tid, definitionId);
  if (!steps.length) throw new AppError("At least one step is required", 400);

  return prisma.$transaction(async (tx) => {
    await tx.workflowStep.deleteMany({ where: { definitionId } });
    await tx.workflowStep.createMany({
      data: steps.map((s) => ({
        organizationId: tid,
        definitionId,
        level: s.level,
        name: s.name,
        approverMode: s.approverMode ?? WorkflowApproverMode.USER,
        roleId: s.roleId ?? null,
        userId: s.userId ?? null,
        amountLimit: s.amountLimit != null ? new Prisma.Decimal(s.amountLimit) : null,
        canDelegate: s.canDelegate ?? true,
      })),
    });
    return tx.workflowDefinition.findUniqueOrThrow({
      where: { id: definitionId },
      include: defInclude,
    });
  });
}

export async function listDelegations(tenantId: TenantId) {
  return prisma.approvalDelegation.findMany({
    where: { organizationId: requireTenantId(tenantId), isActive: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function createDelegation(
  tenantId: TenantId,
  data: {
    fromUserId: string;
    toUserId: string;
    documentType?: WorkflowDocumentType | null;
    validFrom?: string;
    validTo?: string | null;
  }
) {
  const tid = requireTenantId(tenantId);
  return prisma.approvalDelegation.create({
    data: {
      organizationId: tid,
      fromUserId: data.fromUserId,
      toUserId: data.toUserId,
      documentType: data.documentType,
      validFrom: data.validFrom ? new Date(data.validFrom) : new Date(),
      validTo: data.validTo ? new Date(data.validTo) : null,
    },
  });
}

export async function revokeDelegation(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.approvalDelegation.findUnique({ where: { id } });
  if (!row) throw new AppError("Delegation not found", 404);
  assertSameTenant(row.organizationId, tid);
  return prisma.approvalDelegation.update({
    where: { id },
    data: { isActive: false },
  });
}
