import { CostingMethod, MasterStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { pageResult, parsePage, type PageQuery } from "./pagination.js";

export async function listProducts(
  tenantId: TenantId,
  query: PageQuery & { categoryId?: string; brandId?: string }
) {
  const tid = requireTenantId(tenantId);
  const p = parsePage(query as Record<string, unknown>);
  const where: Prisma.ProductWhereInput = {
    organizationId: tid,
    ...(p.includeArchived ? {} : { status: { not: MasterStatus.ARCHIVED } }),
    ...(p.status ? { status: p.status as MasterStatus } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.brandId ? { brandId: query.brandId } : {}),
    ...(p.search
      ? {
          OR: [
            { name: { contains: p.search, mode: "insensitive" } },
            { nameAr: { contains: p.search, mode: "insensitive" } },
            { sku: { contains: p.search, mode: "insensitive" } },
            { productCode: { contains: p.search, mode: "insensitive" } },
            { barcodes: { some: { barcode: { contains: p.search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: {
        category: true,
        brand: true,
        unit: true,
        taxRate: true,
        barcodes: true,
        variants: { where: { status: { not: MasterStatus.ARCHIVED } } },
      },
      orderBy: { updatedAt: "desc" },
      skip: p.skip,
      take: p.pageSize,
    }),
  ]);
  return pageResult(items, total, p.page, p.pageSize);
}

export async function getProduct(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: true,
      brand: true,
      unit: true,
      taxRate: true,
      barcodes: true,
      variants: true,
      priceHistory: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!product) throw new AppError("Product not found", 404);
  assertSameTenant(product.organizationId, tid);
  return product;
}

async function assertUniqueSku(tenantId: string, sku: string, excludeId?: string) {
  const existing = await prisma.product.findFirst({
    where: {
      organizationId: tenantId,
      sku,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
  });
  if (existing) throw new AppError("Duplicate SKU", 409);
}

async function assertUniqueProductCode(tenantId: string, productCode: string | null | undefined, excludeId?: string) {
  if (!productCode) return;
  const existing = await prisma.product.findFirst({
    where: {
      organizationId: tenantId,
      productCode,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
  });
  if (existing) throw new AppError("Duplicate product code", 409);
}

async function assertUniqueBarcodes(tenantId: string, barcodes: string[], excludeProductId?: string) {
  if (!barcodes.length) return;
  const existing = await prisma.productBarcode.findFirst({
    where: {
      organizationId: tenantId,
      barcode: { in: barcodes },
      ...(excludeProductId ? { NOT: { productId: excludeProductId } } : {}),
    },
  });
  if (existing) throw new AppError(`Duplicate barcode: ${existing.barcode}`, 409);
}

export async function createProduct(
  tenantId: TenantId,
  data: {
    name: string;
    nameAr?: string | null;
    sku: string;
    productCode?: string | null;
    description?: string | null;
    descriptionAr?: string | null;
    categoryId?: string | null;
    brandId?: string | null;
    unitId: string;
    taxRateId?: string | null;
    purchasePrice?: number;
    sellingPrice?: number;
    minStock?: number;
    maxStock?: number | null;
    reorderLevel?: number | null;
    imageUrl?: string | null;
    costingMethod?: CostingMethod;
    status?: MasterStatus;
    barcodes?: Array<{ barcode: string; isPrimary?: boolean }>;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const productCode = data.productCode?.trim() ? data.productCode.trim() : null;
  await assertUniqueSku(tid, data.sku);
  await assertUniqueProductCode(tid, productCode);
  const barcodeValues = (data.barcodes || []).map((b) => b.barcode);
  await assertUniqueBarcodes(tid, barcodeValues);

  const unit = await prisma.unitOfMeasure.findUnique({ where: { id: data.unitId } });
  if (!unit) throw new AppError("Unit not found", 404);
  assertSameTenant(unit.organizationId, tid);

  const purchasePrice = data.purchasePrice ?? 0;
  const sellingPrice = data.sellingPrice ?? 0;

  const product = await prisma.product.create({
    data: {
      organizationId: tid,
      name: data.name,
      nameAr: data.nameAr,
      sku: data.sku,
      productCode,
      description: data.description,
      descriptionAr: data.descriptionAr,
      categoryId: data.categoryId,
      brandId: data.brandId,
      unitId: data.unitId,
      taxRateId: data.taxRateId,
      purchasePrice: new Prisma.Decimal(purchasePrice),
      sellingPrice: new Prisma.Decimal(sellingPrice),
      minStock: new Prisma.Decimal(data.minStock ?? 0),
      maxStock: data.maxStock == null ? null : new Prisma.Decimal(data.maxStock),
      reorderLevel: data.reorderLevel == null ? null : new Prisma.Decimal(data.reorderLevel),
      imageUrl: data.imageUrl,
      costingMethod: data.costingMethod ?? CostingMethod.WEIGHTED_AVERAGE,
      status: data.status,
      barcodes: data.barcodes?.length
        ? {
            create: data.barcodes.map((b, idx) => ({
              organizationId: tid,
              barcode: b.barcode,
              isPrimary: b.isPrimary ?? idx === 0,
            })),
          }
        : undefined,
      priceHistory: {
        create: {
          organizationId: tid,
          purchasePrice: new Prisma.Decimal(purchasePrice),
          sellingPrice: new Prisma.Decimal(sellingPrice),
          note: "Initial price",
          changedByUserId: userId,
        },
      },
    },
    include: { barcodes: true, category: true, brand: true, unit: true },
  });

  // Ensure product appears in stock list with zero qty (single warehouse).
  const warehouse = await prisma.warehouse.findFirst({
    where: { organizationId: tid, isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  if (warehouse) {
    await prisma.stockBalance.upsert({
      where: {
        organizationId_warehouseId_productId_variantKey: {
          organizationId: tid,
          warehouseId: warehouse.id,
          productId: product.id,
          variantKey: "",
        },
      },
      create: {
        organizationId: tid,
        warehouseId: warehouse.id,
        productId: product.id,
        variantKey: "",
        quantityOnHand: new Prisma.Decimal(0),
        quantityReserved: new Prisma.Decimal(0),
        totalValue: new Prisma.Decimal(0),
      },
      update: {},
    });
  }

  return product;
}

export async function updateProduct(
  tenantId: TenantId,
  id: string,
  data: Record<string, unknown>,
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw new AppError("Product not found", 404);
  assertSameTenant(existing.organizationId, tid);

  if (typeof data.sku === "string") await assertUniqueSku(tid, data.sku, id);
  if (data.productCode !== undefined) {
    await assertUniqueProductCode(tid, data.productCode as string | null, id);
  }

  const priceChanged =
    (typeof data.purchasePrice === "number" &&
      Number(existing.purchasePrice) !== data.purchasePrice) ||
    (typeof data.sellingPrice === "number" &&
      Number(existing.sellingPrice) !== data.sellingPrice);

  const payload: Prisma.ProductUpdateInput = {};
  const scalarKeys = [
    "name",
    "nameAr",
    "sku",
    "productCode",
    "description",
    "descriptionAr",
    "imageUrl",
    "costingMethod",
    "status",
  ] as const;
  for (const key of scalarKeys) {
    if (data[key] !== undefined) (payload as Record<string, unknown>)[key] = data[key];
  }
  if (data.categoryId !== undefined) {
    payload.category = data.categoryId
      ? { connect: { id: String(data.categoryId) } }
      : { disconnect: true };
  }
  if (data.brandId !== undefined) {
    payload.brand = data.brandId
      ? { connect: { id: String(data.brandId) } }
      : { disconnect: true };
  }
  if (data.unitId) payload.unit = { connect: { id: String(data.unitId) } };
  if (data.taxRateId !== undefined) {
    payload.taxRate = data.taxRateId
      ? { connect: { id: String(data.taxRateId) } }
      : { disconnect: true };
  }
  if (typeof data.purchasePrice === "number") {
    payload.purchasePrice = new Prisma.Decimal(data.purchasePrice);
  }
  if (typeof data.sellingPrice === "number") {
    payload.sellingPrice = new Prisma.Decimal(data.sellingPrice);
  }
  if (typeof data.minStock === "number") payload.minStock = new Prisma.Decimal(data.minStock);
  if (data.maxStock !== undefined) {
    payload.maxStock =
      data.maxStock == null ? null : new Prisma.Decimal(Number(data.maxStock));
  }
  if (data.reorderLevel !== undefined) {
    payload.reorderLevel =
      data.reorderLevel == null ? null : new Prisma.Decimal(Number(data.reorderLevel));
  }

  const product = await prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id },
      data: payload,
      include: { barcodes: true, category: true, brand: true, unit: true },
    });

    if (priceChanged) {
      await tx.productPriceHistory.create({
        data: {
          organizationId: tid,
          productId: id,
          purchasePrice: updated.purchasePrice,
          sellingPrice: updated.sellingPrice,
          note: "Price update",
          changedByUserId: userId,
        },
      });
    }

    if (Array.isArray(data.barcodes)) {
      const barcodes = data.barcodes as Array<{ barcode: string; isPrimary?: boolean }>;
      await assertUniqueBarcodes(
        tid,
        barcodes.map((b) => b.barcode),
        id
      );
      await tx.productBarcode.deleteMany({ where: { productId: id } });
      if (barcodes.length) {
        await tx.productBarcode.createMany({
          data: barcodes.map((b, idx) => ({
            organizationId: tid,
            productId: id,
            barcode: b.barcode,
            isPrimary: b.isPrimary ?? idx === 0,
          })),
        });
      }
    }

    return tx.product.findUniqueOrThrow({
      where: { id },
      include: { barcodes: true, category: true, brand: true, unit: true, variants: true },
    });
  });

  return product;
}

export async function archiveProduct(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw new AppError("Product not found", 404);
  assertSameTenant(existing.organizationId, tid);
  return prisma.product.update({
    where: { id },
    data: { status: MasterStatus.ARCHIVED, archivedAt: new Date() },
  });
}

export async function addVariant(
  tenantId: TenantId,
  productId: string,
  data: {
    name: string;
    sku: string;
    attributes?: Record<string, unknown>;
    purchasePrice?: number | null;
    sellingPrice?: number | null;
    status?: MasterStatus;
  }
) {
  const tid = requireTenantId(tenantId);
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new AppError("Product not found", 404);
  assertSameTenant(product.organizationId, tid);

  const dup = await prisma.productVariant.findFirst({
    where: { organizationId: tid, sku: data.sku },
  });
  if (dup) throw new AppError("Duplicate variant SKU", 409);

  return prisma.productVariant.create({
    data: {
      organizationId: tid,
      productId,
      name: data.name,
      sku: data.sku,
      attributes: data.attributes as Prisma.InputJsonValue | undefined,
      purchasePrice:
        data.purchasePrice == null ? null : new Prisma.Decimal(data.purchasePrice),
      sellingPrice:
        data.sellingPrice == null ? null : new Prisma.Decimal(data.sellingPrice),
      status: data.status,
    },
  });
}

export async function listPriceHistory(tenantId: TenantId, productId: string) {
  const tid = requireTenantId(tenantId);
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new AppError("Product not found", 404);
  assertSameTenant(product.organizationId, tid);
  return prisma.productPriceHistory.findMany({
    where: { organizationId: tid, productId },
    orderBy: { createdAt: "desc" },
  });
}

/** Bulk import preparation — validates rows and optionally inserts */
export async function bulkImportProducts(
  tenantId: TenantId,
  rows: Array<Record<string, unknown>>,
  dryRun = true,
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const errors: Array<{ row: number; message: string }> = [];
  const prepared: Array<Record<string, unknown>> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const sku = String(row.sku || "").trim();
    const name = String(row.name || "").trim();
    const unitCode = String(row.unitCode || "PCS").trim();
    if (!sku || !name) {
      errors.push({ row: i + 1, message: "sku and name are required" });
      continue;
    }
    const unit = await prisma.unitOfMeasure.findUnique({
      where: { organizationId_code: { organizationId: tid, code: unitCode } },
    });
    if (!unit) {
      errors.push({ row: i + 1, message: `Unknown unitCode ${unitCode}` });
      continue;
    }
    const dup = await prisma.product.findFirst({ where: { organizationId: tid, sku } });
    if (dup) {
      errors.push({ row: i + 1, message: `Duplicate SKU ${sku}` });
      continue;
    }
    prepared.push({ ...row, unitId: unit.id, sku, name });
  }

  if (dryRun || errors.length) {
    return {
      dryRun: true,
      accepted: prepared.length,
      rejected: errors.length,
      errors,
      sample: prepared.slice(0, 5),
    };
  }

  const created = [];
  for (const row of prepared) {
    created.push(
      await createProduct(
        tid,
        {
          name: String(row.name),
          sku: String(row.sku),
          unitId: String(row.unitId),
          purchasePrice: Number(row.purchasePrice || 0),
          sellingPrice: Number(row.sellingPrice || 0),
          productCode: row.productCode ? String(row.productCode) : null,
        },
        userId
      )
    );
  }
  return { dryRun: false, created: created.length, items: created };
}

export async function exportProducts(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const items = await prisma.product.findMany({
    where: { organizationId: tid, status: { not: MasterStatus.ARCHIVED } },
    include: { unit: true, category: true, brand: true, barcodes: true },
    orderBy: { sku: "asc" },
  });
  return {
    entity: "products",
    generatedAt: new Date().toISOString(),
    count: items.length,
    rows: items.map((p) => ({
      sku: p.sku,
      productCode: p.productCode,
      name: p.name,
      nameAr: p.nameAr,
      unitCode: p.unit.code,
      category: p.category?.name,
      brand: p.brand?.name,
      purchasePrice: Number(p.purchasePrice),
      sellingPrice: Number(p.sellingPrice),
      minStock: Number(p.minStock),
      barcodes: p.barcodes.map((b) => b.barcode),
      costingMethod: p.costingMethod,
      status: p.status,
    })),
  };
}
