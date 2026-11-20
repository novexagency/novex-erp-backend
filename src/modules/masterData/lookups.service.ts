import { MasterStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { pageResult, parsePage, type PageQuery } from "./pagination.js";

function statusFilter(includeArchived: boolean, status?: string) {
  if (status) return { status: status as MasterStatus };
  if (!includeArchived) return { status: { not: MasterStatus.ARCHIVED } };
  return {};
}

async function archiveById(
  model:
    | "brand"
    | "unitOfMeasure"
    | "taxRate"
    | "paymentMethod"
    | "expenseCategory"
    | "currency"
    | "jobTitle",
  tenantId: TenantId,
  id: string
) {
  const tid = requireTenantId(tenantId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (prisma as any)[model].findUnique({ where: { id } });
  if (!row) throw new AppError("Record not found", 404);
  assertSameTenant(row.organizationId, tid);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma as any)[model].update({
    where: { id },
    data: { status: MasterStatus.ARCHIVED, archivedAt: new Date() },
  });
}

export async function ensureDefaultUnits(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const defaults = [
    { code: "PCS", name: "Piece", nameAr: "قطعة", symbol: "pcs" },
    { code: "BOX", name: "Box", nameAr: "علبة", symbol: "box" },
    { code: "CTN", name: "Carton", nameAr: "كرتونة", symbol: "ctn" },
    { code: "KG", name: "Kilogram", nameAr: "كيلوجرام", symbol: "kg" },
    { code: "G", name: "Gram", nameAr: "جرام", symbol: "g" },
    { code: "L", name: "Liter", nameAr: "لتر", symbol: "L" },
    { code: "M", name: "Meter", nameAr: "متر", symbol: "m" },
  ];
  for (const u of defaults) {
    await prisma.unitOfMeasure.upsert({
      where: { organizationId_code: { organizationId: tid, code: u.code } },
      update: {},
      create: { organizationId: tid, ...u, isSystem: true },
    });
  }
  // Default conversions
  const g = await prisma.unitOfMeasure.findUnique({
    where: { organizationId_code: { organizationId: tid, code: "G" } },
  });
  const kg = await prisma.unitOfMeasure.findUnique({
    where: { organizationId_code: { organizationId: tid, code: "KG" } },
  });
  if (g && kg) {
    await prisma.unitConversion.upsert({
      where: {
        organizationId_fromUnitId_toUnitId: {
          organizationId: tid,
          fromUnitId: kg.id,
          toUnitId: g.id,
        },
      },
      update: { factor: new Prisma.Decimal(1000) },
      create: {
        organizationId: tid,
        fromUnitId: kg.id,
        toUnitId: g.id,
        factor: new Prisma.Decimal(1000),
      },
    });
  }
}

export async function ensureDefaultCurrency(tenantId: TenantId, baseCode = "EGP") {
  const tid = requireTenantId(tenantId);
  await prisma.currency.upsert({
    where: { organizationId_code: { organizationId: tid, code: baseCode } },
    update: { isBase: true },
    create: {
      organizationId: tid,
      code: baseCode,
      name: baseCode === "EGP" ? "Egyptian Pound" : baseCode,
      nameAr: baseCode === "EGP" ? "جنيه مصري" : baseCode,
      symbol: baseCode === "EGP" ? "E£" : baseCode,
      isBase: true,
      exchangeRate: new Prisma.Decimal(1),
    },
  });
}

export async function listBrands(tenantId: TenantId, query: PageQuery) {
  const tid = requireTenantId(tenantId);
  const p = parsePage(query as Record<string, unknown>);
  const where: Prisma.BrandWhereInput = {
    organizationId: tid,
    ...statusFilter(p.includeArchived, p.status),
    ...(p.search
      ? { OR: [{ name: { contains: p.search, mode: "insensitive" } }, { nameAr: { contains: p.search, mode: "insensitive" } }] }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.brand.count({ where }),
    prisma.brand.findMany({ where, orderBy: { name: "asc" }, skip: p.skip, take: p.pageSize }),
  ]);
  return pageResult(items, total, p.page, p.pageSize);
}

export async function createBrand(tenantId: TenantId, data: { name: string; nameAr?: string | null; code?: string | null; status?: MasterStatus }) {
  const tid = requireTenantId(tenantId);
  const dup = await prisma.brand.findFirst({ where: { organizationId: tid, name: data.name } });
  if (dup) throw new AppError("Duplicate brand name", 409);
  return prisma.brand.create({ data: { organizationId: tid, ...data } });
}

export async function updateBrand(tenantId: TenantId, id: string, data: Record<string, unknown>) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.brand.findUnique({ where: { id } });
  if (!row) throw new AppError("Brand not found", 404);
  assertSameTenant(row.organizationId, tid);
  return prisma.brand.update({ where: { id }, data });
}

