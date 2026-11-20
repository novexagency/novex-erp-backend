import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../utils/AppError.js";
import * as documents from "./documents.service.js";
import * as employees from "./employees.service.js";
import * as requests from "./requests.service.js";
import * as teams from "./teams.service.js";

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

function canSeeSalary(req: Request) {
  if (req.user?.isSuperAdmin) return true;
  const codes = new Set(req.tenant?.membership.permissionCodes ?? []);
  return codes.has("hr:salary") || codes.has("hr:manage");
}

// —— Employees ——
export const listEmployees = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await employees.listEmployees(tid(req), {
      status: qstr(req.query.status),
      departmentId: qstr(req.query.departmentId),
      q: qstr(req.query.q),
      includeSalary: canSeeSalary(req),
    });
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const getEmployee = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await employees.getEmployee(tid(req), param(req.params.id), canSeeSalary(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const createEmployee = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await employees.createEmployee(
      tid(req),
      req.body,
      uid(req),
      canSeeSalary(req)
    );
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateEmployee = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await employees.updateEmployee(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const upsertCompensation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await employees.upsertCompensation(
      tid(req),
      param(req.params.id),
      req.body,
      uid(req)
    );
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const orgChart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await employees.orgChart(tid(req)) });
  } catch (e) {
    next(e);
  }
};

// —— Teams ——
export const listTeams = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await teams.listTeams(tid(req), qstr(req.query.departmentId));
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const createTeam = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await teams.createTeam(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateTeam = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await teams.updateTeam(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const addTeamMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await teams.addTeamMember(tid(req), param(req.params.id), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const removeTeamMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await teams.removeTeamMember(
      tid(req),
      param(req.params.id),
      param(req.params.employeeId)
    );
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};

// —— Documents ——
export const listDocuments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await documents.listDocuments(tid(req), param(req.params.id), {
      includeArchived: req.query.includeArchived === "true",
    });
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const addDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await documents.addDocument(tid(req), param(req.params.id), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const archiveDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await documents.archiveDocument(tid(req), param(req.params.documentId));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const expiringDocuments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Number(req.query.withinDays ?? 30);
    const items = await documents.expiringDocuments(tid(req), Number.isFinite(days) ? days : 30);
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};

// —— Requests ——
export const listRequests = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await requests.listRequests(tid(req), {
      status: qstr(req.query.status),
      type: qstr(req.query.type),
      requesterId: qstr(req.query.requesterId),
    });
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const getRequest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: { item: await requests.getRequest(tid(req), param(req.params.id)) },
    });
  } catch (e) {
    next(e);
  }
};
export const createRequest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await requests.createRequest(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const submitRequest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await requests.submitRequest(tid(req), param(req.params.id), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const reviewRequest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await requests.startReview(tid(req), param(req.params.id), uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const decideRequest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await requests.decideRequest(
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
export const cancelRequest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await requests.cancelRequest(
      tid(req),
      param(req.params.id),
      req.body?.note,
      uid(req)
    );
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
