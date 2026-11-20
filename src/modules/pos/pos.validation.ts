import { z } from "zod";

const optionalStr = (max: number) => z.string().trim().max(max).nullable().optional();
const positiveQty = z.number().positive();

export const openSessionSchema = z.object({
  openingCash: z.number().min(0),
  notes: optionalStr(2000),
});

export const cashMovementSchema = z.object({
  type: z.enum(["CASH_IN", "CASH_OUT"]),
  amount: positiveQty,
  reason: optionalStr(500),
});

export const closeSessionSchema = z.object({
  actualCash: z.number().min(0),
  notes: optionalStr(2000),
  discrepancyReason: optionalStr(500),
});

export const approveSessionSchema = z.object({
  note: optionalStr(500),
});

export const checkoutSchema = z.object({
  clientRequestId: z.string().trim().min(8).max(80).nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  allowCredit: z.boolean().optional(),
  discountAuthorized: z.boolean().optional(),
  notes: optionalStr(2000),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid().optional(),
        barcode: z.string().trim().min(1).max(80).optional(),
        quantity: positiveQty,
        unitPrice: z.number().min(0).optional(),
        allowManualPrice: z.boolean().optional(),
        discountPercent: z.number().min(0).max(100).optional(),
        discountAmount: z.number().min(0).optional(),
        taxPercent: z.number().min(0).max(100).optional(),
      })
    )
    .min(1),
  payments: z
    .array(
      z.object({
        methodCode: z.string().trim().min(1).max(40),
        methodName: optionalStr(80),
        amount: positiveQty,
        reference: optionalStr(80),
      })
    )
    .min(1),
});

export const cancelSaleSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const refundSchema = z.object({
  reason: optionalStr(500),
  refundMethodCode: z.string().trim().min(1).max(40).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: positiveQty,
      })
    )
    .min(1),
});

export const receiptConfigSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  showLogo: z.boolean().optional(),
  showTaxNumber: z.boolean().optional(),
  showAddress: z.boolean().optional(),
  headerText: optionalStr(500),
  headerTextAr: optionalStr(500),
  footerText: optionalStr(500),
  footerTextAr: optionalStr(500),
  paperWidthMm: z.number().int().min(58).max(120).optional(),
});
