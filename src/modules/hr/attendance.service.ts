import {
  AttendanceSource,
  AttendanceStatus,
  CorrectionStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import {
  parseWorkDateInput,
  resolveTenantTimezone,
  workDateInTimezone,
} from "../../lib/tenantTimezone.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { getActiveSchedule, isWorkday, parseHm } from "./schedules.service.js";
import { defaultDeviceAdapter, type DevicePunchEvent } from "./deviceAttendance.adapter.js";

function minutesBetween(a: Date, b: Date) {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

export function computeAttendanceMetrics(args: {
  checkInAt: Date | null;
  checkOutAt: Date | null;
  workDate: Date;
  schedule: {
    startTime: string;
    endTime: string;
    breakMinutes: number;
    graceMinutes: number;
    expectedHours: Prisma.Decimal | number;
    overtimeAfterHours: Prisma.Decimal | number;
    workdaysMask: number;
    kind: string;
  } | null;
}) {
  const { checkInAt, checkOutAt, workDate, schedule } = args;
  if (!schedule) {
    const worked = checkInAt && checkOutAt ? minutesBetween(checkInAt, checkOutAt) : 0;
    return {
      status: checkInAt ? AttendanceStatus.PRESENT : AttendanceStatus.ABSENT,
      scheduledMinutes: 0,
      workedMinutes: worked,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      overtimeMinutes: Math.max(0, worked - 8 * 60),
    };
  }

  if (!isWorkday(schedule.workdaysMask, workDate) && schedule.kind !== "FLEXIBLE") {
    return {
      status: AttendanceStatus.WEEKEND,
      scheduledMinutes: 0,
      workedMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      overtimeMinutes: 0,
    };
  }

  const expectedMin = Math.round(Number(schedule.expectedHours) * 60);
  const otAfter = Math.round(Number(schedule.overtimeAfterHours) * 60);
  const start = parseHm(schedule.startTime, workDate);
  const end = parseHm(schedule.endTime, workDate);
  const graceEnd = new Date(start.getTime() + schedule.graceMinutes * 60000);

  if (!checkInAt) {
    return {
      status: AttendanceStatus.ABSENT,
      scheduledMinutes: expectedMin,
      workedMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      overtimeMinutes: 0,
    };
  }

  const lateMinutes = checkInAt > graceEnd ? minutesBetween(start, checkInAt) : 0;
  let workedMinutes = 0;
  let earlyLeaveMinutes = 0;
  let status: AttendanceStatus = lateMinutes > 0 ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;

  if (checkOutAt) {
    workedMinutes = Math.max(0, minutesBetween(checkInAt, checkOutAt) - schedule.breakMinutes);
    if (checkOutAt < end) {
      earlyLeaveMinutes = minutesBetween(checkOutAt, end);
      if (earlyLeaveMinutes > 0) status = AttendanceStatus.EARLY_LEAVE;
    }
  }

  const overtimeMinutes = Math.max(0, workedMinutes - otAfter);
  if (workedMinutes > 0 && workedMinutes < expectedMin / 2) status = AttendanceStatus.HALF_DAY;

  return {
    status,
    scheduledMinutes: expectedMin,
    workedMinutes,
    lateMinutes,
    earlyLeaveMinutes,
    overtimeMinutes,
  };
}

async function resolveEmployee(tid: string, employeeId: string) {
  const emp = await prisma.employee.findFirst({ where: { id: employeeId, organizationId: tid } });
  if (!emp) throw new AppError("Employee not found", 404);
  return emp;
}

export async function checkIn(
  tenantId: TenantId,
  data: {
    employeeId: string;
    at?: string;
    source?: AttendanceSource;
    shiftId?: string | null;
    note?: string | null;
    deviceRef?: string | null;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  await resolveEmployee(tid, data.employeeId);
  const at = data.at ? new Date(data.at) : new Date();
  const tz = await resolveTenantTimezone(tid);
  const workDate = workDateInTimezone(at, tz);
  const assignment = await getActiveSchedule(tid, data.employeeId, workDate);
  const metrics = computeAttendanceMetrics({
    checkInAt: at,
    checkOutAt: null,
    workDate,
    schedule: assignment?.schedule ?? null,
  });

  try {
    return await prisma.attendanceRecord.create({
      data: {
        organizationId: tid,
        employeeId: data.employeeId,
        workDate,
        checkInAt: at,
        status: metrics.status,
        source: data.source ?? AttendanceSource.SELF_SERVICE,
        shiftId: data.shiftId,
        scheduledMinutes: metrics.scheduledMinutes,
        workedMinutes: metrics.workedMinutes,
        lateMinutes: metrics.lateMinutes,
        earlyLeaveMinutes: metrics.earlyLeaveMinutes,
        overtimeMinutes: metrics.overtimeMinutes,
        note: data.note,
        deviceRef: data.deviceRef,
        createdByUserId: userId,
      },
    });
  } catch {
    throw new AppError("Attendance already exists for this date — use check-out or correction", 409);
  }
}

export async function checkOut(
  tenantId: TenantId,
  data: { employeeId: string; at?: string; note?: string | null },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  await resolveEmployee(tid, data.employeeId);
  const at = data.at ? new Date(data.at) : new Date();
  const tz = await resolveTenantTimezone(tid);
  const workDate = workDateInTimezone(at, tz);

  const record = await prisma.attendanceRecord.findUnique({
    where: {
      organizationId_employeeId_workDate: {
        organizationId: tid,
        employeeId: data.employeeId,
        workDate,
      },
    },
  });
  if (!record) throw new AppError("No check-in found for this date", 404);
  if (record.checkOutAt) throw new AppError("Already checked out", 409);
  if (record.checkInAt && at < record.checkInAt) {
    throw new AppError("Check-out cannot be before check-in", 400);
  }

  const assignment = await getActiveSchedule(tid, data.employeeId, workDate);
  const metrics = computeAttendanceMetrics({
    checkInAt: record.checkInAt,
    checkOutAt: at,
    workDate,
    schedule: assignment?.schedule ?? null,
  });

  return prisma.attendanceRecord.update({
    where: { id: record.id },
    data: {
      checkOutAt: at,
      status: metrics.status,
      scheduledMinutes: metrics.scheduledMinutes,
      workedMinutes: metrics.workedMinutes,
      lateMinutes: metrics.lateMinutes,
      earlyLeaveMinutes: metrics.earlyLeaveMinutes,
      overtimeMinutes: metrics.overtimeMinutes,
      note: data.note ?? record.note,
      updatedAt: new Date(),
    },
  });
}

export async function listAttendance(
  tenantId: TenantId,
  opts?: { employeeId?: string; from?: string; to?: string; status?: string }
) {
  const tid = requireTenantId(tenantId);
  return prisma.attendanceRecord.findMany({
    where: {
      organizationId: tid,
      ...(opts?.employeeId ? { employeeId: opts.employeeId } : {}),
      ...(opts?.status ? { status: opts.status as AttendanceStatus } : {}),
      ...(opts?.from || opts?.to
        ? {
            workDate: {
              ...(opts.from ? { gte: parseWorkDateInput(opts.from) } : {}),
              ...(opts.to ? { lte: parseWorkDateInput(opts.to) } : {}),
            },
          }
        : {}),
    },
    include: {
      employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
    },
    orderBy: [{ workDate: "desc" }, { employeeId: "asc" }],
    take: 500,
  });
}

export async function markAbsent(
  tenantId: TenantId,
  data: { employeeId: string; workDate: string; note?: string | null },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  await resolveEmployee(tid, data.employeeId);
  const workDate = parseWorkDateInput(data.workDate);
  const assignment = await getActiveSchedule(tid, data.employeeId, workDate);
  const expected = assignment ? Math.round(Number(assignment.schedule.expectedHours) * 60) : 0;

  return prisma.attendanceRecord.upsert({
    where: {
      organizationId_employeeId_workDate: {
        organizationId: tid,
        employeeId: data.employeeId,
        workDate,
      },
    },
    create: {
      organizationId: tid,
      employeeId: data.employeeId,
      workDate,
      status: AttendanceStatus.ABSENT,
      source: AttendanceSource.MANUAL,
      scheduledMinutes: expected,
      note: data.note,
      createdByUserId: userId,
    },
    update: {
      status: AttendanceStatus.ABSENT,
      checkInAt: null,
      checkOutAt: null,
      workedMinutes: 0,
      note: data.note,
    },
  });
}

export async function requestCorrection(
  tenantId: TenantId,
  data: {
    attendanceId: string;
    requestedCheckInAt?: string | null;
    requestedCheckOutAt?: string | null;
    reason: string;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const att = await prisma.attendanceRecord.findUnique({ where: { id: data.attendanceId } });
  if (!att) throw new AppError("Attendance not found", 404);
  assertSameTenant(att.organizationId, tid);

  return prisma.attendanceCorrection.create({
    data: {
      organizationId: tid,
      attendanceId: att.id,
      employeeId: att.employeeId,
      requestedCheckInAt: data.requestedCheckInAt ? new Date(data.requestedCheckInAt) : null,
      requestedCheckOutAt: data.requestedCheckOutAt ? new Date(data.requestedCheckOutAt) : null,
      reason: data.reason,
      createdByUserId: userId,
    },
  });
}

export async function decideCorrection(
  tenantId: TenantId,
  id: string,
  decision: "APPROVED" | "REJECTED",
  note?: string | null,
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const corr = await prisma.attendanceCorrection.findUnique({ where: { id } });
  if (!corr) throw new AppError("Correction not found", 404);
  assertSameTenant(corr.organizationId, tid);
  if (corr.status !== CorrectionStatus.PENDING) throw new AppError("Already decided", 409);

  if (decision === "REJECTED") {
    return prisma.attendanceCorrection.update({
      where: { id },
      data: {
        status: CorrectionStatus.REJECTED,
        decidedAt: new Date(),
        decidedByUserId: userId,
        decisionNote: note,
      },
    });
  }

  const att = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: corr.attendanceId } });
  const checkInAt = corr.requestedCheckInAt ?? att.checkInAt;
  const checkOutAt = corr.requestedCheckOutAt ?? att.checkOutAt;
  const assignment = await getActiveSchedule(tid, att.employeeId, att.workDate);
  const metrics = computeAttendanceMetrics({
    checkInAt,
    checkOutAt,
    workDate: att.workDate,
    schedule: assignment?.schedule ?? null,
  });

  await prisma.$transaction([
    prisma.attendanceRecord.update({
      where: { id: att.id },
      data: {
        checkInAt,
        checkOutAt,
        status: metrics.status,
        scheduledMinutes: metrics.scheduledMinutes,
        workedMinutes: metrics.workedMinutes,
        lateMinutes: metrics.lateMinutes,
        earlyLeaveMinutes: metrics.earlyLeaveMinutes,
        overtimeMinutes: metrics.overtimeMinutes,
        source: AttendanceSource.MANUAL,
      },
    }),
    prisma.attendanceCorrection.update({
      where: { id },
      data: {
        status: CorrectionStatus.APPROVED,
        decidedAt: new Date(),
        decidedByUserId: userId,
        decisionNote: note,
      },
    }),
  ]);

  return prisma.attendanceCorrection.findUniqueOrThrow({ where: { id } });
}

/** Probe path for future devices — maps through stub then optional persist via check-in/out. */
export async function ingestDevicePunch(tenantId: TenantId, event: Omit<DevicePunchEvent, "organizationId">) {
  const tid = requireTenantId(tenantId);
  return defaultDeviceAdapter.ingestPunch({ ...event, organizationId: tid });
}

export async function missingAttendanceReport(
  tenantId: TenantId,
  from: string,
  to: string
) {
  const tid = requireTenantId(tenantId);
  const start = parseWorkDateInput(from);
  const end = parseWorkDateInput(to);
  const employees = await prisma.employee.findMany({
    where: { organizationId: tid, status: { in: ["ACTIVE", "PROBATION"] } },
    select: { id: true, employeeNumber: true, firstName: true, lastName: true },
  });
  const records = await prisma.attendanceRecord.findMany({
    where: { organizationId: tid, workDate: { gte: start, lte: end } },
    select: { employeeId: true, workDate: true, status: true },
  });
  const key = (eid: string, d: Date) => `${eid}:${d.toISOString().slice(0, 10)}`;
  const have = new Set(records.map((r) => key(r.employeeId, r.workDate)));

  const missing: Array<{ employee: (typeof employees)[0]; workDate: string }> = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const day = new Date(t);
    for (const emp of employees) {
      const assignment = await getActiveSchedule(tid, emp.id, day);
      if (assignment && !isWorkday(assignment.schedule.workdaysMask, day)) continue;
      if (!have.has(key(emp.id, day))) {
        missing.push({ employee: emp, workDate: day.toISOString().slice(0, 10) });
      }
    }
  }
  return { from, to, count: missing.length, items: missing };
}

