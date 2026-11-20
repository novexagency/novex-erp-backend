import { z } from "zod";

const optionalStr = (max: number) => z.string().trim().max(max).nullable().optional();
const uuid = z.string().uuid();

export const createEmployeeSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  nameAr: optionalStr(160),
  email: z.string().email().nullable().optional().or(z.literal("").transform(() => null)),
  phone: optionalStr(40),
  phoneSecondary: optionalStr(40),
  addressLine1: optionalStr(200),
  addressLine2: optionalStr(200),
  city: optionalStr(80),
  country: optionalStr(80),
  postalCode: optionalStr(20),
  departmentId: uuid.nullable().optional(),
  jobTitleId: uuid.nullable().optional(),
  branchId: uuid.nullable().optional(),
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"]).optional(),
  status: z
    .enum(["ACTIVE", "PROBATION", "ON_LEAVE", "TERMINATED", "ARCHIVED"])
    .optional(),
  hireDate: z.string().optional(),
  managerEmployeeId: uuid.nullable().optional(),
  userId: uuid.nullable().optional(),
  emergencyContactName: optionalStr(120),
  emergencyContactPhone: optionalStr(40),
  emergencyContactRelation: optionalStr(80),
  notes: optionalStr(2000),
  compensation: z
    .object({
      baseSalary: z.number().min(0),
      currency: z.string().trim().min(3).max(3).optional(),
      payFrequency: z.enum(["MONTHLY", "BIWEEKLY", "WEEKLY", "DAILY"]).optional(),
      effectiveFrom: z.string().optional(),
      notes: optionalStr(500),
    })
    .nullable()
    .optional(),
});

export const updateEmployeeSchema = createEmployeeSchema.partial().omit({ compensation: true }).extend({
  terminationDate: z.string().nullable().optional(),
});

export const compensationSchema = z.object({
  baseSalary: z.number().min(0),
  currency: z.string().trim().min(3).max(3).optional(),
  payFrequency: z.enum(["MONTHLY", "BIWEEKLY", "WEEKLY", "DAILY"]).optional(),
  effectiveFrom: z.string().optional(),
  notes: optionalStr(500),
});

export const teamSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  nameAr: optionalStr(120),
  departmentId: uuid.nullable().optional(),
});

export const updateTeamSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  nameAr: optionalStr(120),
  departmentId: uuid.nullable().optional(),
  isActive: z.boolean().optional(),
});

export const teamMemberSchema = z.object({
  employeeId: uuid,
  roleLabel: optionalStr(80),
  isLead: z.boolean().optional(),
});

export const documentSchema = z.object({
  docType: z.enum(["CONTRACT", "ID", "CERTIFICATE", "OTHER"]).optional(),
  title: z.string().trim().min(1).max(200),
  publicId: z.string().trim().min(1).max(200),
  secureUrl: z.string().url(),
  fileName: optionalStr(200),
  bytes: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  visibility: z.enum(["HR_ONLY", "MANAGER", "EMPLOYEE_SELF"]).optional(),
  notes: optionalStr(1000),
});

export const createRequestSchema = z.object({
  type: z.enum(["LEAVE", "DOCUMENT", "GENERAL", "INTERNAL"]).optional(),
  title: z.string().trim().min(1).max(200),
  description: optionalStr(4000),
  requesterId: uuid,
  assigneeId: uuid.nullable().optional(),
  submit: z.boolean().optional(),
});

export const decideRequestSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: optionalStr(1000),
});

export const noteSchema = z.object({
  note: optionalStr(1000),
});

// —— Phase 14 ——
export const scheduleSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  nameAr: optionalStr(120),
  kind: z.enum(["FIXED", "SHIFT", "FLEXIBLE"]).optional(),
  workdaysMask: z.number().int().min(0).max(127).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  breakMinutes: z.number().int().min(0).optional(),
  graceMinutes: z.number().int().min(0).optional(),
  expectedHours: z.number().positive().optional(),
  overtimeAfterHours: z.number().positive().optional(),
});

export const shiftSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  breakMinutes: z.number().int().min(0).optional(),
});

export const assignScheduleSchema = z.object({
  employeeId: uuid,
  scheduleId: uuid,
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().nullable().optional(),
});

export const checkInSchema = z.object({
  employeeId: uuid,
  at: z.string().optional(),
  source: z.enum(["MANUAL", "SELF_SERVICE", "DEVICE", "SYSTEM"]).optional(),
  shiftId: uuid.nullable().optional(),
  note: optionalStr(500),
  deviceRef: optionalStr(80),
});

export const checkOutSchema = z.object({
  employeeId: uuid,
  at: z.string().optional(),
  note: optionalStr(500),
});

export const markAbsentSchema = z.object({
  employeeId: uuid,
  workDate: z.string().min(8),
  note: optionalStr(500),
});

export const correctionSchema = z.object({
  attendanceId: uuid,
  requestedCheckInAt: z.string().nullable().optional(),
  requestedCheckOutAt: z.string().nullable().optional(),
  reason: z.string().trim().min(1).max(500),
});

export const leaveTypeSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  nameAr: optionalStr(120),
  isPaid: z.boolean().optional(),
  deductsBalance: z.boolean().optional(),
  annualAllowance: z.number().min(0).optional(),
});

export const leaveRequestSchema = z.object({
  employeeId: uuid,
  leaveTypeId: uuid,
  startDate: z.string().min(8),
  endDate: z.string().min(8),
  reason: optionalStr(1000),
  submit: z.boolean().optional(),
});

export const payrollPeriodSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: optionalStr(120),
  startDate: z.string().min(8),
  endDate: z.string().min(8),
});

export const payrollRunSchema = z.object({
  periodId: uuid,
  overtimeRateMultiplier: z.number().positive().optional(),
  notes: optionalStr(1000),
});

export const advanceSchema = z.object({
  employeeId: uuid,
  amount: z.number().positive(),
  note: optionalStr(500),
});

export const devicePunchSchema = z.object({
  employeeExternalRef: z.string().trim().min(1).max(80),
  punchedAt: z.string().min(8),
  type: z.enum(["IN", "OUT"]),
  deviceId: optionalStr(80),
});
