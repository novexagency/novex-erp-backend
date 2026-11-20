import { z } from "zod";

const optionalNullableString = (max: number) =>
  z.string().trim().max(max).nullable().optional();

export const updateCompanyProfileSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  logoUrl: z.union([z.string().url(), z.literal(""), z.null()]).optional(),
  commercialRegister: optionalNullableString(120),
  taxNumber: optionalNullableString(120),
  addressLine1: optionalNullableString(255),
  addressLine2: optionalNullableString(255),
  city: optionalNullableString(120),
  country: z.string().trim().max(120).optional(),
  postalCode: optionalNullableString(40),
  phonePrimary: optionalNullableString(40),
  phoneSecondary: optionalNullableString(40),
  emailContact: z.union([z.string().email(), z.literal(""), z.null()]).optional(),
  website: z.union([z.string().url(), z.literal(""), z.null()]).optional(),
  businessActivity: optionalNullableString(255),
  description: optionalNullableString(2000),
});

export const updateSystemConfigSchema = z.object({
  currency: z.string().trim().min(3).max(8).optional(),
  timezone: z.string().trim().min(2).max(64).optional(),
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).optional(),
  numberFormat: z.enum(["1,234.56", "1.234,56", "1 234.56"]).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  fiscalYearStartDay: z.number().int().min(1).max(28).optional(),
  defaultLocale: z.enum(["en", "ar"]).optional(),
  textDirection: z.enum(["auto", "ltr", "rtl"]).optional(),
  taxEnabled: z.boolean().optional(),
  defaultTaxRate: z.number().min(0).max(100).nullable().optional(),
  taxRegistrationNumber: optionalNullableString(120),
  taxInclusivePricing: z.boolean().optional(),
  invoicePrefix: z.string().trim().min(1).max(16).optional(),
  invoicePadding: z.number().int().min(2).max(10).optional(),
  documentPadding: z.number().int().min(2).max(10).optional(),
  allowNegativeStock: z.boolean().optional(),
  defaultCostingMethod: z.enum(["WEIGHTED_AVERAGE", "FIFO", "STANDARD"]).optional(),
  maxActiveBranches: z.number().int().min(1).max(100).optional(),
});

export const upsertWarehouseSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().min(1).max(40),
  address: optionalNullableString(255),
  city: optionalNullableString(120),
  country: z.string().trim().max(120).optional(),
  managerUserId: z.string().uuid().nullable().optional(),
  managerName: optionalNullableString(160),
  isActive: z.boolean().optional(),
});

export const updateWarehouseSchema = upsertWarehouseSchema.partial();

export const warehouseLocationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(40),
  isActive: z.boolean().optional(),
});

export const updateWarehouseLocationSchema = warehouseLocationSchema.partial();
