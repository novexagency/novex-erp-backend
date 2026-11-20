import { BranchType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { ensureSystemConfig } from "../company/company.service.js";

export type BranchListItem = {
  id: string;
  name: string;
  code: string;
  type: BranchType;
  city: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  employeeCount: number;
};

function mapBranch(
  row: {
    id: string;
    name: string;
    code: string;
    type: BranchType;
    city: string | null;
    phone: string | null;
    address: string | null;
    isActive: boolean;
    _count: { employees: number };
  }
): BranchListItem {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    type: row.type,
    city: row.city,
    phone: row.phone,
    address: row.address,
    isActive: row.isActive,
    employeeCount: row._count.employees,
  };
}

async function getBranchLimit(tenantId: string): Promise<number> {
  const config = await ensureSystemConfig(tenantId);
  return config.maxActiveBranches;
}

export async function listBranches(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const [limit, used, rows] = await Promise.all([
    getBranchLimit(tid),
    prisma.branch.count({ where: { organizationId: tid, isActive: true } }),
    prisma.branch.findMany({
      where: { organizationId: tid },
      include: { _count: { select: { employees: true } } },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
  ]);

  return {
    items: rows.map(mapBranch),
    limit,
    used,
  };
}

export async function createBranch(
  tenantId: TenantId,
  data: {
    name: string;
    code: string;
    type?: BranchType;
    city?: string | null;
    phone?: string | null;
    address?: string | null;
  }
) {
  const tid = requireTenantId(tenantId);
  const code = data.code.trim().toUpperCase();
  const name = data.name.trim();

  const limit = await getBranchLimit(tid);
  const used = await prisma.branch.count({
    where: { organizationId: tid, isActive: true },
  });
  if (used >= limit) {
    throw new AppError("Branch limit reached", 403);
  }

  const duplicate = await prisma.branch.findFirst({
    where: { organizationId: tid, code: { equals: code, mode: "insensitive" } },
  });
  if (duplicate) {
    throw new AppError("Branch code already exists in this organization", 409);
  }

  try {
    const created = await prisma.branch.create({
      data: {
        organizationId: tid,
        name,
        code,
        type: data.type ?? BranchType.OFFICE,
        city: data.city ?? null,
        phone: data.phone ?? null,
        address: data.address ?? null,
        isActive: true,
      },
      include: { _count: { select: { employees: true } } },
    });
    return mapBranch(created);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError("Branch code already exists in this organization", 409);
    }
    throw err;
  }
}

export async function updateBranch(
  tenantId: TenantId,
  branchId: string,
  data: {
    name?: string;
    type?: BranchType;
    city?: string | null;
    phone?: string | null;
    address?: string | null;
    isActive?: boolean;
  }
) {
  const tid = requireTenantId(tenantId);
  const existing = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!existing) throw new AppError("Branch not found", 404);
  assertSameTenant(existing.organizationId, tid);

  if (data.isActive === true && !existing.isActive) {
    const limit = await getBranchLimit(tid);
    const used = await prisma.branch.count({
      where: { organizationId: tid, isActive: true },
    });
    if (used >= limit) {
      throw new AppError("Branch limit reached", 403);
    }
  }

  const updated = await prisma.branch.update({
    where: { id: branchId },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.city !== undefined ? { city: data.city } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.address !== undefined ? { address: data.address } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
    include: { _count: { select: { employees: true } } },
  });

  return mapBranch(updated);
}