export async function archiveBrand(tenantId: TenantId, id: string) {
  return archiveById("brand", tenantId, id);
}

export async function listUnits(tenantId: TenantId, query: PageQuery) {
  const tid = requireTenantId(tenantId);
  await ensureDefaultUnits(tid);
  const p = parsePage(query as Record<string, unknown>);
  const where: Prisma.UnitOfMeasureWhereInput = {
    organizationId: tid,
    ...statusFilter(p.includeArchived, p.status),
    ...(p.search
      ? {
          OR: [
            { name: { contains: p.search, mode: "insensitive" } },
            { code: { contains: p.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.unitOfMeasure.count({ where }),
    prisma.unitOfMeasure.findMany({ where, orderBy: { code: "asc" }, skip: p.skip, take: p.pageSize }),
  ]);
  return pageResult(items, total, p.page, p.pageSize);
}

export async function createUnit(tenantId: TenantId, data: { name: string; nameAr?: string | null; code: string; symbol?: string | null; status?: MasterStatus }) {
  const tid = requireTenantId(tenantId);
  const dup = await prisma.unitOfMeasure.findUnique({
    where: { organizationId_code: { organizationId: tid, code: data.code } },
  });
  if (dup) throw new AppError("Duplicate unit code", 409);
  return prisma.unitOfMeasure.create({ data: { organizationId: tid, ...data } });
}

export async function updateUnit(tenantId: TenantId, id: string, data: Record<string, unknown>) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.unitOfMeasure.findUnique({ where: { id } });
  if (!row) throw new AppError("Unit not found", 404);
  assertSameTenant(row.organizationId, tid);
  return prisma.unitOfMeasure.update({ where: { id }, data });
}

export async function archiveUnit(tenantId: TenantId, id: string) {
  return archiveById("unitOfMeasure", tenantId, id);
}

export async function upsertConversion(
  tenantId: TenantId,
  data: { fromUnitId: string; toUnitId: string; factor: number }
) {
  const tid = requireTenantId(tenantId);
  if (data.fromUnitId === data.toUnitId) throw new AppError("Units must differ", 400);
  const [from, to] = await Promise.all([
    prisma.unitOfMeasure.findUnique({ where: { id: data.fromUnitId } }),
    prisma.unitOfMeasure.findUnique({ where: { id: data.toUnitId } }),
  ]);
  if (!from || !to) throw new AppError("Unit not found", 404);
  assertSameTenant(from.organizationId, tid);
  assertSameTenant(to.organizationId, tid);
  return prisma.unitConversion.upsert({
    where: {
      organizationId_fromUnitId_toUnitId: {
        organizationId: tid,
        fromUnitId: data.fromUnitId,
        toUnitId: data.toUnitId,
      },
    },
    update: { factor: new Prisma.Decimal(data.factor) },
    create: {
      organizationId: tid,
      fromUnitId: data.fromUnitId,
      toUnitId: data.toUnitId,
      factor: new Prisma.Decimal(data.factor),
    },
  });
}

export async function listConversions(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  return prisma.unitConversion.findMany({
    where: { organizationId: tid },
    include: { fromUnit: true, toUnit: true },
  });
}

export async function convertQty(
  tenantId: TenantId,
  fromUnitId: string,
  toUnitId: string,
  qty: number
) {
  const tid = requireTenantId(tenantId);
  if (fromUnitId === toUnitId) return qty;
  const direct = await prisma.unitConversion.findUnique({
    where: {
      organizationId_fromUnitId_toUnitId: { organizationId: tid, fromUnitId, toUnitId },
    },
  });
  if (direct) return qty * Number(direct.factor);
  const inverse = await prisma.unitConversion.findUnique({
    where: {
      organizationId_fromUnitId_toUnitId: {
        organizationId: tid,
        fromUnitId: toUnitId,
        toUnitId: fromUnitId,
      },
    },
  });
  if (inverse) return qty / Number(inverse.factor);
  throw new AppError("No conversion defined between these units", 400);
}

export async function listTaxes(tenantId: TenantId, query: PageQuery) {
  const tid = requireTenantId(tenantId);
  const p = parsePage(query as Record<string, unknown>);
  const where: Prisma.TaxRateWhereInput = {
    organizationId: tid,
    ...statusFilter(p.includeArchived, p.status),
    ...(p.search
      ? { OR: [{ name: { contains: p.search, mode: "insensitive" } }, { code: { contains: p.search, mode: "insensitive" } }] }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.taxRate.count({ where }),
    prisma.taxRate.findMany({ where, orderBy: { code: "asc" }, skip: p.skip, take: p.pageSize }),
  ]);
  return pageResult(items, total, p.page, p.pageSize);
}

export async function createTax(tenantId: TenantId, data: { name: string; nameAr?: string | null; code: string; rate: number; isInclusive?: boolean; status?: MasterStatus }) {
  const tid = requireTenantId(tenantId);
  const dup = await prisma.taxRate.findUnique({
    where: { organizationId_code: { organizationId: tid, code: data.code } },
  });
  if (dup) throw new AppError("Duplicate tax code", 409);
  return prisma.taxRate.create({
    data: {
      organizationId: tid,
      name: data.name,
      nameAr: data.nameAr,
      code: data.code,
      rate: new Prisma.Decimal(data.rate),
      isInclusive: data.isInclusive ?? false,
      status: data.status,
    },
  });
}

export async function updateTax(tenantId: TenantId, id: string, data: Record<string, unknown>) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.taxRate.findUnique({ where: { id } });
  if (!row) throw new AppError("Tax not found", 404);
  assertSameTenant(row.organizationId, tid);
  const payload = { ...data };
  if (typeof payload.rate === "number") payload.rate = new Prisma.Decimal(payload.rate);
  return prisma.taxRate.update({ where: { id }, data: payload });
}

export async function archiveTax(tenantId: TenantId, id: string) {
  return archiveById("taxRate", tenantId, id);
}

export async function listPaymentMethods(tenantId: TenantId, query: PageQuery) {
  const tid = requireTenantId(tenantId);
  const p = parsePage(query as Record<string, unknown>);
  const where: Prisma.PaymentMethodWhereInput = {
    organizationId: tid,
    ...statusFilter(p.includeArchived, p.status),
    ...(p.search ? { name: { contains: p.search, mode: "insensitive" } } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.paymentMethod.count({ where }),
    prisma.paymentMethod.findMany({ where, orderBy: { name: "asc" }, skip: p.skip, take: p.pageSize }),
  ]);
  return pageResult(items, total, p.page, p.pageSize);
}

export async function createPaymentMethod(tenantId: TenantId, data: { name: string; nameAr?: string | null; code: string; status?: MasterStatus }) {
  const tid = requireTenantId(tenantId);
  const dup = await prisma.paymentMethod.findUnique({
    where: { organizationId_code: { organizationId: tid, code: data.code } },
  });
  if (dup) throw new AppError("Duplicate payment method code", 409);
  return prisma.paymentMethod.create({ data: { organizationId: tid, ...data } });
}

export async function updatePaymentMethod(tenantId: TenantId, id: string, data: Record<string, unknown>) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.paymentMethod.findUnique({ where: { id } });
  if (!row) throw new AppError("Payment method not found", 404);
  assertSameTenant(row.organizationId, tid);
  return prisma.paymentMethod.update({ where: { id }, data });
}

export async function archivePaymentMethod(tenantId: TenantId, id: string) {
  return archiveById("paymentMethod", tenantId, id);
}

export async function listExpenseCategories(tenantId: TenantId, query: PageQuery) {
  const tid = requireTenantId(tenantId);
  const p = parsePage(query as Record<string, unknown>);
  const where: Prisma.ExpenseCategoryWhereInput = {
    organizationId: tid,
    ...statusFilter(p.includeArchived, p.status),
    ...(p.search ? { name: { contains: p.search, mode: "insensitive" } } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.expenseCategory.count({ where }),
    prisma.expenseCategory.findMany({ where, orderBy: { name: "asc" }, skip: p.skip, take: p.pageSize }),
  ]);
  return pageResult(items, total, p.page, p.pageSize);
}

export async function createExpenseCategory(tenantId: TenantId, data: { name: string; nameAr?: string | null; code?: string | null; description?: string | null; status?: MasterStatus }) {
  const tid = requireTenantId(tenantId);
  const dup = await prisma.expenseCategory.findFirst({ where: { organizationId: tid, name: data.name } });
  if (dup) throw new AppError("Duplicate expense category", 409);
  return prisma.expenseCategory.create({ data: { organizationId: tid, ...data } });
}

export async function updateExpenseCategory(tenantId: TenantId, id: string, data: Record<string, unknown>) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.expenseCategory.findUnique({ where: { id } });
  if (!row) throw new AppError("Expense category not found", 404);
  assertSameTenant(row.organizationId, tid);
  return prisma.expenseCategory.update({ where: { id }, data });
}