async function employeeForUser(tenantId: string, userId: string) {
  return prisma.employee.findFirst({
    where: { organizationId: tenantId, userId },
    select: { id: true, employeeNumber: true, firstName: true, lastName: true },
  });
}

export async function myAttendance(tenantId: TenantId, userId: string) {
  const tid = requireTenantId(tenantId);
  const employee = await employeeForUser(tid, userId);
  if (!employee) {
    throw new AppError("No employee profile is linked to this account", 404);
  }
  const tz = await resolveTenantTimezone(tid);
  const workDate = workDateInTimezone(new Date(), tz);
  const today = await prisma.attendanceRecord.findUnique({
    where: {
      organizationId_employeeId_workDate: {
        organizationId: tid,
        employeeId: employee.id,
        workDate,
      },
    },
  });
  return { employee, today, workDate: workDate.toISOString().slice(0, 10), timezone: tz };
}

export async function myCheckIn(tenantId: TenantId, userId: string) {
  const tid = requireTenantId(tenantId);
  const employee = await employeeForUser(tid, userId);
  if (!employee) throw new AppError("No employee profile is linked to this account", 404);
  return checkIn(tenantId, { employeeId: employee.id, source: AttendanceSource.SELF_SERVICE }, userId);
}

export async function myCheckOut(tenantId: TenantId, userId: string) {
  const tid = requireTenantId(tenantId);
  const employee = await employeeForUser(tid, userId);
  if (!employee) throw new AppError("No employee profile is linked to this account", 404);
  return checkOut(tenantId, { employeeId: employee.id }, userId);
}
