import { z } from "zod";

const uuid = z.string().uuid();

export const provisionTenantSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().min(2).max(40),
  baseCurrency: z.string().trim().min(3).max(3).optional(),
  defaultLocale: z.enum(["en", "ar"]).optional(),
  timezone: z.string().trim().min(2).max(80).optional(),
  taxNumber: z.string().trim().max(80).nullable().optional(),
  planCode: z.string().trim().min(1).max(40).optional(),
  subscriptionStatus: z
    .enum(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"])
    .optional(),
  seats: z.number().int().positive().optional(),
  trialDays: z.number().int().positive().optional(),
  modules: z
    .array(
      z.object({
        moduleCode: z.string().trim().min(1).max(40),
        enabled: z.boolean(),
      })
    )
    .optional(),
  entitlements: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(80),
        enabled: z.boolean().optional(),
        limits: z.unknown().optional(),
      })
    )
    .optional(),
  admin: z
    .object({
      email: z.string().email(),
      password: z.string().min(6).max(128),
      name: z.string().trim().min(1).max(120),
    })
    .optional(),
  seedAccountingDefaults: z.boolean().optional(),
  externalRef: z.string().trim().max(120).nullable().optional(),
});

export const subscriptionSchema = z.object({
  planCode: z.string().trim().min(1).max(40).optional(),
  status: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"]).optional(),
  seats: z.number().int().positive().optional(),
  endsAt: z.string().nullable().optional(),
  trialEndsAt: z.string().nullable().optional(),
  gracePeriodEndsAt: z.string().nullable().optional(),
  renew: z.boolean().optional(),
});

export const modulesSchema = z.object({
  modules: z
    .array(
      z.object({
        moduleCode: z.string().trim().min(1).max(40),
        enabled: z.boolean(),
      })
    )
    .min(1),
});

export const entitlementsSchema = z.object({
  entitlements: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(80),
        enabled: z.boolean().optional(),
        limits: z.unknown().optional(),
      })
    )
    .min(1),
});

export const supportAccessSchema = z.object({
  staffUserId: uuid,
  reason: z.string().trim().min(8).max(1000),
  hours: z.number().positive().max(168).optional(),
  scopes: z.unknown().optional(),
});
