import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

export async function listPriceLists(tenantId: TenantId) {
  return prisma.priceList.findMany({
    where: { organizationId: requireTenantId(tenantId), isActive: true },
    include: { items: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

export async function createPriceList(
  tenantId: TenantId,
  data: {
    code: string;
    name: string;
    nameAr?: string | null;
    currency?: string;
    isDefault?: boolean;
    items?: Array<{ productId: string; unitPrice: number; minQty?: number }>;
  }
) {
  const tid = requireTenantId(tenantId);
  const dup = await prisma.priceList.findUnique({
    where: { organizationId_code: { organizationId: tid, code: data.code } },
  });
  if (dup) throw new AppError("Duplicate price list code", 409);

  return prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.priceList.updateMany({
        where: { organizationId: tid, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.priceList.create({
      data: {
        organizationId: tid,
        code: data.code,
        name: data.name,
        nameAr: data.nameAr,
        currency: data.currency || "EGP",
        isDefault: Boolean(data.isDefault),
        items: data.items?.length
          ? {
              create: data.items.map((i) => ({
                organizationId: tid,
                productId: i.productId,
                unitPrice: new Prisma.Decimal(i.unitPrice),
                minQty: new Prisma.Decimal(i.minQty ?? 1),
              })),
            }
          : undefined,
      },
      include: { items: true },
    });
  });
}

export async function upsertPriceListItem(
  tenantId: TenantId,
  priceListId: string,
  data: { productId: string; unitPrice: number; minQty?: number }
) {
  const tid = requireTenantId(tenantId);
  const list = await prisma.priceList.findUnique({ where: { id: priceListId } });
  if (!list) throw new AppError("Price list not found", 404);
  assertSameTenant(list.organizationId, tid);

  return prisma.priceListItem.upsert({
    where: {
      priceListId_productId: { priceListId, productId: data.productId },
    },
    create: {
      organizationId: tid,
      priceListId,
      productId: data.productId,
      unitPrice: new Prisma.Decimal(data.unitPrice),
      minQty: new Prisma.Decimal(data.minQty ?? 1),
    },
    update: {
      unitPrice: new Prisma.Decimal(data.unitPrice),
      ...(data.minQty != null ? { minQty: new Prisma.Decimal(data.minQty) } : {}),
    },
  });
}

export async function setCustomerPriceOverride(
  tenantId: TenantId,
  data: {
    customerId: string;
    productId: string;
    unitPrice: number;
    discountPercent?: number;
  }
) {
  const tid = requireTenantId(tenantId);
  return prisma.customerPriceOverride.upsert({
    where: {
      customerId_productId: { customerId: data.customerId, productId: data.productId },
    },
    create: {
      organizationId: tid,
      customerId: data.customerId,
      productId: data.productId,
      unitPrice: new Prisma.Decimal(data.unitPrice),
      discountPercent: new Prisma.Decimal(data.discountPercent ?? 0),
    },
    update: {
      unitPrice: new Prisma.Decimal(data.unitPrice),
      discountPercent: new Prisma.Decimal(data.discountPercent ?? 0),
    },
  });
}

export async function createDiscountRule(
  tenantId: TenantId,
  data: {
    code: string;
    name: string;
    percent: number;
    maxPercent?: number | null;
    requiresAuth?: boolean;
  }
) {
  const tid = requireTenantId(tenantId);
  return prisma.discountRule.create({
    data: {
      organizationId: tid,
      code: data.code,
      name: data.name,
      percent: new Prisma.Decimal(data.percent),
      maxPercent: data.maxPercent != null ? new Prisma.Decimal(data.maxPercent) : null,
      requiresAuth: Boolean(data.requiresAuth),
    },
  });
}

export async function listDiscountRules(tenantId: TenantId) {
  return prisma.discountRule.findMany({
    where: { organizationId: requireTenantId(tenantId), isActive: true },
    orderBy: { code: "asc" },
  });
}

/** Resolve unit price: customer override → price list → product.sellingPrice */
export async function resolveUnitPrice(
  tenantId: TenantId,
  args: {
    customerId: string;
    productId: string;
    priceListId?: string | null;
    quantity?: number;
    manualUnitPrice?: number | null;
    allowManualPrice?: boolean;
  }
) {
  const tid = requireTenantId(tenantId);
  const product = await prisma.product.findFirst({
    where: { id: args.productId, organizationId: tid },
  });
  if (!product) throw new AppError("Product not found", 404);

  if (args.manualUnitPrice != null) {
    if (!args.allowManualPrice) {
      throw new AppError("Manual price change requires authorization (allowManualPrice)", 403);
    }
    return {
      unitPrice: args.manualUnitPrice,
      listPrice: Number(product.sellingPrice),
      manualPrice: true,
      source: "MANUAL" as const,
    };
  }

  const override = await prisma.customerPriceOverride.findUnique({
    where: {
      customerId_productId: { customerId: args.customerId, productId: args.productId },
    },
  });
  if (override) {
    return {
      unitPrice: Number(override.unitPrice),
      listPrice: Number(product.sellingPrice),
      manualPrice: false,
      source: "CUSTOMER_OVERRIDE" as const,
      discountPercent: Number(override.discountPercent),
    };
  }

  let priceListId = args.priceListId;
  if (!priceListId) {
    const customer = await prisma.customer.findUnique({ where: { id: args.customerId } });
    priceListId = customer?.priceListId ?? null;
  }
  if (!priceListId) {
    const def = await prisma.priceList.findFirst({
      where: { organizationId: tid, isDefault: true, isActive: true },
    });
    priceListId = def?.id ?? null;
  }

  if (priceListId) {
    const item = await prisma.priceListItem.findUnique({
      where: {
        priceListId_productId: { priceListId, productId: args.productId },
      },
    });
    if (item && Number(args.quantity ?? 1) >= Number(item.minQty)) {
      return {
        unitPrice: Number(item.unitPrice),
        listPrice: Number(item.unitPrice),
        manualPrice: false,
        source: "PRICE_LIST" as const,
      };
    }
  }

  return {
    unitPrice: Number(product.sellingPrice),
    listPrice: Number(product.sellingPrice),
    manualPrice: false,
    source: "PRODUCT" as const,
  };
}
