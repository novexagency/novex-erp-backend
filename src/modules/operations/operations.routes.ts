import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { requireAnyPermission } from "../../middleware/requirePermission.js";
import { requireTenant, tenantContext } from "../../middleware/tenantContext.js";
import { validate } from "../../middleware/validate.js";
import * as c from "./operations.controller.js";
import {
  assetCategorySchema,
  assetDocumentSchema,
  assigneesSchema,
  commentSchema,
  createAssetSchema,
  createProjectSchema,
  createTaskSchema,
  maintenanceRequestSchema,
  maintenanceScheduleSchema,
  maintenanceStatusSchema,
  milestoneSchema,
  projectMemberSchema,
  updateAssetSchema,
  updateProjectSchema,
  updateTaskSchema,
} from "./operations.validation.js";

const router = Router();
router.use(authGuard, tenantContext, requireTenant);

const view = requireAnyPermission("operations:read", "operations:manage");
const manage = requireAnyPermission("operations:manage");
const maintView = requireAnyPermission(
  "maintenance:view",
  "maintenance:manage",
  "operations:read",
  "operations:manage"
);
const maintManage = requireAnyPermission("maintenance:manage", "operations:manage");

// Dashboard
router.get("/dashboard", view, c.getDashboard);

// Tasks
router.get("/tasks", view, c.listTasks);
router.post("/tasks", manage, validate(createTaskSchema), c.createTask);
router.get("/tasks/:id", view, c.getTask);
router.patch("/tasks/:id", manage, validate(updateTaskSchema), c.updateTask);
router.put("/tasks/:id/assignees", manage, validate(assigneesSchema), c.setAssignees);
router.post("/tasks/:id/comments", manage, validate(commentSchema), c.addComment);

// Projects
router.get("/projects", view, c.listProjects);
router.post("/projects", manage, validate(createProjectSchema), c.createProject);
router.get("/projects/:id", view, c.getProject);
router.patch("/projects/:id", manage, validate(updateProjectSchema), c.updateProject);
router.post(
  "/projects/:id/members",
  manage,
  validate(projectMemberSchema),
  c.addProjectMember
);
router.post(
  "/projects/:id/milestones",
  manage,
  validate(milestoneSchema),
  c.createMilestone
);
router.get("/projects/:id/report", view, c.projectReport);

// Assets
router.get("/asset-categories", view, c.listAssetCategories);
router.post("/asset-categories", manage, validate(assetCategorySchema), c.createAssetCategory);
router.get("/assets", view, c.listAssets);
router.post("/assets", manage, validate(createAssetSchema), c.createAsset);
router.get("/assets/:id", view, c.getAsset);
router.patch("/assets/:id", manage, validate(updateAssetSchema), c.updateAsset);
router.post(
  "/assets/:id/documents",
  manage,
  validate(assetDocumentSchema),
  c.addAssetDocument
);

// Maintenance
router.get("/maintenance", maintView, c.listMaintenance);
router.post("/maintenance", maintManage, validate(maintenanceRequestSchema), c.createMaintenance);
router.patch(
  "/maintenance/:id/status",
  maintManage,
  validate(maintenanceStatusSchema),
  c.updateMaintenanceStatus
);
router.get("/maintenance-schedules", maintView, c.listMaintenanceSchedules);
router.post(
  "/maintenance-schedules",
  maintManage,
  validate(maintenanceScheduleSchema),
  c.createMaintenanceSchedule
);
router.post(
  "/maintenance-schedules/:id/complete",
  maintManage,
  c.completeMaintenanceSchedule
);

export default router;
