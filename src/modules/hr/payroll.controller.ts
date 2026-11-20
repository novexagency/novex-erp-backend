import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../utils/AppError.js";
import * as attendance from "./attendance.service.js";
import * as leave from "./leave.service.js";
import * as payroll from "./payroll.service.js";
import * as schedules from "./schedules.service.js";

function tid(req: Request) {
  if (!req.tenant) throw new AppError("Tenant context required", 403);
  return req.tenant.tenantId;
}
function uid(req: Request) {
  if (!req.user?.id) throw new AppError("Authenticated user required", 401);
  return req.user.id;
}
function param(v: string | string[] | undefined) {
  if (typeof v === "string" && v) return v;
  throw new AppError("Missing route parameter", 400);
}
function qstr(v: unknown) {
  return typeof v === "string" ? v : undefined;
}

// Schedules
export const listSchedules = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await schedules.listSchedules(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createSchedule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await schedules.createSchedule(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const addShift = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await schedules.addShift(tid(req), param(req.params.id), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const assignSchedule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await schedules.assignSchedule(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

// Attendance
export const myAttendance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await attendance.myAttendance(tid(req), uid(req));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const myCheckIn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await attendance.myCheckIn(tid(req), uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const myCheckOut = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await attendance.myCheckOut(tid(req), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const checkIn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = {
      ...req.body,
      source: req.body?.source ?? "MANUAL",
    };
    const item = await attendance.checkIn(tid(req), body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const checkOut = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await attendance.checkOut(tid(req), req.body, uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listAttendance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await attendance.listAttendance(tid(req), {
      employeeId: qstr(req.query.employeeId),
      from: qstr(req.query.from),
      to: qstr(req.query.to),
      status: qstr(req.query.status),
    });
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const markAbsent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await attendance.markAbsent(tid(req), req.body, uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const requestCorrection = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await attendance.requestCorrection(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const decideCorrection = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await attendance.decideCorrection(
      tid(req),
      param(req.params.id),
      req.body.decision,
      req.body.note,
      uid(req)
    );
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const missingAttendance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = qstr(req.query.from);
    const to = qstr(req.query.to);
    if (!from || !to) throw new AppError("from and to query params required", 400);
    const data = await attendance.missingAttendanceReport(tid(req), from, to);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
export const devicePunch = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await attendance.ingestDevicePunch(tid(req), {
      ...req.body,
      punchedAt: new Date(req.body.punchedAt),
    });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};

// Leave
export const seedLeaveTypes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await leave.seedDefaultLeaveTypes(tid(req));
    res.status(201).json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const listLeaveTypes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await leave.listLeaveTypes(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createLeaveType = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await leave.createLeaveType(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listLeaveBalances = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const year = req.query.year ? Number(req.query.year) : undefined;
    const items = await leave.listBalances(tid(req), qstr(req.query.employeeId), year);
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const createLeaveRequest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await leave.createLeaveRequest(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listLeaveRequests = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await leave.listLeaveRequests(tid(req), {
      employeeId: qstr(req.query.employeeId),
      status: qstr(req.query.status),
    });
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const submitLeaveRequest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await leave.submitLeaveRequest(tid(req), param(req.params.id), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const decideLeaveRequest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await leave.decideLeaveRequest(
      tid(req),
      param(req.params.id),
      req.body.decision,
      req.body.note,
      uid(req)
    );
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

// Payroll
export const listPayrollPeriods = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await payroll.listPeriods(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createPayrollPeriod = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await payroll.createPeriod(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const createAdvance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await payroll.createAdvance(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listPayrollRuns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await payroll.listRuns(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createPayrollRun = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await payroll.createRun(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const getPayrollRun = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await payroll.getRun(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const calculatePayrollRun = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await payroll.calculateRun(tid(req), param(req.params.id), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const reviewPayrollRun = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await payroll.submitForReview(tid(req), param(req.params.id));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const approvePayrollRun = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await payroll.approveRun(tid(req), param(req.params.id), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const finalizePayrollRun = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await payroll.finalizeRun(tid(req), param(req.params.id), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const printPayslip = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await payroll.getPayslipPrint(tid(req), param(req.params.lineId));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};
