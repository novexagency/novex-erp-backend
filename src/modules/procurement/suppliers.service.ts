import { MasterStatus, Prisma, SupplierLedgerType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { pageResult, parsePage, type PageQuery } from "../masterData/pagination.js";

function emptyToNull<T extends Record<string, unknown>>(data: T): T {
  const out = { ...data };
  for (const k of Object.keys(out)) {
    if (out[k] === "") (out as Record<string, unknown>)[k] = null;
  }
  return out;
}

export async function listCategories(tenantId: TenantId) {
  return prisma.supplierCategory.findMany({
    where: { organizationId: requireTenantId(tenantId), status: { not: MasterStatus.ARCHIVED } },
    orderBy: { name: "asc" },
  });
}

export async function createCategory(
  tenantId: TenantId,
  data: { name: string; nameAr?: string | null; code?: string | null; status?: MasterStatus }
) {
  const tid = requireTenantId(tenantId);
  const dup = await prisma.supplierCategory.findFirst({
    where: { organizationId: tid, name: data.name },
  });
  if (dup) throw new AppError("Duplicate supplier category", 409);
  return prisma.supplierCategory.create({ data: { organizationId: tid, ...data } });
}

export async function listSuppliers(
  tenantId: TenantId,
  query: PageQuery & { categoryId?: string }
) {
  const tid = requireTenantId(tenantId);
  const p = parsePage(query as Record<string, unknown>);
  const where: Prisma.SupplierWhereInput = {
    organizationId: tid,
    ...(p.includeArchived ? {} : { status: { not: MasterStatus.ARCHIVED } }),
    ...(p.status ? { status: p.status as MasterStatus } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(p.search
      ? {
          OR: [
            { name: { contains: p.search, mode: "insensitive" } },
            { nameAr: { contains: p.search, mode: "insensitive" } },
            { code: { contains: p.search, mode: "insensitive" } },
            { email: { contains: p.search, mode: "insensitive" } },
            { phone: { contains: p.search, mode: "insensitive" } },
            { taxNumber: { contains: p.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({
      where,
      include: { category: true },
      orderBy: { updatedAt: "desc" },
      skip: p.skip,
      take: p.pageSize,
    }),
  ]);
  return pageResult(items, total, p.page, p.pageSize);
}

export async function getSupplier(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: { category: true },
  });
  if (!supplier) throw new AppError("Supplier not found", 404);
  assertSameTenant(supplier.organizationId, tid);
  return supplier;
}

export async function createSupplier(
  tenantId: TenantId,
  data: Record<string, unknown>,
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const input = emptyToNull(data);
  const code = String(input.code);
  const dup = await prisma.supplier.findUnique({
    where: { organizationId_code: { organizationId: tid, code } },
  });
  if (dup) throw new AppError("Duplicate supplier code", 409);

  const openingBalance = Number(input.openingBalance ?? 0);

  const supplier = await prisma.$transaction(async (tx) => {
    const created = await tx.supplier.create({
      data: {
        organizationId: tid,
        code,
        name: String(input.name),
        nameAr: (input.nameAr as string | null) ?? null,
        email: (input.email as string | null) ?? null,
        phone: (input.phone as string | null) ?? null,
        phoneSecondary: (input.phoneSecondary as string | null) ?? null,
        website: (input.website as string | null) ?? null,
        taxNumber: (input.taxNumber as string | null) ?? null,
        commercialRegister: (input.commercialRegister as string | null) ?? null,
        addressLine1: (input.addressLine1 as string | null) ?? null,
        addressLine2: (input.addressLine2 as string | null) ?? null,
        city: (input.city as string | null) ?? null,
        country: (input.country as string) || "Egypt",
        postalCode: (input.postalCode as string | null) ?? null,
        categoryId: (input.categoryId as string | null) ?? null,
        paymentTermsDays: Number(input.paymentTermsDays ?? 0),
        creditLimit: new Prisma.Decimal(Number(input.creditLimit ?? 0)),
        openingBalance: new Prisma.Decimal(openingBalance),
        internalNotes: (input.internalNotes as string | null) ?? null,
        status: (input.status as MasterStatus) || MasterStatus.ACTIVE,
      },
    });

    if (openingBalance !== 0) {
      await tx.supplierLedgerEntry.create({
        data: {
          organizationId: tid,
          supplierId: created.id,
          type: SupplierLedgerType.OPENING,
          amount: new Prisma.Decimal(Math.abs(openingBalance)),
          direction: openingBalance >= 0 ? "CREDIT" : "DEBIT",
          note: "Opening balance",
          createdByUserId: userId,
        },
      });
    }
    return created;
  });

  return getSupplier(tid, supplier.id);
}

export async function updateSupplier(tenantId: TenantId, id: string, data: Record<string, unknown>) {
  const tid = requireTenantId(tenantId);
  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) throw new AppError("Supplier not found", 404);
  assertSameTenant(existing.organizationId, tid);

  const input = emptyToNull(data);
  if (input.code && String(input.code) !== existing.code) {
    const dup = await prisma.supplier.findUnique({
      where: { organizationId_code: { organizationId: tid, code: String(input.code) } },
    });
    if (dup) throw new AppError("Duplicate supplier code", 409);
  }
  delete input.openingBalance;

  const payload: Prisma.SupplierUpdateInput = {};
  const fields = [
    "code",
    "name",
    "nameAr",
    "email",
    "phone",
    "phoneSecondary",
    "website",
    "taxNumber",
    "commercialRegister",
    "addressLine1",
    "addressLine2",
    "city",
    "country",
    "postalCode",
    "paymentTermsDays",
    "internalNotes",
    "status",
  ] as const;
  for (const key of fields) {
    if (input[key] !== undefined) (payload as Record<string, unknown>)[key] = input[key];
  }
  if (input.categoryId !== undefined) {
    payload.category = input.categoryId
      ? { connect: { id: String(input.categoryId) } }
      : { disconnect: true };
  }
  if (typeof input.creditLimit === "number") {
    payload.creditLimit = new Prisma.Decimal(input.creditLimit);
  }

  await prisma.supplier.update({ where: { id }, data: payload });
  return getSupplier(tid, id);
}

export async function archiveSupplier(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) throw new AppError("Supplier not found", 404);
  assertSameTenant(existing.organizationId, tid);
  return prisma.supplier.update({
    where: { id },
    data: { status: MasterStatus.ARCHIVED, archivedAt: new Date() },
  });
}

export async function getSupplierFinancial(tenantId: TenantId, supplierId: string) {
  const tid = requireTenantId(tenantId);
  const supplier = await getSupplier(tid, supplierId);
  const entries = await prisma.supplierLedgerEntry.findMany({
    where: { organizationId: tid, supplierId },
    orderBy: { entryDate: "asc" },
  });

  let balance = 0;
  let totalPurchases = 0;
  let totalPaid = 0;
  for (const e of entries) {
    const n = Number(e.amount);
    const signed = e.direction === "CREDIT" ? n : -n;
    balance += signed;
    if (e.type === SupplierLedgerType.PURCHASE || e.type === SupplierLedgerType.DEBIT_NOTE) {
      totalPurchases += n;
    }
    if (e.type === SupplierLedgerType.PAYMENT) totalPaid += n;
  }

  return {
    supplierId,
    accountBalance: Number(balance.toFixed(4)),
    totalPurchases: Number(totalPurchases.toFixed(4)),
    totalPaid: Number(totalPaid.toFixed(4)),
    creditLimit: Number(supplier.creditLimit),
  };
}
