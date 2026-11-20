import { z } from "zod";

const optionalStr = (max: number) => z.string().trim().max(max).nullable().optional();
const positiveQty = z.number().positive();

export const barcodeGenerateSchema = z.object({
  productId: z.string().uuid(),
  symbology: z.enum(["CODE128"]).optional().default("CODE128"),
  copies: z.number().int().positive().max(100).optional().default(1),
  forceNew: z.boolean().optional().default(false),
});

export const barcodeLabelsSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        barcode: z.string().trim().min(1).max(64),
        copies: z.number().int().positive().max(100).optional().default(1),
      })
    )
    .min(1),
  layout: z
    .object({
      columns: z.number().int().positive().max(4).optional(),
      widthMm: z.number().positive().max(200).optional(),
      heightMm: z.number().positive().max(200).optional(),
    })
    .optional(),
});

export const barcodeScanSchema = z.object({
  barcode: z.string().trim().min(1).max(64),
  source: z.enum(["MANUAL", "CAMERA"]),
  result: z.enum(["FOUND", "NOT_FOUND"]),
  productId: z.string().uuid().nullable().optional(),
});

export const openingStockSchema = z.object({
  notes: optionalStr(2000),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: positiveQty,
        unitCost: z.number().min(0),
        batchNumber: optionalStr(80),
        expiryDate: z.string().datetime().nullable().optional(),
        note: optionalStr(500),
      })
    )
    .min(1),
});

export const stockAdjustmentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  reasonCode: z.enum(["MANUAL", "DAMAGED", "EXPIRED", "OTHER"]).optional(),
  notes: optionalStr(2000),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        direction: z.enum(["IN", "OUT"]),
        quantity: positiveQty,
        unitCost: z.number().min(0).nullable().optional(),
        inventoryLotId: z.string().uuid().nullable().optional(),
        note: optionalStr(500),
      })
    )
    .min(1),
});

export const stockIssueSchema = z.object({
  salesOrderId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  reservationId: z.string().uuid().nullable().optional(),
  reason: optionalStr(500),
  notes: optionalStr(2000),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: positiveQty,
        note: optionalStr(500),
      })
    )
    .min(1),
});

export const stockReturnSchema = z.object({
  salesReturnId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  stockIssueId: z.string().uuid().nullable().optional(),
  reason: optionalStr(500),
  notes: optionalStr(2000),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: positiveQty,
        unitCost: z.number().min(0).nullable().optional(),
        batchNumber: optionalStr(80),
        expiryDate: z.string().datetime().nullable().optional(),
        note: optionalStr(500),
      })
    )
    .min(1),
});

export const reservationSchema = z.object({
  salesOrderId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  notes: optionalStr(2000),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: positiveQty,
        note: optionalStr(500),
      })
    )
    .min(1),
});

export const stockCountCreateSchema = z.object({
  notes: optionalStr(2000),
  productIds: z.array(z.string().uuid()).optional(),
});

export const stockCountLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        countedQuantity: z.number().min(0),
        note: optionalStr(500),
      })
    )
    .min(1),
});
