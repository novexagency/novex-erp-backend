import { OpsAssetStatus, OpsMaintenanceStatus, OpsMaintenanceType, Prisma } from "@prisma/client";
import { nextDocumentNumber } from "../../lib/documentNumber.js";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

export async function listMaintenance(
  tenantId: TenantId,
  opts?: { status?: string; assetId?: string; type?: string }
) {
  return prisma.opsMaintenanceRequest.findMany({
    where: {
      organizationId: requireTenantId(tenantId),
      ...(opts?.status ? { status: opts.status as OpsMaintenanceStatus } : {}),
      ...(opts?.assetId ? { assetId: opts.assetId } : {}),
      ...(opts?.type ? { type: opts.type as OpsMaintenanceType } : {}),
    },
    include: {
      asset: { select: { id: true, code: true, name: true, status: true } },
      responsible: {
        select: { id: true, employeeNumber: true, firstName: true, lastName: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function createMaintenanceRequest(
  tenantId: TenantId,
  data: {
    assetId: string;
    type?: OpsMaintenanceType;
    title: string;
    description?: string | null;
    costAmount?: number;
    scheduledAt?: string | null;
    responsibleEmployeeId?: string | null;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const asset = await prisma.opsAsset.findFirst({
    where: { id: data.assetId, organizationId: tid },
  });
  if (!asset || asset.status === OpsAssetStatus.DISPOSED) {
    throw new AppError("Asset not found", 404);
  }
  if (data.responsibleEmployeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: data.responsibleEmployeeId, organizationId: tid },
    });
    if (!emp) throw new AppError("Employee not found", 404);
  }

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "MNT", "MNT");
    const req = await tx.opsMaintenanceRequest.create({
      data: {
        organizationId: tid,
        code,
        assetId: data.assetId,
        type: data.type ?? OpsMaintenanceType.CORRECTIVE,
        title: data.title,
        description: data.description,
        costAmount: new Prisma.Decimal(data.costAmount ?? 0),
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
        status: data.scheduledAt ? OpsMaintenanceStatus.SCHEDULED : OpsMaintenanceStatus.OPEN,
        responsibleEmployeeId: data.responsibleEmployeeId,
        createdByUserId: userId,
      },
      include: { asset: true, responsible: true },
    });

    if (data.type === OpsMaintenanceType.CORRECTIVE || !data.type) {
      await tx.opsAsset.update({
        where: { id: data.assetId },
        data: { status: OpsAssetStatus.IN_REPAIR },
      });
      await tx.opsAssetEvent.create({
        data: {
          organizationId: tid,
          assetId: data.assetId,
          action: "MAINTENANCE_OPENED",
          note: req.code,
          actorUserId: userId,
        },
      });
    }

    return req;
  });
}

export async function updateMaintenanceStatus(
  tenantId: TenantId,
  id: string,
  data: {
    status: OpsMaintenanceStatus;
    costAmount?: number;
    completedAt?: string | null;
    note?: string | null;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const req = await prisma.opsMaintenanceRequest.findUnique({ where: { id } });
  if (!req) throw new AppError("Maintenance request not found", 404);
  assertSameTenant(req.organizationId, tid);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.opsMaintenanceRequest.update({
      where: { id },
      data: {
        status: data.status,
        costAmount:
          data.costAmount !== undefined ? new Prisma.Decimal(data.costAmount) : undefined,
        completedAt:
          data.status === OpsMaintenanceStatus.COMPLETED
            ? data.completedAt
              ? new Date(data.completedAt)
              : new Date()
            : data.completedAt === null
              ? null
              : undefined,
      },
      include: { asset: true, responsible: true },
    });

    if (data.status === OpsMaintenanceStatus.COMPLETED) {
      await tx.opsAsset.update({
        where: { id: req.assetId },
        data: { status: OpsAssetStatus.ACTIVE },
      });
      await tx.opsAssetEvent.create({
        data: {
          organizationId: tid,
          assetId: req.assetId,
          action: "MAINTENANCE_COMPLETED",
          note: data.note ?? req.code,
          actorUserId: userId,
        },
      });
    }

    return updated;
  });
}

export async function createPreventiveSchedule(
  tenantId: TenantId,
  data: {
    assetId: string;
    title: string;
    intervalDays: number;
    nextDueAt: string;
  }
) {
  const tid = requireTenantId(tenantId);
  const asset = await prisma.opsAsset.findFirst({
    where: { id: data.assetId, organizationId: tid },
  });
  if (!asset || asset.status === OpsAssetStatus.DISPOSED) {
    throw new AppError("Asset not found", 404);
  }
  if (!data.intervalDays || data.intervalDays < 1) {
    throw new AppError("intervalDays must be a positive integer", 400);
  }

  return prisma.opsMaintenanceSchedule.create({
    data: {
      organizationId: tid,
      assetId: data.assetId,
      title: data.title,
      intervalDays: data.intervalDays,
      nextDueAt: new Date(data.nextDueAt),
    },
    include: { asset: true },
  });
}

export async function listSchedules(tenantId: TenantId, dueBefore?: string) {
  return prisma.opsMaintenanceSchedule.findMany({
    where: {
      organizationId: requireTenantId(tenantId),
      isActive: true,
      ...(dueBefore ? { nextDueAt: { lte: new Date(dueBefore) } } : {}),
    },
    include: { asset: { select: { id: true, code: true, name: true } } },
    orderBy: { nextDueAt: "asc" },
  });
}

export async function completeScheduleOccurrence(
  tenantId: TenantId,
  scheduleId: string,
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const schedule = await prisma.opsMaintenanceSchedule.findUnique({ where: { id: scheduleId } });
  if (!schedule) throw new AppError("Maintenance schedule not found", 404);
  assertSameTenant(schedule.organizationId, tid);

  const nextDue = new Date(schedule.nextDueAt);
  nextDue.setUTCDate(nextDue.getUTCDate() + schedule.intervalDays);

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "MNT", "MNT");
    const req = await tx.opsMaintenanceRequest.create({
      data: {
        organizationId: tid,
        code,
        assetId: schedule.assetId,
        type: OpsMaintenanceType.PREVENTIVE,
        status: OpsMaintenanceStatus.COMPLETED,
        title: schedule.title,
        completedAt: new Date(),
        createdByUserId: userId,
      },
    });
    await tx.opsMaintenanceSchedule.update({
      where: { id: scheduleId },
      data: { lastDoneAt: new Date(), nextDueAt: nextDue },
    });
    return req;
  });
}
