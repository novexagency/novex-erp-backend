import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(8).max(128),
});

export const issuePasswordResetSchema = z.object({
  userId: z.string().uuid(),
});

export const setUserActiveSchema = z.object({
  isActive: z.boolean(),
});

export const setMemberStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INVITED", "SUSPENDED"]),
});

export const createTenantUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().toLowerCase(),
  phone: z.string().trim().max(40).nullable().optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  password: z.string().min(8).max(128).nullable().optional(),
  roleIds: z.array(z.string().uuid()).min(1),
  branchId: z.string().uuid().nullable().optional(),
  membershipStatus: z.enum(["ACTIVE", "INVITED", "SUSPENDED"]).optional().default("ACTIVE"),
});

export const listTenantUsersQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export const listAuthEventsQuerySchema = z.object({
  type: z.string().trim().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export const revokeUserSessionSchema = z.object({
  allowCurrent: z.boolean().optional().default(false),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetSchema>;
export type CreateTenantUserInput = z.infer<typeof createTenantUserSchema>;
