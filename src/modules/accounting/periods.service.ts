import { AccountingPeriodStatus, FiscalYearStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

export async function listFiscalYears(tenantId: TenantId) {
  return prisma.fiscalYear.findMany({
    where: { organizationId: requireTenantId(tenantId) },
    include: { periods: { orderBy: { startDate: "asc" } } },
    orderBy: { startDate: "desc" },
  });
}

export async function createFiscalYear(
  tenantId: TenantId,
  data: { code: string; startDate: string; endDate: string }
) {
  const tid = requireTenantId(tenantId);
  return prisma.fiscalYear.create({
    data: {
      organizationId: tid,
      code: data.code,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      status: FiscalYearStatus.OPEN,
    },
  });
}

export async function listPeriods(tenantId: TenantId, fiscalYearId?: string) {
  return prisma.accountingPeriod.findMany({
    where: {
      organizationId: requireTenantId(tenantId),
      ...(fiscalYearId ? { fiscalYearId } : {}),
    },
    orderBy: { startDate: "asc" },
  });
}

export async function createPeriod(
  tenantId: TenantId,
  data: {
    fiscalYearId: string;
    code: string;
    name?: string | null;
    startDate: string;
    endDate: string;
  }
) {
  const tid = requireTenantId(tenantId);
  const fy = await prisma.fiscalYear.findUnique({ where: { id: data.fiscalYearId } });
  if (!fy) throw new AppError("Fiscal year not found", 404);
  assertSameTenant(fy.organizationId, tid);
  return prisma.accountingPeriod.create({
    data: {
      organizationId: tid,
      fiscalYearId: data.fiscalYearId,
      code: data.code,
      name: data.name,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      status: AccountingPeriodStatus.OPEN,
    },
  });
}

export async function closePeriod(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);
  const period = await prisma.accountingPeriod.findUnique({ where: { id } });
  if (!period) throw new AppError("Period not found", 404);
  assertSameTenant(period.organizationId, tid);
  if (period.status === AccountingPeriodStatus.LOCKED) {
    throw new AppError("Period is locked — reopen first", 400);
  }
  return prisma.accountingPeriod.update({
    where: { id },
    data: {
      status: AccountingPeriodStatus.CLOSED,
      closedAt: new Date(),
      closedByUserId: userId,
    },
  });
}

export async function lockPeriod(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);
  const period = await prisma.accountingPeriod.findUnique({ where: { id } });
  if (!period) throw new AppError("Period not found", 404);
  assertSameTenant(period.organizationId, tid);
  return prisma.accountingPeriod.update({
    where: { id },
    data: {
      status: AccountingPeriodStatus.LOCKED,
      lockedAt: new Date(),
      lockedByUserId: userId,
    },
  });
}

export async function reopenPeriod(
  tenantId: TenantId,
  id: string,
  reason: string,
  userId?: string,
  authorized?: boolean
) {
  const tid = requireTenantId(tenantId);
  if (!authorized) throw new AppError("Period reopen requires authorization (accounting:reopen)", 403);
  if (!reason?.trim()) throw new AppError("Reopen reason required", 400);

  const period = await prisma.accountingPeriod.findUnique({ where: { id } });
  if (!period) throw new AppError("Period not found", 404);
  assertSameTenant(period.organizationId, tid);
  if (period.status === AccountingPeriodStatus.OPEN) {
    throw new AppError("Period is already open", 400);
  }

  return prisma.accountingPeriod.update({
    where: { id },
    data: {
      status: AccountingPeriodStatus.OPEN,
      reopenedAt: new Date(),
      reopenedByUserId: userId,
      reopenReason: reason,
    },
  });
}

export async function closeFiscalYear(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const fy = await prisma.fiscalYear.findUnique({
    where: { id },
    include: { periods: true },
  });
  if (!fy) throw new AppError("Fiscal year not found", 404);
  assertSameTenant(fy.organizationId, tid);
  const open = fy.periods.filter((p) => p.status === AccountingPeriodStatus.OPEN);
  if (open.length) {
    throw new AppError("Close or lock all periods before closing the fiscal year", 400);
  }
  return prisma.fiscalYear.update({
    where: { id },
    data: { status: FiscalYearStatus.CLOSED },
  });
}
