import { z } from "zod";

const optionalStr = (max: number) => z.string().trim().max(max).nullable().optional();
const uuid = z.string().uuid();
export const glAccountSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  nameAr: optionalStr(120),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
  parentId: uuid.nullable().optional(),
  isPostable: z.boolean().optional(),
  systemRole: optionalStr(40),
});

export const updateGlAccountSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  nameAr: optionalStr(120),
  parentId: uuid.nullable().optional(),
  isPostable: z.boolean().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  systemRole: optionalStr(40),
});

export const fiscalYearSchema = z.object({
  code: z.string().trim().min(1).max(20),
  startDate: z.string().min(8),
  endDate: z.string().min(8),
});

export const periodSchema = z.object({
  fiscalYearId: uuid,
  code: z.string().trim().min(1).max(20),
  name: optionalStr(80),
  startDate: z.string().min(8),
  endDate: z.string().min(8),
});

export const reopenPeriodSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  authorized: z.boolean().optional(),
});

export const postingRuleSchema = z.object({
  autoPost: z.boolean().optional(),
  isActive: z.boolean().optional(),
  debitAccountId: uuid.nullable().optional(),
  creditAccountId: uuid.nullable().optional(),
  debitSecondaryId: uuid.nullable().optional(),
  creditSecondaryId: uuid.nullable().optional(),
  description: optionalStr(500),
});

const journalLineSchema = z.object({
  accountId: uuid,
  debit: z.number().min(0),
  credit: z.number().min(0),
  memo: optionalStr(500),
});

export const createJournalSchema = z.object({
  entryDate: z.string().optional(),
  description: optionalStr(2000),
  lines: z.array(journalLineSchema).min(2),
});

export const updateJournalSchema = z.object({
  entryDate: z.string().optional(),
  description: optionalStr(2000),
  lines: z.array(journalLineSchema).min(2).optional(),
});

export const reverseJournalSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  authorized: z.boolean().optional(),
});

export const eventTypeParam = z.enum([
  "SALES_INVOICE",
  "SALES_RETURN",
  "PURCHASE_INVOICE",
  "PURCHASE_RETURN",
  "CUSTOMER_RECEIPT",
  "SUPPLIER_PAYMENT",
  "EXPENSE",
  "INVENTORY_MOVEMENT",
  "OPENING_BALANCE",
]);