export async function archiveExpenseCategory(tenantId: TenantId, id: string) {
  return archiveById("expenseCategory", tenantId, id);
}

export async function listCurrencies(tenantId: TenantId, query: PageQuery) {
  const tid = requireTenantId(tenantId);
  await ensureDefaultCurrency(tid);
  const p = parsePage(query as Record<string, unknown>);
  const where: Prisma.CurrencyWhereInput = {
    organizationId: tid,
    ...statusFilter(p.includeArchived, p.status),
    ...(p.search
      ? { OR: [{ code: { contains: p.search, mode: "insensitive" } }, { name: { contains: p.search, mode: "insensitive" } }] }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.currency.count({ where }),
    prisma.currency.findMany({ where, orderBy: [{ isBase: "desc" }, { code: "asc" }], skip: p.skip, take: p.pageSize }),
  ]);
  return pageResult(items, total, p.page, p.pageSize);
}

export async function createCurrency(tenantId: TenantId, data: { code: string; name: string; nameAr?: string | null; symbol?: string | null; decimalPlaces?: number; isBase?: boolean; exchangeRate?: number; status?: MasterStatus }) {
  const tid = requireTenantId(tenantId);
  const dup = await prisma.currency.findUnique({
    where: { organizationId_code: { organizationId: tid, code: data.code } },
  });
  if (dup) throw new AppError("Duplicate currency code", 409);
  if (data.isBase) {
    await prisma.currency.updateMany({ where: { organizationId: tid, isBase: true }, data: { isBase: false } });
  }
  return prisma.currency.create({
    data: {
      organizationId: tid,
      code: data.code,
      name: data.name,
      nameAr: data.nameAr,
      symbol: data.symbol,
      decimalPlaces: data.decimalPlaces ?? 2,
      isBase: data.isBase ?? false,
      exchangeRate: new Prisma.Decimal(data.exchangeRate ?? 1),
      status: data.status,
    },
  });
}

