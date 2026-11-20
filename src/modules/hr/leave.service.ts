import { LeaveRequestStatus, Prisma, WorkflowDocumentType } from "@prisma/client";
import { nextDocumentNumber } from "../../lib/documentNumber.js";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import type { WorkflowOpts } from "../workflow/adapters/types.js";
import {
  assertDirectApproveAllowed,
  startApprovalIfConfigured,
} from "../workflow/engine.service.js";

function daysBetween(start: Date, end: Date) {
  const s = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const e = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.floor((e - s) / 86400000) + 1;
}

export async function seedDefaultLeaveTypes(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const defaults = [
    { code: "ANNUAL", name: "Annual Leave", nameAr: "إجازة سنوية", isPaid: true, deductsBalance: true, annualAllowance: 21 },
    { code: "SICK", name: "Sick Leave", nameAr: "إجازة مرضية", isPaid: true, deductsBalance: true, annualAllowance: 15 },
    { code: "UNPAID", name: "Unpaid Leave", nameAr: "إجازة بدون راتب", isPaid: false, deductsBalance: false, annualAllowance: 0 },
  ];
  for (const d of defaults) {
    await prisma.leaveType.upsert({
      where: { organizationId_code: { organizationId: tid, code: d.code } },
      create: {
        organizationId: tid,
        code: d.code,
        name: d.name,
        nameAr: d.nameAr,
        isPaid: d.isPaid,
        deductsBalance: d.deductsBalance,
        annualAllowance: new Prisma.Decimal(d.annualAllowance),
      },
      update: {},
    });
  }
  return listLeaveTypes(tid);
}

export async function listLeaveTypes(tenantId: TenantId) {
  return prisma.leaveType.findMany({
    where: { organizationId: requireTenantId(tenantId), isActive: true },
    orderBy: { code: "asc" },
  });
}

export async function createLeaveType(
  tenantId: TenantId,
  data: {
    code: string;
    name: string;
    nameAr?: string | null;
    isPaid?: boolean;
    deductsBalance?: boolean;
    annualAllowance?: number;
  }
) {
  const tid = requireTenantId(tenantId);
  try {
    return await prisma.leaveType.create({
      data: {
        organizationId: tid,
        code: data.code,
        name: data.name,
        nameAr: data.nameAr,
        isPaid: data.isPaid ?? true,
        deductsBalance: data.deductsBalance ?? true,
        annualAllowance: new Prisma.Decimal(data.annualAllowance ?? 0),
      },
    });
  } catch {
    throw new AppError("Duplicate leave type code", 409);
  }
}

export async function ensureLeaveBalance(
  tenantId: string,
  employeeId: string,
  leaveTypeId: string,
  year: number
) {
  const type = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
  if (!type || type.organizationId !== tenantId) throw new AppError("Leave type not found", 404);

  return prisma.leaveBalance.upsert({
    where: {
      employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year },
    },
    create: {
      organizationId: tenantId,
      employeeId,
      leaveTypeId,
      year,
      entitled: type.annualAllowance,
      used: new Prisma.Decimal(0),
      pending: new Prisma.Decimal(0),
    },
    update: {},
  });
}

export async function listBalances(tenantId: TenantId, employeeId?: string, year?: number) {
  const tid = requireTenantId(tenantId);
  const y = year ?? new Date().getUTCFullYear();
  return prisma.leaveBalance.findMany({
    where: {
      organizationId: tid,
      year: y,
      ...(employeeId ? { employeeId } : {}),
    },
    include: {
      leaveType: true,
      employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
    },
  });
}

export async function createLeaveRequest(
  tenantId: TenantId,
  data: {
    employeeId: string;
    leaveTypeId: string;
    startDate: string;
    endDate: string;
    reason?: string | null;
    submit?: boolean;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const emp = await prisma.employee.findFirst({
    where: { id: data.employeeId, organizationId: tid },
  });
  if (!emp) throw new AppError("Employee not found", 404);
  const type = await prisma.leaveType.findFirst({
    where: { id: data.leaveTypeId, organizationId: tid },
  });
  if (!type) throw new AppError("Leave type not found", 404);

  const startDate = new Date(data.startDate);
  const endDate = new Date(data.endDate);
  if (endDate < startDate) throw new AppError("endDate before startDate", 400);
  const days = daysBetween(startDate, endDate);
  const year = startDate.getUTCFullYear();
  const balance = await ensureLeaveBalance(tid, data.employeeId, data.leaveTypeId, year);

  if (type.deductsBalance) {
    const available = Number(balance.entitled) - Number(balance.used) - Number(balance.pending);
    if (days > available + 0.001) {
      throw new AppError(`Insufficient leave balance (available ${available}, requested ${days})`, 400);
    }
  }

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "LEAVE", "LEAVE");
    const submit = Boolean(data.submit);
    const request = await tx.leaveRequest.create({
      data: {
        organizationId: tid,
        code,
        employeeId: data.employeeId,
        leaveTypeId: data.leaveTypeId,
        startDate,
        endDate,
        days: new Prisma.Decimal(days),
        reason: data.reason,
        status: submit ? LeaveRequestStatus.SUBMITTED : LeaveRequestStatus.DRAFT,
        submittedAt: submit ? new Date() : null,
        createdByUserId: userId,
      },
      include: { leaveType: true, employee: true },
    });

    if (submit && type.deductsBalance) {
      await tx.leaveBalance.update({
        where: { id: balance.id },
        data: { pending: { increment: days } },
      });
    }

    await tx.leaveRequestEvent.create({
      data: {
        organizationId: tid,
        requestId: request.id,
        action: submit ? "SUBMITTED" : "CREATED",
        actorUserId: userId,
      },
    });

    return request;
  });
}

