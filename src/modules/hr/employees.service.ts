import {
  EmploymentStatus,
  EmploymentType,
  PayFrequency,
  Prisma,
} from "@prisma/client";
import { nextDocumentNumber } from "../../lib/documentNumber.js";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

const employeeInclude = {
  department: true,
  jobTitle: true,
  branch: { select: { id: true, name: true, code: true } },
  manager: {
    select: { id: true, employeeNumber: true, firstName: true, lastName: true },
  },
  teamMemberships: { include: { team: true } },
} as const;

export type EmployeeListOpts = {
  status?: string;
  departmentId?: string;
  q?: string;
  includeSalary?: boolean;
};

function stripSalary<T extends { compensation?: unknown }>(row: T, includeSalary: boolean) {
  if (includeSalary) return row;
  const { compensation: _c, ...rest } = row as T & { compensation?: unknown };
  return rest;
}

export async function listEmployees(tenantId: TenantId, opts: EmployeeListOpts = {}) {
  const tid = requireTenantId(tenantId);
  const items = await prisma.employee.findMany({
    where: {
      organizationId: tid,
      ...(opts.status ? { status: opts.status as EmploymentStatus } : {}),
      ...(opts.departmentId ? { departmentId: opts.departmentId } : {}),
      ...(opts.q
        ? {
            OR: [
              { firstName: { contains: opts.q, mode: "insensitive" } },
              { lastName: { contains: opts.q, mode: "insensitive" } },
              { employeeNumber: { contains: opts.q, mode: "insensitive" } },
              { email: { contains: opts.q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      ...employeeInclude,
      ...(opts.includeSalary ? { compensation: true } : {}),
    },
    orderBy: [{ employeeNumber: "asc" }],
  });
  return items.map((e) => stripSalary(e, Boolean(opts.includeSalary)));
}

export async function getEmployee(tenantId: TenantId, id: string, includeSalary = false) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.employee.findUnique({
    where: { id },
    include: {
      ...employeeInclude,
      documents: { where: { archivedAt: null }, orderBy: { createdAt: "desc" } },
      ...(includeSalary ? { compensation: true } : {}),
    },
  });
  if (!row) throw new AppError("Employee not found", 404);
  assertSameTenant(row.organizationId, tid);
  return stripSalary(row, includeSalary);
}

export async function createEmployee(
  tenantId: TenantId,
  data: {
    firstName: string;
    lastName: string;
    nameAr?: string | null;
    email?: string | null;
    phone?: string | null;
    phoneSecondary?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    country?: string | null;
    postalCode?: string | null;
    departmentId?: string | null;
    jobTitleId?: string | null;
    branchId?: string | null;
    employmentType?: EmploymentType;
    status?: EmploymentStatus;
    hireDate?: string;
    managerEmployeeId?: string | null;
    userId?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    emergencyContactRelation?: string | null;
    notes?: string | null;
    compensation?: {
      baseSalary: number;
      currency?: string;
      payFrequency?: PayFrequency;
      effectiveFrom?: string;
      notes?: string | null;
    } | null;
  },
  userId?: string,
  canSetSalary = false
) {
  const tid = requireTenantId(tenantId);

  if (data.departmentId) {
    const d = await prisma.department.findFirst({
      where: { id: data.departmentId, organizationId: tid },
    });
    if (!d) throw new AppError("Department not found", 404);
  }
  if (data.jobTitleId) {
    const j = await prisma.jobTitle.findFirst({
      where: { id: data.jobTitleId, organizationId: tid },
    });
    if (!j) throw new AppError("Job title not found", 404);
  }
  if (data.branchId) {
    const b = await prisma.branch.findFirst({
      where: { id: data.branchId, organizationId: tid },
    });
    if (!b) throw new AppError("Branch not found", 404);
  }
  if (data.managerEmployeeId) {
    const m = await prisma.employee.findFirst({
      where: { id: data.managerEmployeeId, organizationId: tid },
    });
    if (!m) throw new AppError("Manager employee not found", 404);
  }
  if (data.userId) {
    const member = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: tid, userId: data.userId },
      },
    });
    if (!member) {
      throw new AppError("userId must be a member of this tenant to link as employee", 400);
    }
  }

  return prisma.$transaction(async (tx) => {
    const employeeNumber = await nextDocumentNumber(tx, tid, "EMP", "EMP");
    const employee = await tx.employee.create({
      data: {
        organizationId: tid,
        employeeNumber,
        firstName: data.firstName,
        lastName: data.lastName,
        nameAr: data.nameAr,
        email: data.email,
        phone: data.phone,
        phoneSecondary: data.phoneSecondary,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        city: data.city,
        country: data.country,
        postalCode: data.postalCode,
        departmentId: data.departmentId,
        jobTitleId: data.jobTitleId,
        branchId: data.branchId,
        employmentType: data.employmentType ?? EmploymentType.FULL_TIME,
        status: data.status ?? EmploymentStatus.ACTIVE,
        hireDate: data.hireDate ? new Date(data.hireDate) : new Date(),
        managerEmployeeId: data.managerEmployeeId,
        userId: data.userId,
        emergencyContactName: data.emergencyContactName,
        emergencyContactPhone: data.emergencyContactPhone,
        emergencyContactRelation: data.emergencyContactRelation,
        notes: data.notes,
        createdByUserId: userId,
      },
      include: employeeInclude,
    });

    if (data.compensation && canSetSalary) {
      await tx.employeeCompensation.create({
        data: {
          organizationId: tid,
          employeeId: employee.id,
          baseSalary: new Prisma.Decimal(data.compensation.baseSalary),
          currency: data.compensation.currency || "EGP",
          payFrequency: data.compensation.payFrequency ?? PayFrequency.MONTHLY,
          effectiveFrom: data.compensation.effectiveFrom
            ? new Date(data.compensation.effectiveFrom)
            : new Date(),
          notes: data.compensation.notes,
          updatedByUserId: userId,
        },
      });
    } else if (data.compensation && !canSetSalary) {
      throw new AppError("hr:salary permission required to set compensation", 403);
    }

    const full = await tx.employee.findUniqueOrThrow({
      where: { id: employee.id },
      include: {
        ...employeeInclude,
        documents: { where: { archivedAt: null }, orderBy: { createdAt: "desc" } },
        ...(canSetSalary ? { compensation: true } : {}),
      },
    });
    return stripSalary(full, canSetSalary);
  });
}

