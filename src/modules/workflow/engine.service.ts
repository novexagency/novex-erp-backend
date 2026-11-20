import {
  ApprovalActionType,
  ApprovalInstanceStatus,
  NotificationType,
  Prisma,
  WorkflowApproverMode,
  WorkflowDocumentType,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { getActiveDefinition } from "./definitions.service.js";
import { notifyUsers } from "./notifications.service.js";
import { applyDomainDecision } from "./adapters/domainCallbacks.js";

const instanceInclude = {
  actions: { orderBy: { at: "asc" as const } },
  definition: { include: { steps: { orderBy: { level: "asc" as const } } } },
};

function asUserIds(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json.filter((x): x is string => typeof x === "string");
}

async function resolveAssigneesForStep(
  tid: string,
  step: {
    approverMode: WorkflowApproverMode;
    roleId: string | null;
    userId: string | null;
  },
  submittedByUserId?: string | null
): Promise<string[]> {
  if (step.approverMode === WorkflowApproverMode.USER && step.userId) {
    return [step.userId];
  }

  if (step.approverMode === WorkflowApproverMode.ROLE && step.roleId) {
    const members = await prisma.memberRole.findMany({
      where: { roleId: step.roleId, member: { organizationId: tid, status: "ACTIVE" } },
      include: { member: { select: { userId: true } } },
    });
    return [...new Set(members.map((m) => m.member.userId))];
  }

  if (step.approverMode === WorkflowApproverMode.MANAGER && submittedByUserId) {
    const emp = await prisma.employee.findFirst({
      where: { organizationId: tid, userId: submittedByUserId },
      select: { managerEmployeeId: true },
    });
    if (emp?.managerEmployeeId) {
      const mgr = await prisma.employee.findFirst({
        where: { id: emp.managerEmployeeId, organizationId: tid },
        select: { userId: true },
      });
      if (mgr?.userId) return [mgr.userId];
    }
  }

  // Fallback: active members with Owner/Admin-ish roles via any membership
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: tid, status: "ACTIVE" },
    select: { userId: true },
    take: 20,
  });
  return members.map((m) => m.userId);
}

function stepApplies(
  step: { amountLimit: Prisma.Decimal | null },
  amount: number | null | undefined
): boolean {
  if (step.amountLimit == null) return true;
  const limit = Number(step.amountLimit);
  const amt = amount ?? 0;
  // Step is required only when amount exceeds the limit
  return amt > limit;
}

async function pickEffectiveLevel(
  steps: Array<{ level: number; amountLimit: Prisma.Decimal | null }>,
  amount: number | null | undefined,
  fromLevel: number
): Promise<{ level: number; skipped: number[] } | null> {
  const ordered = [...steps].sort((a, b) => a.level - b.level);
  const skipped: number[] = [];
  for (const s of ordered) {
    if (s.level < fromLevel) continue;
    if (!stepApplies(s, amount)) {
      skipped.push(s.level);
      continue;
    }
    return { level: s.level, skipped };
  }
  return null;
}

export async function isWorkflowActive(
  tenantId: TenantId,
  documentType: WorkflowDocumentType
) {
  const def = await getActiveDefinition(tenantId, documentType);
  return Boolean(def && def.steps.length > 0);
}

export async function findOpenInstance(
  tenantId: TenantId,
  documentType: WorkflowDocumentType,
  documentId: string
) {
  const tid = requireTenantId(tenantId);
  return prisma.approvalInstance.findFirst({
    where: {
      organizationId: tid,
      documentType,
      documentId,
      status: { in: [ApprovalInstanceStatus.PENDING, ApprovalInstanceStatus.ESCALATED] },
    },
    include: instanceInclude,
  });
}

/** Block direct domain approve when a workflow instance is open. */
export async function assertDirectApproveAllowed(
  tenantId: TenantId,
  documentType: WorkflowDocumentType,
  documentId: string,
  opts?: { fromWorkflow?: boolean }
) {
  if (opts?.fromWorkflow) return;
  const open = await findOpenInstance(tenantId, documentType, documentId);
  if (open) {
    throw new AppError("Document is pending workflow approval", 409);
  }
  if (await isWorkflowActive(tenantId, documentType)) {
    throw new AppError("Use workflow approval for this document type", 409);
  }
}

