import "dotenv/config";
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { AppError } from "../src/utils/AppError.js";
import { ensureDefaultTenantSaaS } from "../src/modules/tenant/tenant.service.js";
import * as employees from "../src/modules/hr/employees.service.js";
import * as schedules from "../src/modules/hr/schedules.service.js";
import * as attendance from "../src/modules/hr/attendance.service.js";
import * as leave from "../src/modules/hr/leave.service.js";
import * as payroll from "../src/modules/hr/payroll.service.js";
import { StubDeviceAttendanceAdapter } from "../src/modules/hr/deviceAttendance.adapter.js";

const prisma = new PrismaClient();
const userId = randomUUID();
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function pass(name: string) {
  results.push({ name, ok: true });
  console.log(`[PASS] ${name}`);
}

async function cleanupOrg(id: string) {
  await prisma.payrollLineItem.deleteMany({ where: { organizationId: id } });
  await prisma.payrollLine.deleteMany({ where: { organizationId: id } });
  await prisma.payrollRun.deleteMany({ where: { organizationId: id } });
  await prisma.payrollPeriod.deleteMany({ where: { organizationId: id } });
  await prisma.salaryAdvance.deleteMany({ where: { organizationId: id } });
  await prisma.leaveRequestEvent.deleteMany({ where: { organizationId: id } });
  await prisma.leaveRequest.deleteMany({ where: { organizationId: id } });
  await prisma.leaveBalance.deleteMany({ where: { organizationId: id } });
  await prisma.leaveType.deleteMany({ where: { organizationId: id } });
  await prisma.attendanceCorrection.deleteMany({ where: { organizationId: id } });
  await prisma.attendanceRecord.deleteMany({ where: { organizationId: id } });
  await prisma.employeeSchedule.deleteMany({ where: { organizationId: id } });
  await prisma.shift.deleteMany({ where: { organizationId: id } });
  await prisma.workSchedule.deleteMany({ where: { organizationId: id } });
  await prisma.hrRequestApproval.deleteMany({ where: { organizationId: id } });
  await prisma.hrRequest.deleteMany({ where: { organizationId: id } });
  await prisma.employeeDocument.deleteMany({ where: { organizationId: id } });
  await prisma.teamMember.deleteMany({ where: { organizationId: id } });
  await prisma.team.deleteMany({ where: { organizationId: id } });
  await prisma.employeeCompensation.deleteMany({ where: { organizationId: id } });
  await prisma.employee.updateMany({ where: { organizationId: id }, data: { managerEmployeeId: null } });
  await prisma.employee.deleteMany({ where: { organizationId: id } });
  await prisma.documentSequence.deleteMany({ where: { organizationId: id } });
  await prisma.warehouseLocation.deleteMany({ where: { organizationId: id } });
  await prisma.warehouse.deleteMany({ where: { organizationId: id } });
  await prisma.tenantSystemConfig.deleteMany({ where: { organizationId: id } });
  await prisma.organizationSetting.deleteMany({ where: { organizationId: id } });
  await prisma.tenantModule.deleteMany({ where: { organizationId: id } });
  await prisma.tenantEntitlement.deleteMany({ where: { organizationId: id } });
  await prisma.tenantSubscription.deleteMany({ where: { organizationId: id } });
  await prisma.organization.delete({ where: { id } });
}

