import {
  AdvanceStatus,
  AttendanceStatus,
  EmploymentStatus,
  LeaveRequestStatus,
  PayrollItemKind,
  PayrollRunStatus,
  Prisma,
  WorkflowDocumentType,
} from "@prisma/client";
import { nextDocumentNumber } from "../../lib/documentNumber.js";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import type { WorkflowOpts } from "../workflow/adapters/types.js";
import { startApprovalIfConfigured } from "../workflow/engine.service.js";

function d(n: number) {
  return new Prisma.Decimal(Number(n.toFixed(4)));
}

function dateOnly(v: Date) {
  return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
}

export async function createPeriod(
  tenantId: TenantId,
  data: { code: string; name?: string | null; startDate: string; endDate: string }
) {
  const tid = requireTenantId(tenantId);
  return prisma.payrollPeriod.create({
    data: {
      organizationId: tid,
      code: data.code,
      name: data.name,
      startDate: dateOnly(new Date(data.startDate)),
      endDate: dateOnly(new Date(data.endDate)),
    },
  });
}

export async function listPeriods(tenantId: TenantId) {
  return prisma.payrollPeriod.findMany({
    where: { organizationId: requireTenantId(tenantId) },
    include: { runs: { orderBy: { createdAt: "desc" } } },
    orderBy: { startDate: "desc" },
  });
}

export async function createAdvance(
  tenantId: TenantId,
  data: { employeeId: string; amount: number; note?: string | null },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  if (data.amount <= 0) throw new AppError("Advance amount must be positive", 400);
  const emp = await prisma.employee.findFirst({
    where: { id: data.employeeId, organizationId: tid },
  });
  if (!emp) throw new AppError("Employee not found", 404);

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "ADV", "ADV");
    return tx.salaryAdvance.create({
      data: {
        organizationId: tid,
        employeeId: data.employeeId,
        code,
        amount: d(data.amount),
        note: data.note,
        createdByUserId: userId,
      },
    });
  });
}

export async function createRun(
  tenantId: TenantId,
  data: { periodId: string; overtimeRateMultiplier?: number; notes?: string | null },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const period = await prisma.payrollPeriod.findUnique({ where: { id: data.periodId } });
  if (!period) throw new AppError("Payroll period not found", 404);
  assertSameTenant(period.organizationId, tid);

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "PAY", "PAY");
    return tx.payrollRun.create({
      data: {
        organizationId: tid,
        periodId: period.id,
        code,
        overtimeRateMultiplier: new Prisma.Decimal(data.overtimeRateMultiplier ?? 1.5),
        notes: data.notes,
        createdByUserId: userId,
        status: PayrollRunStatus.DRAFT,
      },
      include: { period: true },
    });
  });
}

function assertMutable(status: PayrollRunStatus) {
  if (status === PayrollRunStatus.FINALIZED) {
    throw new AppError("Finalized payroll cannot be changed", 400);
  }
  if (status === PayrollRunStatus.CANCELLED) {
    throw new AppError("Cancelled payroll cannot be changed", 400);
  }
}