export async function submitLeaveRequest(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);
  const req = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { leaveType: true },
  });
  if (!req) throw new AppError("Leave request not found", 404);
  assertSameTenant(req.organizationId, tid);
  if (req.status !== LeaveRequestStatus.DRAFT) throw new AppError("Only drafts can be submitted", 400);

  const year = req.startDate.getUTCFullYear();
  const balance = await ensureLeaveBalance(tid, req.employeeId, req.leaveTypeId, year);

  await prisma.$transaction(async (tx) => {
    if (req.leaveType.deductsBalance) {
      const available = Number(balance.entitled) - Number(balance.used) - Number(balance.pending);
      if (Number(req.days) > available + 0.001) {
        throw new AppError("Insufficient leave balance", 400);
      }
      await tx.leaveBalance.update({
        where: { id: balance.id },
        data: { pending: { increment: Number(req.days) } },
      });
    }
    await tx.leaveRequest.update({
      where: { id },
      data: { status: LeaveRequestStatus.SUBMITTED, submittedAt: new Date() },
    });
    await tx.leaveRequestEvent.create({
      data: {
        organizationId: tid,
        requestId: id,
        action: "SUBMITTED",
        actorUserId: userId,
      },
    });
  });

  const approval = await startApprovalIfConfigured(tid, {
    documentType: WorkflowDocumentType.LEAVE_REQUEST,
    documentId: id,
    submittedByUserId: userId,
  });
  const row = await prisma.leaveRequest.findUniqueOrThrow({
    where: { id },
    include: { leaveType: true, events: true, employee: true },
  });
  if (approval) {
    return { ...row, pendingApproval: true, approvalId: approval.id };
  }
  return row;
}

export async function decideLeaveRequest(
  tenantId: TenantId,
  id: string,
  decision: "APPROVED" | "REJECTED",
  note?: string | null,
  userId?: string,
  opts?: WorkflowOpts
) {
  const tid = requireTenantId(tenantId);
  await assertDirectApproveAllowed(tid, WorkflowDocumentType.LEAVE_REQUEST, id, opts);
  const req = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { leaveType: true },
  });
  if (!req) throw new AppError("Leave request not found", 404);
  assertSameTenant(req.organizationId, tid);
  if (req.status !== LeaveRequestStatus.SUBMITTED) {
    throw new AppError("Only submitted requests can be decided", 400);
  }

  const year = req.startDate.getUTCFullYear();
  const balance = await ensureLeaveBalance(tid, req.employeeId, req.leaveTypeId, year);
  const days = Number(req.days);

  return prisma.$transaction(async (tx) => {
    if (req.leaveType.deductsBalance) {
      if (decision === "APPROVED") {
        await tx.leaveBalance.update({
          where: { id: balance.id },
          data: {
            pending: { decrement: days },
            used: { increment: days },
          },
        });
      } else {
        await tx.leaveBalance.update({
          where: { id: balance.id },
          data: { pending: { decrement: days } },
        });
      }
    }

    await tx.leaveRequest.update({
      where: { id },
      data: {
        status:
          decision === "APPROVED" ? LeaveRequestStatus.APPROVED : LeaveRequestStatus.REJECTED,
        decidedAt: new Date(),
        decidedByUserId: userId,
        decisionNote: note,
      },
    });
    await tx.leaveRequestEvent.create({
      data: {
        organizationId: tid,
        requestId: id,
        action: decision,
        actorUserId: userId,
        note,
      },
    });

    return tx.leaveRequest.findUniqueOrThrow({
      where: { id },
      include: { leaveType: true, events: true, employee: true },
    });
  });
}

export async function listLeaveRequests(
  tenantId: TenantId,
  opts?: { employeeId?: string; status?: string }
) {
  return prisma.leaveRequest.findMany({
    where: {
      organizationId: requireTenantId(tenantId),
      ...(opts?.employeeId ? { employeeId: opts.employeeId } : {}),
      ...(opts?.status ? { status: opts.status as LeaveRequestStatus } : {}),
    },
    include: {
      leaveType: true,
      employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
      events: { orderBy: { at: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
