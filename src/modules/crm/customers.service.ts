import { CustomerLedgerType, CustomerType, MasterStatus, Prisma } from "@prisma/client";
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

export async function listCustomers(
  tenantId: TenantId,
  query: PageQuery & { categoryId?: string; groupId?: string; tagId?: string; type?: string }
) {
  const tid = requireTenantId(tenantId);
  const p = parsePage(query as Record<string, unknown>);
  const where: Prisma.CustomerWhereInput = {
    organizationId: tid,
    ...(p.includeArchived ? {} : { status: { not: MasterStatus.ARCHIVED } }),
    ...(p.status ? { status: p.status as MasterStatus } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.groupId ? { groupId: query.groupId } : {}),
    ...(query.type ? { type: query.type as CustomerType } : {}),
    ...(query.tagId ? { tags: { some: { tagId: query.tagId } } } : {}),
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
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      include: {
        category: true,
        group: true,
        tags: { include: { tag: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip: p.skip,
      take: p.pageSize,
    }),
  ]);

  return pageResult(items, total, p.page, p.pageSize);
}

export async function getCustomer(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      category: true,
      group: true,
      tags: { include: { tag: true } },
    },
  });
  if (!customer) throw new AppError("Customer not found", 404);
  assertSameTenant(customer.organizationId, tid);
  return customer;
}

async function syncTags(tenantId: string, customerId: string, tagIds: string[]) {
  for (const tagId of tagIds) {
    const tag = await prisma.customerTag.findUnique({ where: { id: tagId } });
    if (!tag || tag.organizationId !== tenantId) {
      throw new AppError("Tag not found in this tenant", 404);
    }
  }
  await prisma.customerTagLink.deleteMany({ where: { customerId } });
  if (tagIds.length) {
    await prisma.customerTagLink.createMany({
      data: tagIds.map((tagId) => ({
        organizationId: tenantId,
        customerId,
        tagId,
      })),
    });
  }
}

export async function createCustomer(
  tenantId: TenantId,
  data: Record<string, unknown>,
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const input = emptyToNull(data);
  const code = String(input.code);
  const dup = await prisma.customer.findUnique({
    where: { organizationId_code: { organizationId: tid, code } },
  });
  if (dup) throw new AppError("Duplicate customer code", 409);

  const openingBalance = Number(input.openingBalance ?? 0);
  const tagIds = Array.isArray(input.tagIds) ? (input.tagIds as string[]) : [];

  const customer = await prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({
      data: {
        organizationId: tid,
        type: (input.type as CustomerType) || CustomerType.COMPANY,
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
        groupId: (input.groupId as string | null) ?? null,
        creditLimit: new Prisma.Decimal(Number(input.creditLimit ?? 0)),
        paymentTermsDays: Number(input.paymentTermsDays ?? 0),
        openingBalance: new Prisma.Decimal(openingBalance),
        internalNotes: (input.internalNotes as string | null) ?? null,
        status: (input.status as MasterStatus) || MasterStatus.ACTIVE,
      },
    });

    if (openingBalance !== 0) {
      await tx.customerLedgerEntry.create({
        data: {
          organizationId: tid,
          customerId: created.id,
          type: CustomerLedgerType.OPENING,
          amount: new Prisma.Decimal(Math.abs(openingBalance)),
          direction: openingBalance >= 0 ? "DEBIT" : "CREDIT",
          note: "Opening balance",
          createdByUserId: userId,
        },
      });
    }

    return created;
  });

  if (tagIds.length) await syncTags(tid, customer.id, tagIds);
  return getCustomer(tid, customer.id);
}

export async function updateCustomer(tenantId: TenantId, id: string, data: Record<string, unknown>) {
  const tid = requireTenantId(tenantId);
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) throw new AppError("Customer not found", 404);
  assertSameTenant(existing.organizationId, tid);

  const input = emptyToNull(data);
  if (input.code && String(input.code) !== existing.code) {
    const dup = await prisma.customer.findUnique({
      where: { organizationId_code: { organizationId: tid, code: String(input.code) } },
    });
    if (dup) throw new AppError("Duplicate customer code", 409);
  }

  const tagIds = input.tagIds;
  delete input.tagIds;
  delete input.openingBalance; // opening balance changes via ledger only after create

  const payload: Prisma.CustomerUpdateInput = {};
  const fields = [
    "type",
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
  if (input.groupId !== undefined) {
    payload.group = input.groupId
      ? { connect: { id: String(input.groupId) } }
      : { disconnect: true };
  }
  if (typeof input.creditLimit === "number") {
    payload.creditLimit = new Prisma.Decimal(input.creditLimit);
  }

  await prisma.customer.update({ where: { id }, data: payload });
  if (Array.isArray(tagIds)) await syncTags(tid, id, tagIds as string[]);
  return getCustomer(tid, id);
}

export async function archiveCustomer(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) throw new AppError("Customer not found", 404);
  assertSameTenant(existing.organizationId, tid);
  return prisma.customer.update({
    where: { id },
    data: { status: MasterStatus.ARCHIVED, archivedAt: new Date() },
  });
}

// --- lookup CRUD ---
export async function listCategories(tenantId: TenantId) {
  return prisma.customerCategory.findMany({
    where: { organizationId: requireTenantId(tenantId), status: { not: MasterStatus.ARCHIVED } },
    orderBy: { name: "asc" },
  });
}

export async function createCategory(tenantId: TenantId, data: { name: string; nameAr?: string | null; code?: string | null; status?: MasterStatus }) {
  const tid = requireTenantId(tenantId);
  const dup = await prisma.customerCategory.findFirst({ where: { organizationId: tid, name: data.name } });
  if (dup) throw new AppError("Duplicate customer category", 409);
  return prisma.customerCategory.create({ data: { organizationId: tid, ...data } });
}

export async function listGroups(tenantId: TenantId) {
  return prisma.customerGroup.findMany({
    where: { organizationId: requireTenantId(tenantId), status: { not: MasterStatus.ARCHIVED } },
    orderBy: { name: "asc" },
  });
}

export async function createGroup(tenantId: TenantId, data: { name: string; nameAr?: string | null; code?: string | null; status?: MasterStatus }) {
  const tid = requireTenantId(tenantId);
  const dup = await prisma.customerGroup.findFirst({ where: { organizationId: tid, name: data.name } });
  if (dup) throw new AppError("Duplicate customer group", 409);
  return prisma.customerGroup.create({ data: { organizationId: tid, ...data } });
}

export async function listTags(tenantId: TenantId) {
  return prisma.customerTag.findMany({
    where: { organizationId: requireTenantId(tenantId) },
    orderBy: { name: "asc" },
  });
}

export async function createTag(tenantId: TenantId, data: { name: string; color?: string | null }) {
  const tid = requireTenantId(tenantId);
  const dup = await prisma.customerTag.findFirst({ where: { organizationId: tid, name: data.name } });
  if (dup) throw new AppError("Duplicate customer tag", 409);
  return prisma.customerTag.create({ data: { organizationId: tid, ...data } });
}
