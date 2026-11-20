import { z } from "zod";

export const switchTenantSchema = z.object({
  tenantId: z.string().uuid(),
});

export const updateTenantConfigSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  defaultLocale: z.enum(["en", "ar"]).optional(),
  timezone: z.string().trim().min(2).max(64).optional(),
});
