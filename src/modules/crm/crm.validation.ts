import { z } from "zod";

const optionalStr = (max: number) => z.string().trim().max(max).nullable().optional();
const statusEnum = z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]);

export const customerSchema = z.object({
  type: z.enum(["INDIVIDUAL", "COMPANY"]).optional(),
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
  groupId: z.string().uuid().nullable().optional(),
  creditLimit: z.number().min(0).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  openingBalance: z.number().optional(),
  internalNotes: optionalStr(4000),
  status: statusEnum.optional(),
  tagIds: z.array(z.string().uuid()).optional(),
});

export const customerCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameAr: optionalStr(120),
  code: optionalStr(40),
  status: statusEnum.optional(),
});

export const customerGroupSchema = customerCategorySchema;

export const customerTagSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: optionalStr(20),
});

export const noteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

export const interactionSchema = z.object({
  channel: z.enum(["NOTE", "MEETING", "CALL_LOG", "VISIT", "OTHER"]).optional(),
  subject: optionalStr(200),
  body: optionalStr(5000),
  interactedAt: z.string().datetime().optional(),
});

export const followUpSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: optionalStr(2000),
  dueAt: z.string().datetime().nullable().optional(),
  status: z.enum(["OPEN", "DONE", "CANCELLED"]).optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
});

export const opportunitySchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: optionalStr(2000),
  amount: z.number().min(0).nullable().optional(),
  stage: z.enum(["NEW", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"]).optional(),
  expectedCloseAt: z.string().datetime().nullable().optional(),
});

export const ledgerEntrySchema = z.object({
  type: z.enum(["OPENING", "SALE", "PAYMENT", "CREDIT_NOTE", "DEBIT_NOTE", "ADJUSTMENT"]),
  amount: z.number().positive(),
  direction: z.enum(["DEBIT", "CREDIT"]).optional(),
  reference: optionalStr(80),
  referenceType: optionalStr(40),
  referenceId: optionalStr(80),
  note: optionalStr(500),
  entryDate: z.string().datetime().optional(),
});