/** SME payroll calculation from compensation + attendance + leaves + advances. */
export async function calculateRun(tenantId: TenantId, runId: string, userId?: string) {
  const tid = requireTenantId(tenantId);
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    include: { period: true },
  });
  if (!run) throw new AppError("Payroll run not found", 404);
  assertSameTenant(run.organizationId, tid);
  assertMutable(run.status);
  if (run.status === PayrollRunStatus.APPROVED) {
    throw new AppError("Approved run is locked until finalize; create a new run to recalculate", 400);
  }

  const employees = await prisma.employee.findMany({
    where: {
      organizationId: tid,
      status: { in: [EmploymentStatus.ACTIVE, EmploymentStatus.PROBATION, EmploymentStatus.ON_LEAVE] },
    },
    include: { compensation: true },
  });

  const attendance = await prisma.attendanceRecord.findMany({
    where: {
      organizationId: tid,
      workDate: { gte: run.period.startDate, lte: run.period.endDate },
    },
  });
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      organizationId: tid,
      status: LeaveRequestStatus.APPROVED,
      startDate: { lte: run.period.endDate },
      endDate: { gte: run.period.startDate },
    },
    include: { leaveType: true },
  });
  const advances = await prisma.salaryAdvance.findMany({
    where: { organizationId: tid, status: AdvanceStatus.OPEN },
  });

  const attByEmp = new Map<string, typeof attendance>();
  for (const a of attendance) {
    const list = attByEmp.get(a.employeeId) ?? [];
    list.push(a);
    attByEmp.set(a.employeeId, list);
  }

  return prisma.$transaction(async (tx) => {
    await tx.payrollLineItem.deleteMany({ where: { organizationId: tid, line: { runId } } });
    await tx.payrollLine.deleteMany({ where: { runId } });

    const workingDaysApprox = Math.max(
      1,
      Math.round(
        (run.period.endDate.getTime() - run.period.startDate.getTime()) / 86400000 + 1
      ) *
        (5 / 7)
    );

    for (const emp of employees) {
      const basic = Number(emp.compensation?.baseSalary ?? 0);
      const dailyRate = basic / workingDaysApprox;
      const hourlyRate = basic / (workingDaysApprox * 8);

      const empAtt = attByEmp.get(emp.id) ?? [];
      const workedMinutes = empAtt.reduce((s, a) => s + a.workedMinutes, 0);
      const overtimeMinutes = empAtt.reduce((s, a) => s + a.overtimeMinutes, 0);
      const absentDays = empAtt.filter((a) => a.status === AttendanceStatus.ABSENT).length;

      // Unpaid leave days overlapping period
      let unpaidLeaveDays = 0;
      for (const lv of leaves) {
        if (lv.employeeId !== emp.id) continue;
        if (lv.leaveType.isPaid) continue;
        unpaidLeaveDays += Number(lv.days);
      }

      const absenceDeduction = dailyRate * (absentDays + unpaidLeaveDays);
      const overtimeAmount =
        (overtimeMinutes / 60) * hourlyRate * Number(run.overtimeRateMultiplier);

      const empAdvances = advances.filter((a) => a.employeeId === emp.id);
      const advanceTotal = empAdvances.reduce((s, a) => s + Number(a.amount), 0);

      const allowances = 0;
      const bonuses = 0;
      const otherDeductions = 0;
      const gross = basic + allowances + bonuses + overtimeAmount;
      const net = gross - advanceTotal - absenceDeduction - otherDeductions;

      const line = await tx.payrollLine.create({
        data: {
          organizationId: tid,
          runId,
          employeeId: emp.id,
          basicSalary: d(basic),
          allowances: d(allowances),
          bonuses: d(bonuses),
          overtimeAmount: d(overtimeAmount),
          advances: d(advanceTotal),
          absenceDeduction: d(absenceDeduction),
          otherDeductions: d(otherDeductions),
          grossPay: d(gross),
          netPay: d(Math.max(0, net)),
          workedMinutes,
          overtimeMinutes,
          absentDays: d(absentDays + unpaidLeaveDays),
        },
      });

      const items: Array<{
        kind: PayrollItemKind;
        label: string;
        amount: number;
        isEarning: boolean;
      }> = [
        { kind: PayrollItemKind.BASIC, label: "Basic salary", amount: basic, isEarning: true },
      ];
      if (overtimeAmount > 0) {
        items.push({
          kind: PayrollItemKind.OVERTIME,
          label: "Overtime",
          amount: overtimeAmount,
          isEarning: true,
        });
      }
      if (advanceTotal > 0) {
        items.push({
          kind: PayrollItemKind.ADVANCE,
          label: "Salary advance",
          amount: advanceTotal,
          isEarning: false,
        });
      }
      if (absenceDeduction > 0) {
        items.push({
          kind: PayrollItemKind.ABSENCE_DEDUCTION,
          label: "Absence / unpaid leave",
          amount: absenceDeduction,
          isEarning: false,
        });
      }

      await tx.payrollLineItem.createMany({
        data: items.map((i) => ({
          organizationId: tid,
          lineId: line.id,
          kind: i.kind,
          label: i.label,
          amount: d(i.amount),
          isEarning: i.isEarning,
        })),
      });
    }

    return tx.payrollRun.update({
      where: { id: runId },
      data: {
        status: PayrollRunStatus.CALCULATED,
        calculatedAt: new Date(),
      },
      include: {
        period: true,
        lines: { include: { employee: true, items: true } },
      },
    });
  });
}

export async function submitForReview(tenantId: TenantId, runId: string) {
  const tid = requireTenantId(tenantId);
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new AppError("Payroll run not found", 404);
  assertSameTenant(run.organizationId, tid);
  assertMutable(run.status);
  if (run.status !== PayrollRunStatus.CALCULATED) {
    throw new AppError("Calculate payroll before review", 400);
  }
  return prisma.payrollRun.update({
    where: { id: runId },
    data: { status: PayrollRunStatus.IN_REVIEW, reviewedAt: new Date() },
    include: { lines: true, period: true },
  });
}

