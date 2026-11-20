import { z } from "zod";

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(255).nullable().optional(),
  permissionCodes: z.array(z.string().min(3)).default([]),
});

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(255).nullable().optional(),
  permissionCodes: z.array(z.string().min(3)).optional(),
});

export const assignRoleSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
});

export const unassignRoleSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
});
