import { z } from "zod";

export const periodQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  asOf: z.string().optional(),
  accountId: z.string().uuid().optional(),
  year: z.coerce.number().int().optional(),
  bucket: z.enum(["day", "week", "month"]).optional(),
  format: z.enum(["json", "csv", "xlsx", "pdf"]).optional(),
});

export const compareQuerySchema = z.object({
  from: z.string().min(8),
  to: z.string().min(8),
  format: z.enum(["json", "csv", "xlsx", "pdf"]).optional(),
});

export const createScheduleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  reportPath: z.string().trim().min(1).max(200),
  format: z.enum(["csv", "xlsx", "pdf"]),
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  hour: z.number().int().min(0).max(23).optional().default(8),
  dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  range: z.enum(["PREVIOUS_DAY", "PREVIOUS_WEEK", "PREVIOUS_MONTH"]),
  recipientUserIds: z.array(z.string().uuid()).min(1),
});

export const updateScheduleSchema = createScheduleSchema
  .partial()
  .extend({
    isActive: z.boolean().optional(),
  });