export async function approveRun(
  tenantId: TenantId,
  runId: string,
  userId?: string,
  opts?: WorkflowOpts
) {
  const tid = requireTenantId(tenantId);
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new AppError("Payroll run not found", 404);
  assertSameTenant(run.organizationId, tid);
  assertMutable(run.status);
  if (run.status !== PayrollRunStatus.IN_REVIEW && run.status !== PayrollRunStatus.CALCULATED) {
    throw new AppError("Payroll must be calculated/in review to approve", 400);
  }

  if (!opts?.fromWorkflow) {
    const approval = await startApprovalIfConfigured(tid, {
      documentType: WorkflowDocumentType.PAYROLL_RUN,
      documentId: runId,
      submittedByUserId: userId,
    });
    if (approval) {
      const reviewed =
        run.status === PayrollRunStatus.IN_REVIEW
          ? run
          : await prisma.payrollRun.update({
              where: { id: runId },
              data: { status: PayrollRunStatus.IN_REVIEW, reviewedAt: new Date() },
            });
      return { ...reviewed, pendingApproval: true, approvalId: approval.id };
    }
  }

  return prisma.payrollRun.update({
    where: { id: runId },
    data: {
      status: PayrollRunStatus.APPROVED,
      approvedAt: new Date(),
      approvedByUserId: userId,
    },
    include: { lines: true, period: true },
  });
}

export async function rejectRunWorkflow(
  tenantId: TenantId,
  runId: string,
  reason?: string
) {
  const tid = requireTenantId(tenantId);
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new AppError("Payroll run not found", 404);
  assertSameTenant(run.organizationId, tid);
  // Stay in review; rejection is recorded on the approval instance
  return prisma.payrollRun.update({
    where: { id: runId },
    data: {
      status: PayrollRunStatus.IN_REVIEW,
      notes: reason ? `Approval rejected: ${reason}` : "Approval rejected",
    },
    include: { lines: true, period: true },
  });
}

export async function finalizeRun(tenantId: TenantId, runId: string, userId?: string) {
  const tid = requireTenantId(tenantId);
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    include: { lines: true },
  });
  if (!run) throw new AppError("Payroll run not found", 404);
  assertSameTenant(run.organizationId, tid);
  if (run.status === PayrollRunStatus.FINALIZED) throw new AppError("Already finalized", 409);
  if (run.status !== PayrollRunStatus.APPROVED) {
    throw new AppError("Payroll must be approved before finalization", 400);
  }

  return prisma.$transaction(async (tx) => {
    // Mark open advances included in this run as deducted
    for (const line of run.lines) {
      if (Number(line.advances) <= 0) continue;
      await tx.salaryAdvance.updateMany({
        where: {
          organizationId: tid,
          employeeId: line.employeeId,
          status: AdvanceStatus.OPEN,
        },
        data: { status: AdvanceStatus.DEDUCTED, deductedInRunId: runId },
      });
    }

    return tx.payrollRun.update({
      where: { id: runId },
      data: {
        status: PayrollRunStatus.FINALIZED,
        finalizedAt: new Date(),
        finalizedByUserId: userId,
      },
      include: {
        period: true,
        lines: { include: { employee: true, items: true } },
      },
    });
  });
}

export async function getRun(tenantId: TenantId, runId: string) {
  const tid = requireTenantId(tenantId);
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    include: {
      period: true,
      lines: {
        include: {
          employee: {
            select: { id: true, employeeNumber: true, firstName: true, lastName: true, nameAr: true },
          },
          items: true,
        },
      },
    },
  });
  if (!run) throw new AppError("Payroll run not found", 404);
  assertSameTenant(run.organizationId, tid);
  return run;
}

export async function listRuns(tenantId: TenantId) {
  return prisma.payrollRun.findMany({
    where: { organizationId: requireTenantId(tenantId) },
    include: { period: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Print-ready payslip JSON for a payroll line. */
export async function getPayslipPrint(tenantId: TenantId, lineId: string) {
  const tid = requireTenantId(tenantId);
  const line = await prisma.payrollLine.findUnique({
    where: { id: lineId },
    include: {
      items: true,
      employee: true,
      run: { include: { period: true } },
    },
  });
  if (!line) throw new AppError("Payslip line not found", 404);
  assertSameTenant(line.organizationId, tid);

  const org = await prisma.organization.findUnique({ where: { id: tid } });

  return {
    documentType: "PAYSLIP",
    localeHints: ["en", "ar"],
    company: { name: org?.name, code: org?.code },
    period: {
      code: line.run.period.code,
      startDate: line.run.period.startDate,
      endDate: line.run.period.endDate,
    },
    run: { code: line.run.code, status: line.run.status, currency: line.run.currency },
    employee: {
      number: line.employee.employeeNumber,
      name: `${line.employee.firstName} ${line.employee.lastName}`,
      nameAr: line.employee.nameAr,
    },
    earnings: line.items.filter((i) => i.isEarning),
    deductions: line.items.filter((i) => !i.isEarning),
    totals: {
      basicSalary: Number(line.basicSalary),
      grossPay: Number(line.grossPay),
      netPay: Number(line.netPay),
      overtimeMinutes: line.overtimeMinutes,
      absentDays: Number(line.absentDays),
    },
    generatedAt: new Date().toISOString(),
  };
}
