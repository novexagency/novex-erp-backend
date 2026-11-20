import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { requireAnyPermission } from "../../middleware/requirePermission.js";
import { requireTenant, tenantContext } from "../../middleware/tenantContext.js";
import { validate } from "../../middleware/validate.js";
import * as c from "./hr.controller.js";
import * as p from "./payroll.controller.js";
import {
  advanceSchema,
  assignScheduleSchema,
  checkInSchema,
  checkOutSchema,
  compensationSchema,
  correctionSchema,
  createEmployeeSchema,
  createRequestSchema,
  decideRequestSchema,
  devicePunchSchema,
  documentSchema,
  leaveRequestSchema,
  leaveTypeSchema,
  markAbsentSchema,
  noteSchema,
  payrollPeriodSchema,
  payrollRunSchema,
  scheduleSchema,
  shiftSchema,
  teamMemberSchema,
  teamSchema,
  updateEmployeeSchema,
  updateTeamSchema,
} from "./hr.validation.js";

const router = Router();
router.use(authGuard, tenantContext, requireTenant);

const view = requireAnyPermission("hr:read", "hr:view", "hr:manage");
const manage = requireAnyPermission("hr:create", "hr:update", "hr:manage");
const salary = requireAnyPermission("hr:salary", "hr:manage");
const docs = requireAnyPermission("hr:documents", "hr:manage");
const approve = requireAnyPermission("hr:approve", "hr:manage");
const attendancePerm = requireAnyPermission("hr:attendance", "hr:manage", "hr:update");
const leavePerm = requireAnyPermission("hr:leave", "hr:manage", "hr:create");
const payrollPerm = requireAnyPermission("hr:payroll", "hr:salary", "hr:manage");

// Org chart & directory
router.get("/org-chart", view, c.orgChart);
router.get("/employees", view, c.listEmployees);
router.post("/employees", manage, validate(createEmployeeSchema), c.createEmployee);
router.get("/employees/:id", view, c.getEmployee);
router.patch("/employees/:id", manage, validate(updateEmployeeSchema), c.updateEmployee);
router.put(
  "/employees/:id/compensation",
  salary,
  validate(compensationSchema),
  c.upsertCompensation
);

// Documents
router.get("/documents/expiring", docs, c.expiringDocuments);
router.get("/employees/:id/documents", docs, c.listDocuments);
router.post("/employees/:id/documents", docs, validate(documentSchema), c.addDocument);
router.post("/documents/:documentId/archive", docs, c.archiveDocument);

// Teams
router.get("/teams", view, c.listTeams);
router.post("/teams", manage, validate(teamSchema), c.createTeam);
router.patch("/teams/:id", manage, validate(updateTeamSchema), c.updateTeam);
router.post("/teams/:id/members", manage, validate(teamMemberSchema), c.addTeamMember);
router.delete("/teams/:id/members/:employeeId", manage, c.removeTeamMember);

// HR requests
router.get("/requests", view, c.listRequests);
router.post("/requests", manage, validate(createRequestSchema), c.createRequest);
router.get("/requests/:id", view, c.getRequest);
router.post("/requests/:id/submit", manage, c.submitRequest);
router.post("/requests/:id/review", approve, c.reviewRequest);
router.post("/requests/:id/decide", approve, validate(decideRequestSchema), c.decideRequest);
router.post("/requests/:id/cancel", manage, validate(noteSchema), c.cancelRequest);

// —— Phase 14: schedules / attendance ——
router.get("/schedules", view, p.listSchedules);
router.post("/schedules", attendancePerm, validate(scheduleSchema), p.createSchedule);
router.post("/schedules/:id/shifts", attendancePerm, validate(shiftSchema), p.addShift);
router.post("/schedule-assignments", attendancePerm, validate(assignScheduleSchema), p.assignSchedule);

router.get("/attendance/me", p.myAttendance);
router.post("/attendance/me/check-in", p.myCheckIn);
router.post("/attendance/me/check-out", p.myCheckOut);
router.post("/attendance/check-in", attendancePerm, validate(checkInSchema), p.checkIn);
router.post("/attendance/check-out", attendancePerm, validate(checkOutSchema), p.checkOut);
router.get("/attendance", view, p.listAttendance);
router.post("/attendance/absent", attendancePerm, validate(markAbsentSchema), p.markAbsent);
router.get("/attendance/missing", view, p.missingAttendance);
router.post("/attendance/corrections", attendancePerm, validate(correctionSchema), p.requestCorrection);
router.post(
  "/attendance/corrections/:id/decide",
  approve,
  validate(decideRequestSchema),
  p.decideCorrection
);
router.post("/attendance/device-punch", attendancePerm, validate(devicePunchSchema), p.devicePunch);

// —— Phase 14: leave ——
router.post("/leave-types/seed-defaults", leavePerm, p.seedLeaveTypes);
router.get("/leave-types", view, p.listLeaveTypes);
router.post("/leave-types", leavePerm, validate(leaveTypeSchema), p.createLeaveType);
router.get("/leave-balances", view, p.listLeaveBalances);
router.get("/leave-requests", view, p.listLeaveRequests);
router.post("/leave-requests", leavePerm, validate(leaveRequestSchema), p.createLeaveRequest);
router.post("/leave-requests/:id/submit", leavePerm, p.submitLeaveRequest);
router.post(
  "/leave-requests/:id/decide",
  approve,
  validate(decideRequestSchema),
  p.decideLeaveRequest
);

// —— Phase 14: payroll ——
router.get("/payroll/periods", payrollPerm, p.listPayrollPeriods);
router.post("/payroll/periods", payrollPerm, validate(payrollPeriodSchema), p.createPayrollPeriod);
router.post("/payroll/advances", payrollPerm, validate(advanceSchema), p.createAdvance);
router.get("/payroll/runs", payrollPerm, p.listPayrollRuns);
router.post("/payroll/runs", payrollPerm, validate(payrollRunSchema), p.createPayrollRun);
router.get("/payroll/runs/:id", payrollPerm, p.getPayrollRun);
router.post("/payroll/runs/:id/calculate", payrollPerm, p.calculatePayrollRun);
router.post("/payroll/runs/:id/review", payrollPerm, p.reviewPayrollRun);
router.post("/payroll/runs/:id/approve", approve, p.approvePayrollRun);
router.post("/payroll/runs/:id/finalize", payrollPerm, p.finalizePayrollRun);
router.get("/payroll/payslips/:lineId/print", payrollPerm, p.printPayslip);

export default router;