export async function updateCurrency(tenantId: TenantId, id: string, data: Record<string, unknown>) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.currency.findUnique({ where: { id } });
  if (!row) throw new AppError("Currency not found", 404);
  assertSameTenant(row.organizationId, tid);
  if (data.isBase === true) {
    await prisma.currency.updateMany({ where: { organizationId: tid, isBase: true }, data: { isBase: false } });
  }
  const payload = { ...data };
  if (typeof payload.exchangeRate === "number") {
    payload.exchangeRate = new Prisma.Decimal(payload.exchangeRate);
  }
  return prisma.currency.update({ where: { id }, data: payload });
}

export async function archiveCurrency(tenantId: TenantId, id: string) {
  return archiveById("currency", tenantId, id);
}

export async function listJobTitles(tenantId: TenantId, query: PageQuery & { departmentId?: string }) {
  const tid = requireTenantId(tenantId);
  const p = parsePage(query as Record<string, unknown>);
  const where: Prisma.JobTitleWhereInput = {
    organizationId: tid,
    ...statusFilter(p.includeArchived, p.status),
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(p.search ? { name: { contains: p.search, mode: "insensitive" } } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.jobTitle.count({ where }),
    prisma.jobTitle.findMany({ where, orderBy: { name: "asc" }, skip: p.skip, take: p.pageSize }),
  ]);
  return pageResult(items, total, p.page, p.pageSize);
}

