import { z } from "zod";

const statusEnum = z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]);
const optionalStr = (max: number) => z.string().trim().max(max).nullable().optional();

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(160),
  nameAr: optionalStr(160),
  code: optionalStr(40),
  description: optionalStr(1000),
  descriptionAr: optionalStr(1000),
  parentId: z.string().uuid().nullable().optional(),
  status: statusEnum.optional(),
  sortOrder: z.number().int().optional(),
});

export const brandSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameAr: optionalStr(120),
  code: optionalStr(40),
  status: statusEnum.optional(),
});

export const unitSchema = z.object({
  name: z.string().trim().min(1).max(80),
  nameAr: optionalStr(80),
  code: z.string().trim().min(1).max(20),
  symbol: optionalStr(20),
  status: statusEnum.optional(),
});

export const unitConversionSchema = z.object({
  fromUnitId: z.string().uuid(),
  toUnitId: z.string().uuid(),
  factor: z.number().positive(),
});

export const taxSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameAr: optionalStr(120),
  code: z.string().trim().min(1).max(40),
  rate: z.number().min(0).max(100),
  isInclusive: z.boolean().optional(),
  status: statusEnum.optional(),
});

export const paymentMethodSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameAr: optionalStr(120),
  code: z.string().trim().min(1).max(40),
  status: statusEnum.optional(),
});

export const expenseCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameAr: optionalStr(120),
  code: optionalStr(40),
  description: optionalStr(500),
  status: statusEnum.optional(),
});

export const currencySchema = z.object({
  code: z.string().trim().min(3).max(8),
  name: z.string().trim().min(1).max(80),
  nameAr: optionalStr(80),
  symbol: optionalStr(10),
  decimalPlaces: z.number().int().min(0).max(6).optional(),
  isBase: z.boolean().optional(),
  exchangeRate: z.number().positive().optional(),
  status: statusEnum.optional(),
});

export const jobTitleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameAr: optionalStr(120),
  code: optionalStr(40),
  departmentId: z.string().uuid().nullable().optional(),
  status: statusEnum.optional(),
});

export const departmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: optionalStr(40),
});

export const productSchema = z.object({
  name: z.string().trim().min(1).max(200),
  nameAr: optionalStr(200),
  sku: z.string().trim().min(1).max(80),
  productCode: optionalStr(80),
  description: optionalStr(2000),
  descriptionAr: optionalStr(2000),
  categoryId: z.string().uuid().nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
  unitId: z.string().uuid(),
  taxRateId: z.string().uuid().nullable().optional(),
  purchasePrice: z.number().min(0).optional(),
  sellingPrice: z.number().min(0).optional(),
  minStock: z.number().min(0).optional(),
  maxStock: z.number().min(0).nullable().optional(),
  reorderLevel: z.number().min(0).nullable().optional(),
  imageUrl: optionalStr(500),
  costingMethod: z.enum(["FIFO", "WEIGHTED_AVERAGE", "STANDARD"]).optional(),
  status: statusEnum.optional(),
  barcodes: z
    .array(
      z.object({
        barcode: z.string().trim().min(1).max(80),
        isPrimary: z.boolean().optional(),
      })
    )
    .optional(),
});

export const productVariantSchema = z.object({
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().min(1).max(80),
  attributes: z.record(z.string(), z.unknown()).optional(),
  purchasePrice: z.number().min(0).nullable().optional(),
  sellingPrice: z.number().min(0).nullable().optional(),
  status: statusEnum.optional(),
});

export const documentSequenceSchema = z.object({
  module: z.string().trim().min(1).max(60),
  prefix: z.string().trim().min(1).max(20),
  year: z.number().int().optional().nullable(),
  padding: z.number().int().min(2).max(10).optional(),
  currentNumber: z.number().int().min(0).optional(),
});

export const bulkImportSchema = z.object({
  entity: z.enum([
    "products",
    "categories",
    "brands",
    "units",
    "taxes",
    "payment_methods",
    "expense_categories",
    "currencies",
  ]),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
  dryRun: z.boolean().optional(),
});
