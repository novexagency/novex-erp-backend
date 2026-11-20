import { EmployeeDocType, EmployeeDocVisibility } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

export async function listDocuments(
  tenantId: TenantId,
  employeeId: string,
  opts?: { includeArchived?: boolean; expiringWithinDays?: number }
) {
  const tid = requireTenantId(tenantId);
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) throw new AppError("Employee not found", 404);
  assertSameTenant(emp.organizationId, tid);

  const expiringBefore =
    opts?.expiringWithinDays != null
      ? new Date(Date.now() + opts.expiringWithinDays * 86400000)
      : undefined;

  return prisma.employeeDocument.findMany({
    where: {
      organizationId: tid,
      employeeId,
      ...(opts?.includeArchived ? {} : { archivedAt: null }),
      ...(expiringBefore
        ? { expiresAt: { not: null, lte: expiringBefore } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function addDocument(
  tenantId: TenantId,
  employeeId: string,
  data: {
    docType?: EmployeeDocType;
    title: string;
    publicId: string;
    secureUrl: string;
    fileName?: string | null;
    bytes?: number | null;
    expiresAt?: string | null;
    visibility?: EmployeeDocVisibility;
    notes?: string | null;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) throw new AppError("Employee not found", 404);
  assertSameTenant(emp.organizationId, tid);

  return prisma.employeeDocument.create({
    data: {
      organizationId: tid,
      employeeId,
      docType: data.docType ?? EmployeeDocType.OTHER,
      title: data.title,
      publicId: data.publicId,
      secureUrl: data.secureUrl,
      fileName: data.fileName,
      bytes: data.bytes,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      visibility: data.visibility ?? EmployeeDocVisibility.HR_ONLY,
      notes: data.notes,
      uploadedByUserId: userId,
    },
  });
}

export async function archiveDocument(tenantId: TenantId, documentId: string) {
  const tid = requireTenantId(tenantId);
  const doc = await prisma.employeeDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw new AppError("Document not found", 404);
  assertSameTenant(doc.organizationId, tid);
  if (doc.archivedAt) throw new AppError("Already archived", 409);
  return prisma.employeeDocument.update({
    where: { id: documentId },
    data: { archivedAt: new Date() },
  });
}

export async function expiringDocuments(tenantId: TenantId, withinDays = 30) {
  const tid = requireTenantId(tenantId);
  const before = new Date(Date.now() + withinDays * 86400000);
  return prisma.employeeDocument.findMany({
    where: {
      organizationId: tid,
      archivedAt: null,
      expiresAt: { not: null, lte: before, gte: new Date() },
    },
    include: {
      employee: {
        select: { id: true, employeeNumber: true, firstName: true, lastName: true },
      },
    },
    orderBy: { expiresAt: "asc" },
  });
}