export async function updateEmployee(
  tenantId: TenantId,
  id: string,
  data: Partial<{
    firstName: string;
    lastName: string;
    nameAr: string | null;
    email: string | null;
    phone: string | null;
    phoneSecondary: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    country: string | null;
    postalCode: string | null;
    departmentId: string | null;
    jobTitleId: string | null;
    branchId: string | null;
    employmentType: EmploymentType;
    status: EmploymentStatus;
    hireDate: string;
    terminationDate: string | null;
    managerEmployeeId: string | null;
    userId: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    emergencyContactRelation: string | null;
    notes: string | null;
  }>
) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.employee.findUnique({ where: { id } });
  if (!row) throw new AppError("Employee not found", 404);
  assertSameTenant(row.organizationId, tid);

  if (data.managerEmployeeId === id) {
    throw new AppError("Employee cannot be their own manager", 400);
  }
  if (data.branchId) {
    const b = await prisma.branch.findFirst({
      where: { id: data.branchId, organizationId: tid },
    });
    if (!b) throw new AppError("Branch not found", 404);
  }
  if (data.userId) {
    const member = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: tid, userId: data.userId },
      },
    });
    if (!member) {
      throw new AppError("userId must be a member of this tenant", 400);
    }
  }

  await prisma.employee.update({
    where: { id },
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      nameAr: data.nameAr,
      email: data.email,
      phone: data.phone,
      phoneSecondary: data.phoneSecondary,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2,
      city: data.city,
      country: data.country,
      postalCode: data.postalCode,
      departmentId: data.departmentId,
      jobTitleId: data.jobTitleId,
      branchId: data.branchId,
      employmentType: data.employmentType,
      status: data.status,
      hireDate: data.hireDate ? new Date(data.hireDate) : undefined,
      terminationDate:
        data.terminationDate === undefined
          ? undefined
          : data.terminationDate
            ? new Date(data.terminationDate)
            : null,
      managerEmployeeId: data.managerEmployeeId,
      userId: data.userId,
      emergencyContactName: data.emergencyContactName,
      emergencyContactPhone: data.emergencyContactPhone,
      emergencyContactRelation: data.emergencyContactRelation,
      notes: data.notes,
    },
  });

  return getEmployee(tid, id, false);
}

export async function upsertCompensation(
  tenantId: TenantId,
  employeeId: string,
  data: {
    baseSalary: number;
    currency?: string;
    payFrequency?: PayFrequency;
    effectiveFrom?: string;
    notes?: string | null;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) throw new AppError("Employee not found", 404);
  assertSameTenant(emp.organizationId, tid);
  if (data.baseSalary < 0) throw new AppError("baseSalary must be >= 0", 400);

  return prisma.employeeCompensation.upsert({
    where: { employeeId },
    create: {
      organizationId: tid,
      employeeId,
      baseSalary: new Prisma.Decimal(data.baseSalary),
      currency: data.currency || "EGP",
      payFrequency: data.payFrequency ?? PayFrequency.MONTHLY,
      effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : new Date(),
      notes: data.notes,
      updatedByUserId: userId,
    },
    update: {
      baseSalary: new Prisma.Decimal(data.baseSalary),
      ...(data.currency !== undefined ? { currency: data.currency } : {}),
      ...(data.payFrequency !== undefined ? { payFrequency: data.payFrequency } : {}),
      ...(data.effectiveFrom !== undefined
        ? { effectiveFrom: new Date(data.effectiveFrom) }
        : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      updatedByUserId: userId,
    },
  });
}

export async function orgChart(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const employees = await prisma.employee.findMany({
    where: {
      organizationId: tid,
      status: { notIn: [EmploymentStatus.TERMINATED, EmploymentStatus.ARCHIVED] },
    },
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      lastName: true,
      managerEmployeeId: true,
      departmentId: true,
      jobTitleId: true,
      department: { select: { id: true, name: true } },
      jobTitle: { select: { id: true, name: true } },
    },
    orderBy: { employeeNumber: "asc" },
  });
  return { employees };
}
