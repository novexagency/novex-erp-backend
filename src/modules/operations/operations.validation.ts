import { z } from "zod";

const optionalStr = (max: number) => z.string().trim().max(max).nullable().optional();
const uuid = z.string().uuid();

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: optionalStr(4000),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]).optional(),
  progressPct: z.number().int().min(0).max(100).optional(),
  dueAt: z.string().nullable().optional(),
  projectId: uuid.nullable().optional(),
  milestoneId: uuid.nullable().optional(),
  assigneeIds: z.array(uuid).optional(),
});

export const updateTaskSchema = createTaskSchema.partial().omit({ assigneeIds: true });

export const assigneesSchema = z.object({
  assigneeIds: z.array(uuid),
});

export const commentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  employeeId: uuid.nullable().optional(),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(160),
  nameAr: optionalStr(160),
  description: optionalStr(4000),
  status: z.enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]).optional(),
  managerEmployeeId: uuid.nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  budgetAmount: z.number().min(0).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  memberIds: z.array(uuid).optional(),
});

export const updateProjectSchema = createProjectSchema
  .partial()
  .omit({ memberIds: true })
  .extend({
    actualCost: z.number().min(0).optional(),
    progressPct: z.number().int().min(0).max(100).optional(),
  });

export const projectMemberSchema = z.object({
  employeeId: uuid,
  roleLabel: optionalStr(80),
});

export const milestoneSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  dueAt: z.string().nullable().optional(),
  progressPct: z.number().int().min(0).max(100).optional(),
});

export const assetCategorySchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  nameAr: optionalStr(120),
});

export const createAssetSchema = z.object({
  name: z.string().trim().min(1).max(160),
  nameAr: optionalStr(160),
  categoryId: uuid.nullable().optional(),
  purchaseDate: z.string().nullable().optional(),
  purchaseCost: z.number().min(0).optional(),
  status: z.enum(["ACTIVE", "IN_REPAIR", "RETIRED", "DISPOSED"]).optional(),
  departmentId: uuid.nullable().optional(),
  assignedEmployeeId: uuid.nullable().optional(),
  locationNote: optionalStr(200),
  notes: optionalStr(2000),
});

export const updateAssetSchema = createAssetSchema.partial();

export const assetDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  publicId: z.string().trim().min(1).max(200),
  secureUrl: z.string().url(),
  fileName: optionalStr(200),
  bytes: z.number().int().positive().nullable().optional(),
});

export const maintenanceRequestSchema = z.object({
  assetId: uuid,
  type: z.enum(["PREVENTIVE", "CORRECTIVE"]).optional(),
  title: z.string().trim().min(1).max(200),
  description: optionalStr(4000),
  costAmount: z.number().min(0).optional(),
  scheduledAt: z.string().nullable().optional(),
  responsibleEmployeeId: uuid.nullable().optional(),
});

export const maintenanceStatusSchema = z.object({
  status: z.enum(["OPEN", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
  costAmount: z.number().min(0).optional(),
  completedAt: z.string().nullable().optional(),
  note: optionalStr(500),
});

export const maintenanceScheduleSchema = z.object({
  assetId: uuid,
  title: z.string().trim().min(1).max(200),
  intervalDays: z.number().int().positive(),
  nextDueAt: z.string().min(8),
});
