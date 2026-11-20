import { HrApprovalAction, HrRequestStatus, HrRequestType } from "@prisma/client";
import { nextDocumentNumber } from "../../lib/documentNumber.js";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

const requestInclude = {
  requester: {
    select: { id: true, employeeNumber: true, firstName: true, lastName: true },
  },
  assignee: {
    select: { id: true, employeeNumber: true, firstName: true, lastName: true },
  },
  approvals: { orderBy: { at: "asc" as const } },
};

async function addApproval(
  tid: string,
  requestId: string,
  action: HrApprovalAction,
  actorUserId?: string | null,
  note?: string | null
) {
  await prisma.hrRequestApproval.create({
    data: {
      organizationId: tid,
      requestId,
      action,
      actorUserId: actorUserId ?? null,
      note: note ?? null,
    },
  });
}

export async function listRequests(
  tenantId: TenantId,
  opts?: { status?: string; type?: string; requesterId?: string }
) {
  return prisma.hrRequest.findMany({
    where: {
      organizationId: requireTenantId(tenantId),
      ...(opts?.status ? { status: opts.status as HrRequestStatus } : {}),
      ...(opts?.type ? { type: opts.type as HrRequestType } : {}),
      ...(opts?.requesterId ? { requesterId: opts.requesterId } : {}),
    },
    include: requestInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getRequest(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.hrRequest.findUnique({
    where: { id },
    include: requestInclude,
  });
  if (!row) throw new AppError("HR request not found", 404);
  assertSameTenant(row.organizationId, tid);
  return row;
}

export async function createRequest(
  tenantId: TenantId,
  data: {
    type?: HrRequestType;
    title: string;
    description?: string | null;
    requesterId: string;
    assigneeId?: string | null;
    submit?: boolean;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const requester = await prisma.employee.findFirst({
    where: { id: data.requesterId, organizationId: tid },
  });
  if (!requester) throw new AppError("Requester employee not found", 404);

  if (data.assigneeId) {
    const a = await prisma.employee.findFirst({
      where: { id: data.assigneeId, organizationId: tid },
    });
    if (!a) throw new AppError("Assignee employee not found", 404);
  }

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "HRREQ", "HRREQ");
    const submit = Boolean(data.submit);
    const request = await tx.hrRequest.create({
      data: {
        organizationId: tid,
        code,
        type: data.type ?? HrRequestType.GENERAL,
        title: data.title,
        description: data.description,
        requesterId: data.requesterId,
        assigneeId: data.assigneeId ?? requester.managerEmployeeId,
        status: submit ? HrRequestStatus.SUBMITTED : HrRequestStatus.DRAFT,
        submittedAt: submit ? new Date() : null,
        createdByUserId: userId,
      },
      include: requestInclude,
    });

    await tx.hrRequestApproval.create({
      data: {
        organizationId: tid,
        requestId: request.id,
        action: submit ? HrApprovalAction.SUBMITTED : HrApprovalAction.COMMENTED,
        actorUserId: userId,
        note: submit ? "Submitted" : "Draft created",
      },
    });

    return tx.hrRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: requestInclude,
    });
  });
}

export async function submitRequest(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);
  const req = await prisma.hrRequest.findUnique({ where: { id } });
  if (!req) throw new AppError("HR request not found", 404);
  assertSameTenant(req.organizationId, tid);
  if (req.status !== HrRequestStatus.DRAFT) {
    throw new AppError("Only draft requests can be submitted", 400);
  }

  const updated = await prisma.hrRequest.update({
    where: { id },
    data: {
      status: HrRequestStatus.SUBMITTED,
      submittedAt: new Date(),
    },
    include: requestInclude,
  });
  await addApproval(tid, id, HrApprovalAction.SUBMITTED, userId, "Submitted for review");
  return getRequest(tid, updated.id);
}

export async function startReview(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);
  const req = await prisma.hrRequest.findUnique({ where: { id } });
  if (!req) throw new AppError("HR request not found", 404);
  assertSameTenant(req.organizationId, tid);
  if (req.status !== HrRequestStatus.SUBMITTED && req.status !== HrRequestStatus.IN_REVIEW) {
    throw new AppError("Request cannot enter review in current status", 400);
  }

  await prisma.hrRequest.update({
    where: { id },
    data: { status: HrRequestStatus.IN_REVIEW },
  });
  await addApproval(tid, id, HrApprovalAction.REVIEWED, userId, "Under review");
  return getRequest(tid, id);
}

export async function decideRequest(
  tenantId: TenantId,
  id: string,
  decision: "APPROVED" | "REJECTED",
  note?: string | null,
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const req = await prisma.hrRequest.findUnique({ where: { id } });
  if (!req) throw new AppError("HR request not found", 404);
  assertSameTenant(req.organizationId, tid);
  if (
    req.status !== HrRequestStatus.SUBMITTED &&
    req.status !== HrRequestStatus.IN_REVIEW
  ) {
    throw new AppError("Request cannot be decided in current status", 400);
  }

  const status =
    decision === "APPROVED" ? HrRequestStatus.APPROVED : HrRequestStatus.REJECTED;
  await prisma.hrRequest.update({
    where: { id },
    data: {
      status,
      decidedAt: new Date(),
      decisionNote: note ?? null,
    },
  });
  await addApproval(
    tid,
    id,
    decision === "APPROVED" ? HrApprovalAction.APPROVED : HrApprovalAction.REJECTED,
    userId,
    note ?? decision
  );
  return getRequest(tid, id);
}

export async function cancelRequest(
  tenantId: TenantId,
  id: string,
  note?: string | null,
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const req = await prisma.hrRequest.findUnique({ where: { id } });
  if (!req) throw new AppError("HR request not found", 404);
  assertSameTenant(req.organizationId, tid);
  if (
    req.status === HrRequestStatus.APPROVED ||
    req.status === HrRequestStatus.CANCELLED
  ) {
    throw new AppError("Request cannot be cancelled", 400);
  }

  await prisma.hrRequest.update({
    where: { id },
    data: { status: HrRequestStatus.CANCELLED, decisionNote: note ?? null },
  });
  await addApproval(tid, id, HrApprovalAction.CANCELLED, userId, note ?? "Cancelled");
  return getRequest(tid, id);
}
