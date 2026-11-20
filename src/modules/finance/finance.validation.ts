import { z } from "zod";

const optionalStr = (max: number) => z.string().trim().max(max).nullable().optional();
const uuid = z.string().uuid();
const positive = z.number().positive();

export const cashboxSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  nameAr: optionalStr(120),
  currency: z.string().trim().min(3).max(3).optional(),
  openingBalance: z.number().optional(),
  notes: optionalStr(2000),
});

export const bankAccountSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  nameAr: optionalStr(120),
  bankName: optionalStr(120),
  accountNumber: optionalStr(80),
  iban: optionalStr(80),
  currency: z.string().trim().min(3).max(3).optional(),
  openingBalance: z.number().optional(),
  notes: optionalStr(2000),
});

export const manualMovementSchema = z
  .object({
    cashboxId: uuid.nullable().optional(),
    bankAccountId: uuid.nullable().optional(),
    direction: z.enum(["IN", "OUT"]),
    amount: positive,
    note: optionalStr(500),
    entryDate: z.string().datetime().or(z.string().min(8)).optional(),
    clientRequestId: z.string().trim().min(8).max(80).nullable().optional(),
  })
  .refine((d) => Boolean(d.cashboxId) !== Boolean(d.bankAccountId), {
    message: "Provide either cashboxId or bankAccountId",
  });

export const transferSchema = z.object({
  amount: positive,
  fromCashboxId: uuid.nullable().optional(),
  toCashboxId: uuid.nullable().optional(),
  fromBankAccountId: uuid.nullable().optional(),
  toBankAccountId: uuid.nullable().optional(),
  note: optionalStr(500),
  clientRequestId: z.string().trim().min(8).max(80).nullable().optional(),
});

export const cancelSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  authorized: z.boolean().optional(),
});

export const reconcileSchema = z
  .object({
    cashboxId: uuid.nullable().optional(),
    bankAccountId: uuid.nullable().optional(),
    actualBalance: z.number(),
  })
  .refine((d) => Boolean(d.cashboxId) !== Boolean(d.bankAccountId), {
    message: "Provide either cashboxId or bankAccountId",
  });

export const integritySchema = z
  .object({
    cashboxId: uuid.nullable().optional(),
    bankAccountId: uuid.nullable().optional(),
  })
  .refine((d) => Boolean(d.cashboxId) !== Boolean(d.bankAccountId), {
    message: "Provide either cashboxId or bankAccountId",
  });

export const receiptSchema = z.object({
  customerId: uuid.nullable().optional(),
  amount: positive,
  cashboxId: uuid.nullable().optional(),
  bankAccountId: uuid.nullable().optional(),
  paymentMethod: optionalStr(80),
  reference: optionalStr(80),
  receiptDate: z.string().optional(),
  notes: optionalStr(2000),
  isAdvance: z.boolean().optional(),
  clientRequestId: z.string().trim().min(8).max(80).nullable().optional(),
  allocations: z
    .array(
      z.object({
        salesInvoiceId: uuid.nullable().optional(),
        amount: positive,
        note: optionalStr(500),
      })
    )
    .optional(),
});

export const paymentSchema = z.object({
  paymentType: z.enum(["SUPPLIER", "EXPENSE", "ADVANCE"]).optional(),
  supplierId: uuid.nullable().optional(),
  expenseId: uuid.nullable().optional(),
  amount: positive,
  cashboxId: uuid.nullable().optional(),
  bankAccountId: uuid.nullable().optional(),
  paymentMethod: optionalStr(80),
  reference: optionalStr(80),
  paymentDate: z.string().optional(),
  notes: optionalStr(2000),
  isAdvance: z.boolean().optional(),
  clientRequestId: z.string().trim().min(8).max(80).nullable().optional(),
  allocations: z
    .array(
      z.object({
        purchaseInvoiceId: uuid.nullable().optional(),
        amount: positive,
        note: optionalStr(500),
      })
    )
    .optional(),
});

export const costCenterSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  nameAr: optionalStr(120),
});

export const expenseSchema = z.object({
  categoryId: uuid,
  costCenterId: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: optionalStr(2000),
  amount: positive,
  taxAmount: z.number().min(0).optional(),
  expenseDate: z.string().optional(),
  cashboxId: uuid.nullable().optional(),
  bankAccountId: uuid.nullable().optional(),
  vendorName: optionalStr(120),
  notes: optionalStr(2000),
  clientRequestId: z.string().trim().min(8).max(80).nullable().optional(),
  requiresApproval: z.boolean().optional(),
});

export const expenseAttachmentSchema = z.object({
  publicId: z.string().trim().min(1).max(200),
  secureUrl: z.string().url(),
  fileName: optionalStr(200),
  bytes: z.number().int().positive().nullable().optional(),
});

export const recurringExpenseSchema = z.object({
  code: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  categoryId: uuid,
  costCenterId: uuid.nullable().optional(),
  amount: positive,
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]).optional(),
  nextRunAt: z.string().nullable().optional(),
  notes: optionalStr(2000),
});