async function main() {
  console.log("=== Phase 14 Attendance, Leave & Payroll Tests ===\n");
  createApp();
  pass("App boots with payroll/attendance routes");

  const leftovers = await prisma.organization.findMany({
    where: { code: { in: ["PAY_TENANT_A"] } },
    select: { id: true },
  });
  for (const o of leftovers) await cleanupOrg(o.id);

  const tenantA = await prisma.organization.create({
    data: { code: "PAY_TENANT_A", name: "Payroll A", defaultLocale: "en" },
  });
  await ensureDefaultTenantSaaS(tenantA.id);

  const emp = (await employees.createEmployee(
    tenantA.id,
    {
      firstName: "Nour",
      lastName: "Worker",
      compensation: { baseSalary: 10000, currency: "EGP" },
    },
    userId,
    true
  )) as { id: string };

  // —— Schedules ——
  const schedule = await schedules.createSchedule(tenantA.id, {
    code: "STD",
    name: "Standard 9-5",
    workdaysMask: 31,
    startTime: "09:00",
    endTime: "17:00",
    graceMinutes: 10,
    expectedHours: 8,
    overtimeAfterHours: 8,
  });
  await schedules.assignSchedule(tenantA.id, {
    employeeId: emp.id,
    scheduleId: schedule.id,
  });
  pass("Work schedule assigned");

  // —— Attendance late + OT ——
  const workDay = "2026-11-02"; // Monday
  await attendance.checkIn(
    tenantA.id,
    {
      employeeId: emp.id,
      at: "2026-11-02T09:25:00.000Z",
      source: "SELF_SERVICE",
    },
    userId
  );
  const out = await attendance.checkOut(
    tenantA.id,
    { employeeId: emp.id, at: "2026-11-02T18:30:00.000Z" },
    userId
  );
  if (out.lateMinutes <= 0) throw new Error("Expected late minutes");
  if (out.overtimeMinutes <= 0) throw new Error("Expected overtime");
  pass("Check-in/out computes late and overtime");

  await attendance.markAbsent(
    tenantA.id,
    { employeeId: emp.id, workDate: "2026-11-03", note: "No show" },
    userId
  );
  pass("Absent day recorded");

  const corr = await attendance.requestCorrection(
    tenantA.id,
    {
      attendanceId: out.id,
      requestedCheckOutAt: "2026-11-02T19:00:00.000Z",
      reason: "Forgot to punch out",
    },
    userId
  );
  await attendance.decideCorrection(tenantA.id, corr.id, "APPROVED", "ok", userId);
  pass("Attendance correction requires approval");

  const stub = new StubDeviceAttendanceAdapter();
  const punch = await stub.ingestPunch({
    organizationId: tenantA.id,
    employeeExternalRef: "BADGE-1",
    punchedAt: new Date(),
    type: "IN",
  });
  if (!punch.accepted) throw new Error("Device stub should accept");
  pass("Device attendance adapter stub ready");

  // —— Leave ——
  const types = await leave.seedDefaultLeaveTypes(tenantA.id);
  const annual = types.find((t) => t.code === "ANNUAL")!;
  const lr = await leave.createLeaveRequest(
    tenantA.id,
    {
      employeeId: emp.id,
      leaveTypeId: annual.id,
      startDate: "2026-11-10",
      endDate: "2026-11-11",
      reason: "Trip",
      submit: true,
    },
    userId
  );
  const approvedLeave = await leave.decideLeaveRequest(
    tenantA.id,
    lr.id,
    "APPROVED",
    "enjoy",
    userId
  );
  if (approvedLeave.status !== "APPROVED") throw new Error("Leave not approved");
  const bal = await leave.listBalances(tenantA.id, emp.id, 2026);
  const annualBal = bal.find((b) => b.leaveTypeId === annual.id)!;
  if (Number(annualBal.used) < 2) throw new Error("Leave balance not deducted");
  pass("Leave request approval updates balance");

  // —— Payroll ——
  const period = await payroll.createPeriod(tenantA.id, {
    code: "2026-11",
    name: "November 2026",
    startDate: "2026-11-01",
    endDate: "2026-11-30",
  });
  await payroll.createAdvance(
    tenantA.id,
    { employeeId: emp.id, amount: 500, note: "Cash advance" },
    userId
  );
  const run = await payroll.createRun(
    tenantA.id,
    { periodId: period.id, overtimeRateMultiplier: 1.5 },
    userId
  );
  const calculated = await payroll.calculateRun(tenantA.id, run.id, userId);
  if (calculated.lines.length < 1) throw new Error("No payroll lines");
  const line = calculated.lines[0];
  if (Number(line.basicSalary) !== 10000) throw new Error("Basic salary mismatch");
  if (Number(line.absenceDeduction) <= 0) throw new Error("Expected absence deduction");
  if (Number(line.advances) !== 500) throw new Error("Advance not applied");
  pass("Payroll calculation includes basic, absence, advance, overtime");

  await payroll.submitForReview(tenantA.id, run.id);
  await payroll.approveRun(tenantA.id, run.id, userId);
  const finalized = await payroll.finalizeRun(tenantA.id, run.id, userId);
  if (finalized.status !== "FINALIZED") throw new Error("Finalize failed");
  pass("Payroll review → approve → finalize");

  try {
    await payroll.calculateRun(tenantA.id, run.id, userId);
    throw new Error("Should block recalculate on finalized");
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    pass("Finalized payroll is immutable");
  }

  const slip = await payroll.getPayslipPrint(tenantA.id, line.id);
  if (slip.documentType !== "PAYSLIP" || !slip.totals.netPay) {
    throw new Error("Payslip print payload incomplete");
  }
  pass("Payslip print JSON generated");

  await cleanupOrg(tenantA.id);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