/**
 * Start approval if an active definition exists.
 * Returns the instance when started, or null when no workflow (caller proceeds normally).
 */
export async function startApprovalIfConfigured(
  tenantId: TenantId,
  data: {
    documentType: WorkflowDocumentType;
    documentId: string;
    amount?: number | null;
    submittedByUserId?: string | null;
  }
) {
  const tid = requireTenantId(tenantId);
  const def = await getActiveDefinition(tid, data.documentType);
  if (!def || def.steps.length === 0) return null;

  const existing = await findOpenInstance(tid, data.documentType, data.documentId);
  if (existing) return existing;

  const picked = await pickEffectiveLevel(def.steps, data.amount, 1);
  if (!picked) {
    // All steps skipped by amount limits → auto-approve via domain
    await applyDomainDecision(data.documentType, "APPROVED", tid, data.documentId, data.submittedByUserId);
    return null;
  }

  const step = def.steps.find((s) => s.level === picked.level)!;
  const assignees = await resolveAssigneesForStep(tid, step, data.submittedByUserId);
  if (!assignees.length) {
    throw new AppError("No approvers resolved for workflow step", 400);
  }

  const escalationDueAt =
    def.escalationHours != null
      ? new Date(Date.now() + def.escalationHours * 3600_000)
      : null;

  const instance = await prisma.$transaction(async (tx) => {
    const inst = await tx.approvalInstance.create({
      data: {
        organizationId: tid,
        definitionId: def.id,
        documentType: data.documentType,
        documentId: data.documentId,
        amount: data.amount != null ? new Prisma.Decimal(data.amount) : null,
        status: ApprovalInstanceStatus.PENDING,
        currentLevel: picked.level,
        currentAssigneeIds: assignees,
        submittedByUserId: data.submittedByUserId,
        escalationDueAt,
      },
    });

    await tx.approvalAction.create({
      data: {
        organizationId: tid,
        instanceId: inst.id,
        level: 0,
        action: ApprovalActionType.STARTED,
        actorUserId: data.submittedByUserId,
        comment: `Started at level ${picked.level}`,
      },
    });

    for (const lvl of picked.skipped) {
      await tx.approvalAction.create({
        data: {
          organizationId: tid,
          instanceId: inst.id,
          level: lvl,
          action: ApprovalActionType.LEVEL_SKIPPED,
          actorUserId: data.submittedByUserId,
          comment: "Skipped by amount limit",
        },
      });
    }

    return tx.approvalInstance.findUniqueOrThrow({
      where: { id: inst.id },
      include: instanceInclude,
    });
  });

  await notifyUsers(tid, assignees, {
    type: NotificationType.APPROVAL_REQUEST,
    title: `Approval required: ${data.documentType}`,
    body: `Document ${data.documentId} awaits level ${picked.level}`,
    entityType: data.documentType,
    entityId: instance.id,
  });

  return instance;
}

async function assertActorCanAct(
  tid: string,
  instance: { currentAssigneeIds: unknown; documentType: WorkflowDocumentType },
  actorUserId: string
) {
  const assignees = asUserIds(instance.currentAssigneeIds);
  if (assignees.includes(actorUserId)) return "assignee" as const;

  const now = new Date();
  const delegation = await prisma.approvalDelegation.findFirst({
    where: {
      organizationId: tid,
      fromUserId: { in: assignees },
      toUserId: actorUserId,
      isActive: true,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
      AND: [
        {
          OR: [{ documentType: null }, { documentType: instance.documentType }],
        },
      ],
    },
  });
  if (delegation) return "delegate" as const;

  throw new AppError("Not an assigned approver for this step", 403);
}

export async function getApproval(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.approvalInstance.findUnique({
    where: { id },
    include: instanceInclude,
  });
  if (!row) throw new AppError("Approval instance not found", 404);
  assertSameTenant(row.organizationId, tid);
  return row;
}

