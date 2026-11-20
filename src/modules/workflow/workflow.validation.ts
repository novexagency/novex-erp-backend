import { z } from "zod";

const uuid = z.string().uuid();
const optionalStr = (max: number) => z.string().trim().max(max).nullable().optional();

const documentType = z.enum([
  "PURCHASE_REQUEST",
  "PURCHASE_ORDER",
  "SALES_DISCOUNT",
  "SALES_RETURN",
  "EXPENSE",
  "PAYMENT",
  "STOCK_ADJUSTMENT",
  "LEAVE_REQUEST",
  "PAYROLL_RUN",
  "MANUAL_JOURNAL",
]);

const stepSchema = z.object({
  level: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  approverMode: z.enum(["ROLE", "USER", "MANAGER"]).optional(),
  roleId: uuid.nullable().optional(),
  userId: uuid.nullable().optional(),
  amountLimit: z.number().min(0).nullable().optional(),
  canDelegate: z.boolean().optional(),
});

export const createDefinitionSchema = z.object({
  documentType,
  name: z.string().trim().min(1).max(160),
  isActive: z.boolean().optional(),
  escalationHours: z.number().int().positive().nullable().optional(),
  steps: z.array(stepSchema).optional(),
});

export const updateDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  isActive: z.boolean().optional(),
  escalationHours: z.number().int().positive().nullable().optional(),
});

export const replaceStepsSchema = z.object({
  steps: z.array(stepSchema).min(1),
});

export const approveSchema = z.object({
  comment: optionalStr(2000),
});

export const rejectSchema = z.object({
  rejectionReason: z.string().trim().min(1).max(2000),
});

export const delegateSchema = z.object({
  toUserId: uuid,
  comment: optionalStr(2000),
});

export const createDelegationSchema = z.object({
  fromUserId: uuid,
  toUserId: uuid,
  documentType: documentType.nullable().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().nullable().optional(),
});

export const docCategorySchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  nameAr: optionalStr(120),
});

export const docTagSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  categoryId: uuid.nullable().optional(),
  visibility: z.enum(["TENANT", "RESTRICTED"]).optional(),
  expiresAt: z.string().nullable().optional(),
  tagIds: z.array(uuid).optional(),
  access: z
    .array(
      z.object({
        userId: uuid.nullable().optional(),
        roleId: uuid.nullable().optional(),
      })
    )
    .optional(),
  file: z
    .object({
      publicId: z.string().trim().min(1).max(200),
      secureUrl: z.string().url(),
      fileName: optionalStr(200),
      bytes: z.number().int().positive().nullable().optional(),
    })
    .optional(),
});

export const updateDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  categoryId: uuid.nullable().optional(),
  visibility: z.enum(["TENANT", "RESTRICTED"]).optional(),
  expiresAt: z.string().nullable().optional(),
});

export const versionSchema = z.object({
  publicId: z.string().trim().min(1).max(200),
  secureUrl: z.string().url(),
  fileName: optionalStr(200),
  bytes: z.number().int().positive().nullable().optional(),
});

export const linkSchema = z.object({
  entityType: z.string().trim().min(1).max(80),
  entityId: uuid,
});

export const jobRecipientsSchema = z.object({
  recipientUserIds: z.array(uuid).min(1),
  withinDays: z.number().int().positive().optional(),
});
