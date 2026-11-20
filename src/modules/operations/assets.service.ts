import { OpsAssetStatus, Prisma } from "@prisma/client";
import { nextDocumentNumber } from "../../lib/documentNumber.js";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

const assetInclude = {
  category: true,
  department: { select: { id: true, name: true, code: true } },
  assignedEmployee: {
    select: { id: true, employeeNumber: true, firstName: true, lastName: true },
  },
  documents: true,
  events: { orderBy: { at: "desc" as const }, take: 50 },
};

export async function listCategories(tenantId: TenantId) {
  return prisma.opsAssetCategory.findMany({
    where: { organizationId: requireTenantId(tenantId), isActive: true },
    orderBy: { code: "asc" },
  });
}

export async function createCategory(
  tenantId: TenantId,
  data: { code: string; name: string; nameAr?: string | null }
) {
  const tid = requireTenantId(tenantId);
  try {
    return await prisma.opsAssetCategory.create({
      data: {
        organizationId: tid,
        code: data.code,
        name: data.name,
        nameAr: data.nameAr,
      },
    });
  } catch {
    throw new AppError("Duplicate asset category code", 409);
  }
}

export async function listAssets(tenantId: TenantId, opts?: { status?: string; categoryId?: string }) {
  return prisma.opsAsset.findMany({
    where: {
      organizationId: requireTenantId(tenantId),
      ...(opts?.status ? { status: opts.status as OpsAssetStatus } : {}),
      ...(opts?.categoryId ? { categoryId: opts.categoryId } : {}),
    },
    include: assetInclude,
    orderBy: { code: "asc" },
  });
}

export async function getAsset(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.opsAsset.findUnique({ where: { id }, include: assetInclude });
  if (!row) throw new AppError("Asset not found", 404);
  assertSameTenant(row.organizationId, tid);
  return row;
}

export async function createAsset(
  tenantId: TenantId,
  data: {
    name: string;
    nameAr?: string | null;
    categoryId?: string | null;
    purchaseDate?: string | null;
    purchaseCost?: number;
    status?: OpsAssetStatus;
    departmentId?: string | null;
    assignedEmployeeId?: string | null;
    locationNote?: string | null;
    notes?: string | null;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  if (data.assignedEmployeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: data.assignedEmployeeId, organizationId: tid },
    });
    if (!emp) throw new AppError("Employee not found", 404);
  }
  if (data.departmentId) {
    const dep = await prisma.department.findFirst({
      where: { id: data.departmentId, organizationId: tid },
    });
    if (!dep) throw new AppError("Department not found", 404);
  }
  if (data.categoryId) {
    const cat = await prisma.opsAssetCategory.findFirst({
      where: { id: data.categoryId, organizationId: tid },
    });
    if (!cat) throw new AppError("Asset category not found", 404);
  }
  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "AST", "AST");
    const asset = await tx.opsAsset.create({
      data: {
        organizationId: tid,
        code,
        name: data.name,
        nameAr: data.nameAr,
        categoryId: data.categoryId,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
        purchaseCost: new Prisma.Decimal(data.purchaseCost ?? 0),
        status: data.status ?? OpsAssetStatus.ACTIVE,
        departmentId: data.departmentId,
        assignedEmployeeId: data.assignedEmployeeId,
        locationNote: data.locationNote,
        notes: data.notes,
        createdByUserId: userId,
      },
    });
    await tx.opsAssetEvent.create({
      data: {
        organizationId: tid,
        assetId: asset.id,
        action: "CREATED",
        actorUserId: userId,
      },
    });
    return tx.opsAsset.findUniqueOrThrow({ where: { id: asset.id }, include: assetInclude });
  });
}

export async function updateAsset(
  tenantId: TenantId,
  id: string,
  data: Partial<{
    name: string;
    nameAr: string | null;
    categoryId: string | null;
    purchaseDate: string | null;
    purchaseCost: number;
    status: OpsAssetStatus;
    departmentId: string | null;
    assignedEmployeeId: string | null;
    locationNote: string | null;
    notes: string | null;
  }>,
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const existing = await prisma.opsAsset.findUnique({ where: { id } });
  if (!existing) throw new AppError("Asset not found", 404);
  assertSameTenant(existing.organizationId, tid);

  const updated = await prisma.opsAsset.update({
    where: { id },
    data: {
      name: data.name,
      nameAr: data.nameAr,
      categoryId: data.categoryId,
      purchaseDate:
        data.purchaseDate === undefined
          ? undefined
          : data.purchaseDate
            ? new Date(data.purchaseDate)
            : null,
      purchaseCost:
        data.purchaseCost !== undefined ? new Prisma.Decimal(data.purchaseCost) : undefined,
      status: data.status,
      departmentId: data.departmentId,
      assignedEmployeeId: data.assignedEmployeeId,
      locationNote: data.locationNote,
      notes: data.notes,
    },
    include: assetInclude,
  });

  if (data.status && data.status !== existing.status) {
    await prisma.opsAssetEvent.create({
      data: {
        organizationId: tid,
        assetId: id,
        action: "STATUS_CHANGED",
        note: `${existing.status} → ${data.status}`,
        actorUserId: userId,
      },
    });
  }
  if (
    data.assignedEmployeeId !== undefined &&
    data.assignedEmployeeId !== existing.assignedEmployeeId
  ) {
    await prisma.opsAssetEvent.create({
      data: {
        organizationId: tid,
        assetId: id,
        action: "ASSIGNED",
        note: data.assignedEmployeeId ?? "unassigned",
        actorUserId: userId,
      },
    });
  }

  return updated;
}

export async function addAssetDocument(
  tenantId: TenantId,
  assetId: string,
  data: { title: string; publicId: string; secureUrl: string; fileName?: string | null; bytes?: number | null }
) {
  const tid = requireTenantId(tenantId);
  const asset = await prisma.opsAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw new AppError("Asset not found", 404);
  assertSameTenant(asset.organizationId, tid);
  return prisma.opsAssetDocument.create({
    data: {
      organizationId: tid,
      assetId,
      title: data.title,
      publicId: data.publicId,
      secureUrl: data.secureUrl,
      fileName: data.fileName,
      bytes: data.bytes,
    },
  });
}