export async function listApprovals(
  tenantId: TenantId,
  opts?: { documentType?: string; documentId?: string; status?: string }
) {
  const tid = requireTenantId(tenantId);
  return prisma.approvalInstance.findMany({
    where: {
      organizationId: tid,
      ...(opts?.documentType
        ? { documentType: opts.documentType as WorkflowDocumentType }
        : {}),
      ...(opts?.documentId ? { documentId: opts.documentId } : {}),
      ...(opts?.status ? { status: opts.status as ApprovalInstanceStatus } : {}),
    },
    include: instanceInclude,
    orderBy: { submittedAt: "desc" },
    take: 100,
  });
}

export async function inbox(tenantId: TenantId, userId: string) {
  const tid = requireTenantId(tenantId);
  await refreshEscalations(tid);

  const now = new Date();
  const delegations = await prisma.approvalDelegation.findMany({
    where: {
      organizationId: tid,
      toUserId: userId,
      isActive: true,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
    },
  });
  const fromUsers = delegations.map((d) => d.fromUserId);

  const open = await prisma.approvalInstance.findMany({
    where: {
      organizationId: tid,
      status: { in: [ApprovalInstanceStatus.PENDING, ApprovalInstanceStatus.ESCALATED] },
    },
    include: instanceInclude,
    orderBy: { submittedAt: "asc" },
  });

  return open.filter((inst) => {
    const assignees = asUserIds(inst.currentAssigneeIds);
    if (assignees.includes(userId)) return true;
    if (assignees.some((a) => fromUsers.includes(a))) {
      const ok = delegations.some(
        (d) =>
          assignees.includes(d.fromUserId) &&
          (d.documentType == null || d.documentType === inst.documentType)
      );
      return ok;
    }
    return false;
  });
}

export async function approveInstance(
  tenantId: TenantId,
  id: string,
  actorUserId: string,
  comment?: string | null
) {
  const tid = requireTenantId(tenantId);
  const instance = await getApproval(tid, id);
  if (
    instance.status !== ApprovalInstanceStatus.PENDING &&
    instance.status !== ApprovalInstanceStatus.ESCALATED
  ) {
    throw new AppError("Approval is not open", 400);
  }
  await assertActorCanAct(tid, instance, actorUserId);

  const steps = instance.definition.steps;
  const amount = instance.amount != null ? Number(instance.amount) : null;
  const next = await pickEffectiveLevel(steps, amount, instance.currentLevel + 1);

  if (!next) {
    const completed = await prisma.$transaction(async (tx) => {
      await tx.approvalAction.create({
        data: {
          organizationId: tid,
          instanceId: id,
          level: instance.currentLevel,
          action: ApprovalActionType.APPROVED,
          actorUserId,
          comment,
        },
      });
      return tx.approvalInstance.update({
        where: { id },
        data: {
          status: ApprovalInstanceStatus.APPROVED,
          completedAt: new Date(),
          currentAssigneeIds: [],
        },
        include: instanceInclude,
      });
    });

    await applyDomainDecision(
      instance.documentType,
      "APPROVED",
      tid,
      instance.documentId,
      actorUserId
    );

    if (instance.submittedByUserId) {
      await notifyUsers(tid, [instance.submittedByUserId], {
        type: NotificationType.APPROVAL_APPROVED,
        title: `Approved: ${instance.documentType}`,
        body: comment ?? undefined,
        entityType: instance.documentType,
        entityId: instance.documentId,
      });
    }
    return completed;
  }

  const nextStep = steps.find((s) => s.level === next.level)!;
  const assignees = await resolveAssigneesForStep(
    tid,
    nextStep,
    instance.submittedByUserId
  );

  const updated = await prisma.$transaction(async (tx) => {
    await tx.approvalAction.create({
      data: {
        organizationId: tid,
        instanceId: id,
        level: instance.currentLevel,
        action: ApprovalActionType.APPROVED,
        actorUserId,
        comment,
      },
    });
    for (const lvl of next.skipped) {
      await tx.approvalAction.create({
        data: {
          organizationId: tid,
          instanceId: id,
          level: lvl,
          action: ApprovalActionType.LEVEL_SKIPPED,
          actorUserId,
          comment: "Skipped by amount limit",
        },
      });
    }
    return tx.approvalInstance.update({
      where: { id },
      data: {
        status: ApprovalInstanceStatus.PENDING,
        currentLevel: next.level,
        currentAssigneeIds: assignees,
      },
      include: instanceInclude,
    });
  });

  await notifyUsers(tid, assignees, {
    type: NotificationType.APPROVAL_REQUEST,
    title: `Approval required (L${next.level}): ${instance.documentType}`,
    body: `Document ${instance.documentId}`,
    entityType: instance.documentType,
    entityId: id,
  });

  return updated;
}

