import { z } from "zod";

const optionalNullableString = (max: number) =>
  z.string().trim().max(max).nullable().optional();

export const branchTypeSchema = z.enum([
  "HEADQUARTERS",
  "OFFICE",
  "RETAIL_STORE",
  "FACTORY",
  "WAREHOUSE",
]);

export const createBranchSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().min(1).max(40),
  type: branchTypeSchema.optional().default("OFFICE"),
  city: optionalNullableString(120),
  phone: optionalNullableString(40),
  address: optionalNullableString(255),
});

export const updateBranchSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    type: branchTypeSchema.optional(),
    city: optionalNullableString(120),
    phone: optionalNullableString(40),
    address: optionalNullableString(255),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  });
