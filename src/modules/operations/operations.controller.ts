import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../utils/AppError.js";
import * as assets from "./assets.service.js";
import * as dashboard from "./dashboard.service.js";
import * as maintenance from "./maintenance.service.js";
import * as projects from "./projects.service.js";
import * as tasks from "./tasks.service.js";

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

export const getDashboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await dashboard.operationsDashboard(tid(req)) });
  } catch (e) {
    next(e);
  }
};

// Tasks
export const listTasks = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await tasks.listTasks(tid(req), {
      status: qstr(req.query.status),
      projectId: qstr(req.query.projectId),
      employeeId: qstr(req.query.employeeId),
      overdue: req.query.overdue === "true",
    });
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const getTask = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { item: await tasks.getTask(tid(req), param(req.params.id)) } });
  } catch (e) {
    next(e);
  }
};
export const createTask = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await tasks.createTask(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateTask = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await tasks.updateTask(tid(req), param(req.params.id), req.body, uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const setAssignees = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await tasks.setAssignees(
      tid(req),
      param(req.params.id),
      req.body.assigneeIds,
      uid(req)
    );
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const addComment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await tasks.addComment(
      tid(req),
      param(req.params.id),
      req.body.body,
      uid(req),
      req.body.employeeId
    );
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

// Projects
export const listProjects = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: { items: await projects.listProjects(tid(req), qstr(req.query.status)) },
    });
  } catch (e) {
    next(e);
  }
};
export const getProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: { item: await projects.getProject(tid(req), param(req.params.id)) },
    });
  } catch (e) {
    next(e);
  }
};
export const createProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await projects.createProject(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await projects.updateProject(tid(req), param(req.params.id), req.body);
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const addProjectMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await projects.addProjectMember(
      tid(req),
      param(req.params.id),
      req.body.employeeId,
      req.body.roleLabel
    );
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const createMilestone = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await projects.createMilestone(tid(req), param(req.params.id), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const projectReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: await projects.projectReport(tid(req), param(req.params.id)),
    });
  } catch (e) {
    next(e);
  }
};

// Assets
export const listAssetCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: { items: await assets.listCategories(tid(req)) } });
  } catch (e) {
    next(e);
  }
};
export const createAssetCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await assets.createCategory(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const listAssets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await assets.listAssets(tid(req), {
      status: qstr(req.query.status),
      categoryId: qstr(req.query.categoryId),
    });
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const getAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      data: { item: await assets.getAsset(tid(req), param(req.params.id)) },
    });
  } catch (e) {
    next(e);
  }
};
export const createAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await assets.createAsset(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await assets.updateAsset(tid(req), param(req.params.id), req.body, uid(req));
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const addAssetDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await assets.addAssetDocument(tid(req), param(req.params.id), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};

// Maintenance
export const listMaintenance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await maintenance.listMaintenance(tid(req), {
      status: qstr(req.query.status),
      assetId: qstr(req.query.assetId),
      type: qstr(req.query.type),
    });
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const createMaintenance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await maintenance.createMaintenanceRequest(tid(req), req.body, uid(req));
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const updateMaintenanceStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await maintenance.updateMaintenanceStatus(
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
export const listMaintenanceSchedules = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await maintenance.listSchedules(tid(req), qstr(req.query.dueBefore));
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
};
export const createMaintenanceSchedule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await maintenance.createPreventiveSchedule(tid(req), req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
export const completeMaintenanceSchedule = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const item = await maintenance.completeScheduleOccurrence(
      tid(req),
      param(req.params.id),
      uid(req)
    );
    res.json({ success: true, data: { item } });
  } catch (e) {
    next(e);
  }
};
