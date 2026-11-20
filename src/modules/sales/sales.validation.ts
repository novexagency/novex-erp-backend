import { z } from "zod";

const optionalStr = (max: number) => z.string().trim().max(max).nullable().optional();
const positiveQty = z.number().positive();

const lineSchema = z.object({
  productId: z.string().uuid(),
  quantity: positiveQty,
  unitPrice: z.number().min(0).optional(),
  manualUnitPrice: z.number().min(0).nullable().optional(),
  allowManualPrice: z.boolean().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  discountAmount: z.number().min(0).optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  notes: optionalStr(500),
});

export const quotationSchema = z.object({
  customerId: z.string().uuid(),
  priceListId: z.string().uuid().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  notes: optionalStr(2000),
  lines: z.array(lineSchema).min(1),
});

export const quotationStatusSchema = z.object({
  status: z.enum(["SENT", "ACCEPTED", "REJECTED", "CANCELLED"]),
});

export const salesOrderSchema = z.object({
  customerId: z.string().uuid(),
  quotationId: z.string().uuid().nullable().optional(),
  priceListId: z.string().uuid().nullable().optional(),
  notes: optionalStr(2000),
  promisedDeliveryAt: z.string().datetime().nullable().optional(),
  lines: z.array(lineSchema).min(1),
});

export const cancelSalesOrderSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const deliverSchema = z.object({
  lines: z
    .array(
      z.object({
        salesOrderLineId: z.string().uuid(),
        quantity: positiveQty,
      })
    )
    .optional(),
});

export const salesInvoiceSchema = z.object({
  customerId: z.string().uuid(),
  salesOrderId: z.string().uuid().nullable().optional(),
  invoiceDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  notes: optionalStr(2000),
  lines: z.array(lineSchema).optional(),
});

export const receiptSchema = z.object({
  customerId: z.string().uuid(),
  amount: positiveQty,
  paymentMethod: optionalStr(80),
  reference: optionalStr(80),
  receiptDate: z.string().datetime().optional(),
  notes: optionalStr(2000),
  allocations: z
    .array(
      z.object({
        salesInvoiceId: z.string().uuid(),
        amount: positiveQty,
      })
    )
    .min(1),
});

export const salesReturnSchema = z.object({
  customerId: z.string().uuid(),
  salesOrderId: z.string().uuid().nullable().optional(),
  salesInvoiceId: z.string().uuid().nullable().optional(),
  reason: optionalStr(500),
  notes: optionalStr(2000),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        salesOrderLineId: z.string().uuid().nullable().optional(),
        quantity: positiveQty,
        unitPrice: z.number().min(0),
        taxPercent: z.number().min(0).max(100).optional(),
        notes: optionalStr(500),
      })
    )
    .min(1),
});

export const priceListSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  nameAr: optionalStr(120),
  currency: z.string().trim().min(3).max(8).optional(),
  isDefault: z.boolean().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        unitPrice: z.number().min(0),
        minQty: z.number().positive().optional(),
      })
    )
    .optional(),
});

export const priceListItemSchema = z.object({
  productId: z.string().uuid(),
  unitPrice: z.number().min(0),
  minQty: z.number().positive().optional(),
});

export const customerPriceSchema = z.object({
  customerId: z.string().uuid(),
  productId: z.string().uuid(),
  unitPrice: z.number().min(0),
  discountPercent: z.number().min(0).max(100).optional(),
});

export const discountRuleSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  percent: z.number().min(0).max(100),
  maxPercent: z.number().min(0).max(100).nullable().optional(),
  requiresAuth: z.boolean().optional(),
});

export const resolvePriceSchema = z.object({
  customerId: z.string().uuid(),
  productId: z.string().uuid(),
  priceListId: z.string().uuid().nullable().optional(),
  quantity: z.number().positive().optional(),
  manualUnitPrice: z.number().min(0).nullable().optional(),
  allowManualPrice: z.boolean().optional(),
});
