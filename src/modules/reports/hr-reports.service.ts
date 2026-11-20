import {
  AttendanceStatus,
  EmploymentStatus,
  LeaveRequestStatus,
  PayrollRunStatus,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireTenantId } from "../../lib/tenantDb.js";
import type { TenantId } from "../../types/tenant.js";
import { n, parseRange, round4 } from "./period.js";

export async function attendanceReport(tenantId: TenantId, from?: string, to?: string) {
  const tid = requireTenantId(tenantId);
  const range = parseRange(from, to);
  const records = await prisma.attendanceRecord.findMany({
    where: {
      organizationId: tid,
      ...(range.from || range.to
        ? {
            workDate: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lte: range.to } : {}),
            },
          }
        : {}),
    },
    include: {
      employee: {
        select: { employeeNumber: true, firstName: true, lastName: true },
      },
    },
    orderBy: { workDate: "desc" },
    take: 1000,
  });

  const rows = records.map((r) => ({
    employeeNumber: r.employee.employeeNumber,
    name: `${r.employee.firstName} ${r.employee.lastName}`,
    workDate: r.workDate,
    status: r.status,
    checkInAt: r.checkInAt,
    checkOutAt: r.checkOutAt,
    lateMinutes: r.lateMinutes,
    earlyLeaveMinutes: r.earlyLeaveMinutes,
    overtimeMinutes: r.overtimeMinutes,
    workedMinutes: r.workedMinutes,
    workedHours: round4(r.workedMinutes / 60),
  }));

  return {
    from: from ?? null,
    to: to ?? null,
    count: rows.length,
    rows,
    items: rows,
  };
}

export async function absenceReport(tenantId: TenantId, from?: string, to?: string) {
  const tid = requireTenantId(tenantId);
  const range = parseRange(from, to);
  const records = await prisma.attendanceRecord.findMany({
    where: {
      organizationId: tid,
      status: AttendanceStatus.ABSENT,
      ...(range.from || range.to
        ? {
            workDate: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lte: range.to } : {}),
            },
          }
        : {}),
    },
    include: {
      employee: {
        select: { employeeNumber: true, firstName: true, lastName: true },
      },
    },
    orderBy: { workDate: "desc" },
  });
  const rows = records.map((r) => ({
    employeeNumber: r.employee.employeeNumber,
    name: `${r.employee.firstName} ${r.employee.lastName}`,
    workDate: r.workDate,
    status: r.status,
  }));
  return { from: from ?? null, to: to ?? null, count: rows.length, rows, items: rows };
}

export async function overtimeReport(tenantId: TenantId, from?: string, to?: string) {
  const tid = requireTenantId(tenantId);
  const range = parseRange(from, to);
  const records = await prisma.attendanceRecord.findMany({
    where: {
      organizationId: tid,
      overtimeMinutes: { gt: 0 },
      ...(range.from || range.to
        ? {
            workDate: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lte: range.to } : {}),
            },
          }
        : {}),
    },
    include: {
      employee: {
        select: { employeeNumber: true, firstName: true, lastName: true },
      },
    },
  });
  const map = new Map<
    string,
    { employeeNumber: string; name: string; overtimeMinutes: number; days: number }
  >();
  for (const r of records) {
    const key = r.employeeId;
    const cur = map.get(key) ?? {
      employeeNumber: r.employee.employeeNumber,
      name: `${r.employee.firstName} ${r.employee.lastName}`,
      overtimeMinutes: 0,
      days: 0,
    };
    cur.overtimeMinutes += r.overtimeMinutes;
    cur.days += 1;
    map.set(key, cur);
  }
  const rows = [...map.values()]
    .map((r) => ({
      ...r,
      overtimeHours: round4(r.overtimeMinutes / 60),
    }))
    .sort((a, b) => b.overtimeMinutes - a.overtimeMinutes);
  return { from: from ?? null, to: to ?? null, rows, items: rows };
}

export async function leaveBalancesReport(tenantId: TenantId, year?: number) {
  const tid = requireTenantId(tenantId);
  const y = year ?? new Date().getUTCFullYear();
  const balances = await prisma.leaveBalance.findMany({
    where: { organizationId: tid, year: y },
    include: {
      employee: {
        select: { employeeNumber: true, firstName: true, lastName: true },
      },
      leaveType: { select: { code: true, name: true } },
    },
  });
  const rows = balances.map((b) => ({
    employeeNumber: b.employee.employeeNumber,
    name: `${b.employee.firstName} ${b.employee.lastName}`,
    leaveType: b.leaveType.code,
    leaveTypeName: b.leaveType.name,
    year: b.year,
    entitled: n(b.entitled),
    used: n(b.used),
    pending: n(b.pending),
    available: round4(n(b.entitled) - n(b.used) - n(b.pending)),
  }));
  return {
    year: y,
    definitions: {
      available: "entitled - used - pending",
    },
    rows,
    items: rows,
  };
}

export async function payrollSummary(tenantId: TenantId, from?: string, to?: string) {
  const tid = requireTenantId(tenantId);
  const range = parseRange(from, to);
  const runs = await prisma.payrollRun.findMany({
    where: {
      organizationId: tid,
      status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.FINALIZED] },
      ...(range.from || range.to
        ? {
            createdAt: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lte: range.to } : {}),
            },
          }
        : {}),
    },
    include: {
      period: true,
      lines: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const rows = runs.map((run) => {
    const gross = run.lines.reduce((s, l) => s + n(l.grossPay), 0);
    const net = run.lines.reduce((s, l) => s + n(l.netPay), 0);
    const deductions = run.lines.reduce(
      (s, l) => s + n(l.advances) + n(l.absenceDeduction) + n(l.otherDeductions),
      0
    );
    return {
      code: run.code,
      status: run.status,
      period: `${run.period.startDate.toISOString().slice(0, 10)} → ${run.period.endDate.toISOString().slice(0, 10)}`,
      employees: run.lines.length,
      grossPay: round4(gross),
      totalDeductions: round4(deductions),
      netPay: round4(net),
    };
  });

  return {
    from: from ?? null,
    to: to ?? null,
    definitions: {
      grossPay: "Sum of PayrollLine.grossPay on approved/finalized runs",
      totalDeductions: "Sum(advances + absenceDeduction + otherDeductions)",
      netPay: "Sum of PayrollLine.netPay",
    },
    rows,
    items: rows,
  };
}

export async function employeeStats(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const [total, active, onLeave] = await Promise.all([
    prisma.employee.count({ where: { organizationId: tid } }),
    prisma.employee.count({
      where: { organizationId: tid, status: EmploymentStatus.ACTIVE },
    }),
    prisma.leaveRequest.count({
      where: {
        organizationId: tid,
        status: LeaveRequestStatus.APPROVED,
        startDate: { lte: new Date() },
        endDate: { gte: new Date() },
      },
    }),
  ]);
  return {
    totalEmployees: total,
    activeEmployees: active,
    currentlyOnLeave: onLeave,
  };
}
