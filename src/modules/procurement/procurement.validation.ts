import { z } from "zod";

const optionalStr = (max: number) => z.string().trim().max(max).nullable().optional();
const statusEnum = z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]);
const positiveQty = z.number().positive();

export const supplierCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameAr: optionalStr(120),
  code: optionalStr(40),
  status: statusEnum.optional(),
});

export const supplierSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  nameAr: optionalStr(200),
  email: z.union([z.string().email(), z.literal(""), z.null()]).optional(),
  phone: optionalStr(40),
  phoneSecondary: optionalStr(40),
  website: optionalStr(200),
  taxNumber: optionalStr(120),
  commercialRegister: optionalStr(120),
  addressLine1: optionalStr(255),
  addressLine2: optionalStr(255),
  city: optionalStr(120),
  country: z.string().trim().max(120).optional(),
  postalCode: optionalStr(40),
  categoryId: z.string().uuid().nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  creditLimit: z.number().min(0).optional(),
  openingBalance: z.number().optional(),
  internalNotes: optionalStr(4000),
  status: statusEnum.optional(),
});

export const purchaseRequestSchema = z.object({
  notes: optionalStr(2000),
  neededBy: z.string().datetime().nullable().optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: positiveQty,
        notes: optionalStr(500),
      })
    )
    .min(1),
});

export const rejectRequestSchema = z.object({
  reason: optionalStr(500),
});

const poLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: positiveQty,
  unitPrice: z.number().min(0),
  discountPercent: z.number().min(0).max(100).optional(),
  discountAmount: z.number().min(0).optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  notes: optionalStr(500),
});

export const purchaseOrderSchema = z.object({
  supplierId: z.string().uuid(),
  purchaseRequestId: z.string().uuid().nullable().optional(),
  expectedDeliveryDate: z.string().datetime().nullable().optional(),
  notes: optionalStr(2000),
  lines: z.array(poLineSchema).min(1),
});

export const poAttachmentSchema = z.object({
  publicId: z.string().min(1).max(255),
  secureUrl: z.string().url(),
  resourceType: z.string().max(40).optional(),
  fileName: optionalStr(255),
  bytes: z.number().int().min(0).nullable().optional(),
});

export const goodsReceiptSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  allowOverReceive: z.boolean().optional(),
  notes: optionalStr(2000),
  receivedAt: z.string().datetime().nullable().optional(),
  lines: z
    .array(
      z.object({
        purchaseOrderLineId: z.string().uuid(),
        quantityReceived: positiveQty,
        unitCost: z.number().min(0).optional(),
        notes: optionalStr(500),
      })
    )
    .min(1),
});

export const purchaseInvoiceSchema = z.object({
  supplierId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().nullable().optional(),
  supplierInvoiceNo: optionalStr(80),
  invoiceDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  notes: optionalStr(2000),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid().nullable().optional(),
        description: optionalStr(255),
        quantity: positiveQty,
        unitPrice: z.number().min(0),
        discountPercent: z.number().min(0).max(100).optional(),
        discountAmount: z.number().min(0).optional(),
        taxPercent: z.number().min(0).max(100).optional(),
      })
    )
    .min(1),
});

export const supplierPaymentSchema = z.object({
  supplierId: z.string().uuid(),
  amount: positiveQty,
  paymentMethod: optionalStr(80),
  reference: optionalStr(80),
  paymentDate: z.string().datetime().optional(),
  notes: optionalStr(2000),
  allocations: z
    .array(
      z.object({
        purchaseInvoiceId: z.string().uuid(),
        amount: positiveQty,
      })
    )
    .min(1),
});

export const purchaseReturnSchema = z.object({
  supplierId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().nullable().optional(),
  goodsReceiptId: z.string().uuid().nullable().optional(),
  reason: optionalStr(500),
  notes: optionalStr(2000),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        purchaseOrderLineId: z.string().uuid().nullable().optional(),
        quantity: positiveQty,
        unitCost: z.number().min(0).optional(),
        notes: optionalStr(500),
      })
    )
    .min(1),
});

export const stockAdjustmentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  notes: optionalStr(2000),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        direction: z.enum(["IN", "OUT"]),
        quantity: positiveQty,
        unitCost: z.number().min(0).nullable().optional(),
        note: optionalStr(500),
      })
    )
    .min(1),
});
