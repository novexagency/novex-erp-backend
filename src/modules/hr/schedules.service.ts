import { Prisma, ScheduleKind } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

export async function listSchedules(tenantId: TenantId) {
  return prisma.workSchedule.findMany({
    where: { organizationId: requireTenantId(tenantId), isActive: true },
    include: { shifts: true },
    orderBy: { code: "asc" },
  });
}

export async function createSchedule(
  tenantId: TenantId,
  data: {
    code: string;
    name: string;
    nameAr?: string | null;
    kind?: ScheduleKind;
    workdaysMask?: number;
    startTime?: string;
    endTime?: string;
    breakMinutes?: number;
    graceMinutes?: number;
    expectedHours?: number;
    overtimeAfterHours?: number;
  }
) {
  const tid = requireTenantId(tenantId);
  try {
    return await prisma.workSchedule.create({
      data: {
        organizationId: tid,
        code: data.code,
        name: data.name,
        nameAr: data.nameAr,
        kind: data.kind ?? ScheduleKind.FIXED,
        workdaysMask: data.workdaysMask ?? 31,
        startTime: data.startTime ?? "09:00",
        endTime: data.endTime ?? "17:00",
        breakMinutes: data.breakMinutes ?? 60,
        graceMinutes: data.graceMinutes ?? 15,
        expectedHours: new Prisma.Decimal(data.expectedHours ?? 8),
        overtimeAfterHours: new Prisma.Decimal(data.overtimeAfterHours ?? 8),
      },
      include: { shifts: true },
    });
  } catch {
    throw new AppError("Duplicate schedule code", 409);
  }
}

export async function addShift(
  tenantId: TenantId,
  scheduleId: string,
  data: { code: string; name: string; startTime: string; endTime: string; breakMinutes?: number }
) {
  const tid = requireTenantId(tenantId);
  const schedule = await prisma.workSchedule.findUnique({ where: { id: scheduleId } });
  if (!schedule) throw new AppError("Schedule not found", 404);
  assertSameTenant(schedule.organizationId, tid);
  return prisma.shift.create({
    data: {
      organizationId: tid,
      scheduleId,
      code: data.code,
      name: data.name,
      startTime: data.startTime,
      endTime: data.endTime,
      breakMinutes: data.breakMinutes ?? 0,
    },
  });
}

export async function assignSchedule(
  tenantId: TenantId,
  data: { employeeId: string; scheduleId: string; effectiveFrom?: string; effectiveTo?: string | null }
) {
  const tid = requireTenantId(tenantId);
  const emp = await prisma.employee.findFirst({
    where: { id: data.employeeId, organizationId: tid },
  });
  if (!emp) throw new AppError("Employee not found", 404);
  const schedule = await prisma.workSchedule.findFirst({
    where: { id: data.scheduleId, organizationId: tid },
  });
  if (!schedule) throw new AppError("Schedule not found", 404);

  const from = data.effectiveFrom
    ? new Date(data.effectiveFrom)
    : new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));

  return prisma.employeeSchedule.create({
    data: {
      organizationId: tid,
      employeeId: data.employeeId,
      scheduleId: data.scheduleId,
      effectiveFrom: from,
      effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
    },
    include: { schedule: true, employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } } },
  });
}

export async function getActiveSchedule(tenantId: string, employeeId: string, onDate: Date) {
  return prisma.employeeSchedule.findFirst({
    where: {
      organizationId: tenantId,
      employeeId,
      effectiveFrom: { lte: onDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
    },
    include: { schedule: { include: { shifts: true } } },
    orderBy: { effectiveFrom: "desc" },
  });
}

/** Mon=0 in JS getDay is Sunday — convert to Mon=bit0 */
export function isWorkday(mask: number, date: Date) {
  const js = date.getUTCDay(); // 0 Sun .. 6 Sat
  const bit = js === 0 ? 6 : js - 1; // Mon=0 .. Sun=6
  return (mask & (1 << bit)) !== 0;
}

export function parseHm(hm: string, baseDate: Date) {
  const [h, m] = hm.split(":").map(Number);
  const d = new Date(baseDate);
  d.setUTCHours(h || 0, m || 0, 0, 0);
  return d;
}