export async function createJobTitle(tenantId: TenantId, data: { name: string; nameAr?: string | null; code?: string | null; departmentId?: string | null; status?: MasterStatus }) {
  const tid = requireTenantId(tenantId);
  const dup = await prisma.jobTitle.findFirst({ where: { organizationId: tid, name: data.name } });
  if (dup) throw new AppError("Duplicate job title", 409);
  return prisma.jobTitle.create({ data: { organizationId: tid, ...data } });
}

export async function updateJobTitle(tenantId: TenantId, id: string, data: Record<string, unknown>) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.jobTitle.findUnique({ where: { id } });
  if (!row) throw new AppError("Job title not found", 404);
  assertSameTenant(row.organizationId, tid);
  return prisma.jobTitle.update({ where: { id }, data });
}

export async function archiveJobTitle(tenantId: TenantId, id: string) {
  return archiveById("jobTitle", tenantId, id);
}

export async function listDepartments(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  return prisma.department.findMany({
    where: { organizationId: tid },
    orderBy: { name: "asc" },
  });
}

export async function createDepartment(tenantId: TenantId, data: { name: string; code?: string | null }) {
  const tid = requireTenantId(tenantId);
  const dup = await prisma.department.findFirst({ where: { organizationId: tid, name: data.name } });
  if (dup) throw new AppError("Duplicate department name", 409);
  return prisma.department.create({ data: { organizationId: tid, name: data.name, code: data.code ?? null } });
}

export async function updateDepartment(tenantId: TenantId, id: string, data: { name?: string; code?: string | null }) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.department.findUnique({ where: { id } });
  if (!row) throw new AppError("Department not found", 404);
  assertSameTenant(row.organizationId, tid);
  return prisma.department.update({ where: { id }, data });
}

export async function listDocumentSequences(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  return prisma.documentSequence.findMany({
    where: { organizationId: tid },
    orderBy: [{ module: "asc" }, { year: "desc" }],
  });
}

export async function upsertDocumentSequence(
  tenantId: TenantId,
  data: { module: string; prefix: string; year?: number | null; padding?: number; currentNumber?: number }
) {
  const tid = requireTenantId(tenantId);
  const year = data.year ?? new Date().getFullYear();
  return prisma.documentSequence.upsert({
    where: {
      organizationId_module_year: { organizationId: tid, module: data.module, year },
    },
    update: {
      prefix: data.prefix,
      ...(data.padding !== undefined ? { padding: data.padding } : {}),
      ...(data.currentNumber !== undefined ? { currentNumber: data.currentNumber } : {}),
    },
    create: {
      organizationId: tid,
      module: data.module,
      prefix: data.prefix,
      year,
      padding: data.padding ?? 4,
      currentNumber: data.currentNumber ?? 0,
    },
  });
}