export async function rejectInstance(
  tenantId: TenantId,
  id: string,
  actorUserId: string,
  rejectionReason: string
) {
  const tid = requireTenantId(tenantId);
  if (!rejectionReason?.trim()) throw new AppError("Rejection reason is required", 400);
  const instance = await getApproval(tid, id);
  if (
    instance.status !== ApprovalInstanceStatus.PENDING &&
    instance.status !== ApprovalInstanceStatus.ESCALATED
  ) {
    throw new AppError("Approval is not open", 400);
  }
  await assertActorCanAct(tid, instance, actorUserId);

  const completed = await prisma.$transaction(async (tx) => {
    await tx.approvalAction.create({
      data: {
        organizationId: tid,
        instanceId: id,
        level: instance.currentLevel,
        action: ApprovalActionType.REJECTED,
        actorUserId,
        rejectionReason,
      },
    });
    return tx.approvalInstance.update({
      where: { id },
      data: {
        status: ApprovalInstanceStatus.REJECTED,
        completedAt: new Date(),
        currentAssigneeIds: [],
      },
      include: instanceInclude,
    });
  });

  await applyDomainDecision(
    instance.documentType,
    "REJECTED",
    tid,
    instance.documentId,
    actorUserId,
    rejectionReason
  );

  if (instance.submittedByUserId) {
    await notifyUsers(tid, [instance.submittedByUserId], {
      type: NotificationType.APPROVAL_REJECTED,
      title: `Rejected: ${instance.documentType}`,
      body: rejectionReason,
      entityType: instance.documentType,
      entityId: instance.documentId,
    });
  }

  return completed;
}

export async function delegateInstance(
  tenantId: TenantId,
  id: string,
  actorUserId: string,
  toUserId: string,
  comment?: string | null
) {
  const tid = requireTenantId(tenantId);
  const instance = await getApproval(tid, id);
  if (
    instance.status !== ApprovalInstanceStatus.PENDING &&
    instance.status !== ApprovalInstanceStatus.ESCALATED
  ) {
    throw new AppError("Approval is not open", 400);
  }
  await assertActorCanAct(tid, instance, actorUserId);

  const step = instance.definition.steps.find((s) => s.level === instance.currentLevel);
  if (step && !step.canDelegate) {
    throw new AppError("Delegation not allowed for this step", 403);
  }

  const assignees = asUserIds(instance.currentAssigneeIds).filter((u) => u !== actorUserId);
  if (!assignees.includes(toUserId)) assignees.push(toUserId);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.approvalAction.create({
      data: {
        organizationId: tid,
        instanceId: id,
        level: instance.currentLevel,
        action: ApprovalActionType.DELEGATED,
        actorUserId,
        delegateToUserId: toUserId,
        comment,
      },
    });
    return tx.approvalInstance.update({
      where: { id },
      data: { currentAssigneeIds: assignees },
      include: instanceInclude,
    });
  });

  await notifyUsers(tid, [toUserId], {
    type: NotificationType.APPROVAL_REQUEST,
    title: `Delegated approval: ${instance.documentType}`,
    body: comment ?? `Delegated by ${actorUserId}`,
    entityType: instance.documentType,
    entityId: id,
  });

  return updated;
}

export async function refreshEscalations(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const now = new Date();
  const due = await prisma.approvalInstance.findMany({
    where: {
      organizationId: tid,
      status: ApprovalInstanceStatus.PENDING,
      escalationDueAt: { lte: now },
    },
  });

  for (const inst of due) {
    await prisma.$transaction(async (tx) => {
      await tx.approvalInstance.update({
        where: { id: inst.id },
        data: { status: ApprovalInstanceStatus.ESCALATED },
      });
      await tx.approvalAction.create({
        data: {
          organizationId: tid,
          instanceId: inst.id,
          level: inst.currentLevel,
          action: ApprovalActionType.ESCALATED,
          comment: "Escalation due exceeded",
        },
      });
    });
  }

  return { escalated: due.length };
}
