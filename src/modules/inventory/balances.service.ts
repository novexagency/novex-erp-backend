import { Prisma, PurchaseDocStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireTenantId } from "../../lib/tenantDb.js";
import type { TenantId } from "../../types/tenant.js";
import { getActiveWarehouse } from "./ledger.service.js";

type ProductStockFields = {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  minStock: Prisma.Decimal;
  maxStock: Prisma.Decimal | null;
  reorderLevel: Prisma.Decimal | null;
  costingMethod?: string;
};

function enrichBalance(row: {
  productId?: string;
  quantityOnHand: Prisma.Decimal;
  quantityReserved: Prisma.Decimal;
  avgUnitCost: Prisma.Decimal | null;
  totalValue: Prisma.Decimal;
  product?: ProductStockFields | null;
  incoming?: number;
  outgoing?: number;
}) {
  const onHand = Number(row.quantityOnHand);
  const reserved = Number(row.quantityReserved);
  const available = onHand - reserved;
  const avg = row.avgUnitCost != null ? Number(row.avgUnitCost) : null;
  const minStock = row.product ? Number(row.product.minStock) : 0;
  const maxStock = row.product?.maxStock != null ? Number(row.product.maxStock) : null;
  const reorderLevel =
    row.product?.reorderLevel != null ? Number(row.product.reorderLevel) : minStock;
  return {
    productId: row.productId,
    product: row.product,
    quantityOnHand: onHand,
    quantityReserved: reserved,
    quantityAvailable: available,
    quantityIncoming: row.incoming ?? 0,
    quantityOutgoing: row.outgoing ?? reserved,
    avgUnitCost: avg,
    totalValue: Number(row.totalValue),
    minStock,
    maxStock,
    reorderLevel,
    isLowStock: available <= reorderLevel,
    isOverStock: maxStock != null && onHand > maxStock,
  };
}

async function incomingByProduct(tid: string): Promise<Map<string, number>> {
  const lines = await prisma.purchaseOrderLine.findMany({
    where: {
      organizationId: tid,
      purchaseOrder: {
        status: { in: [PurchaseDocStatus.ISSUED, PurchaseDocStatus.PARTIALLY_RECEIVED] },
      },
    },
    select: { productId: true, quantity: true, quantityReceived: true },
  });
  const map = new Map<string, number>();
  for (const l of lines) {
    const rem = Number(l.quantity) - Number(l.quantityReceived);
    if (rem > 0) map.set(l.productId, (map.get(l.productId) ?? 0) + rem);
  }
  return map;
}

export async function listStockBalances(
  tenantId: TenantId,
  query?: { lowStockOnly?: boolean; search?: string }
) {
  const tid = requireTenantId(tenantId);
  const warehouse = await getActiveWarehouse(tid);
  const incoming = await incomingByProduct(tid);

  const items = await prisma.stockBalance.findMany({
    where: {
      organizationId: tid,
      warehouseId: warehouse.id,
      ...(query?.search
        ? {
            product: {
              OR: [
                { name: { contains: query.search, mode: "insensitive" } },
                { sku: { contains: query.search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          nameAr: true,
          minStock: true,
          maxStock: true,
          reorderLevel: true,
          costingMethod: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  let enriched = items.map((i) =>
    enrichBalance({
      productId: i.productId,
      quantityOnHand: i.quantityOnHand,
      quantityReserved: i.quantityReserved,
      avgUnitCost: i.avgUnitCost,
      totalValue: i.totalValue,
      product: i.product,
      incoming: incoming.get(i.productId) ?? 0,
      outgoing: Number(i.quantityReserved),
    })
  );
  if (query?.lowStockOnly) enriched = enriched.filter((i) => i.isLowStock);

  return {
    warehouseId: warehouse.id,
    costingMethod: "WEIGHTED_AVERAGE",
    items: enriched,
  };
}

export async function getStockBalance(tenantId: TenantId, productId: string) {
  const tid = requireTenantId(tenantId);
  const warehouse = await getActiveWarehouse(tid);
  const incoming = await incomingByProduct(tid);
  const bal = await prisma.stockBalance.findUnique({
    where: {
      organizationId_warehouseId_productId_variantKey: {
        organizationId: tid,
        warehouseId: warehouse.id,
        productId,
        variantKey: "",
      },
    },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          nameAr: true,
          minStock: true,
          maxStock: true,
          reorderLevel: true,
          costingMethod: true,
        },
      },
    },
  });

  if (!bal) {
    const product = await prisma.product.findFirst({
      where: { id: productId, organizationId: tid },
      select: {
        id: true,
        sku: true,
        name: true,
        nameAr: true,
        minStock: true,
        maxStock: true,
        reorderLevel: true,
        costingMethod: true,
      },
    });
    return {
      warehouseId: warehouse.id,
      ...enrichBalance({
        productId,
        quantityOnHand: new Prisma.Decimal(0),
        quantityReserved: new Prisma.Decimal(0),
        avgUnitCost: null,
        totalValue: new Prisma.Decimal(0),
        product,
        incoming: incoming.get(productId) ?? 0,
        outgoing: 0,
      }),
    };
  }

  return {
    warehouseId: warehouse.id,
    ...enrichBalance({
      productId: bal.productId,
      quantityOnHand: bal.quantityOnHand,
      quantityReserved: bal.quantityReserved,
      avgUnitCost: bal.avgUnitCost,
      totalValue: bal.totalValue,
      product: bal.product,
      incoming: incoming.get(productId) ?? 0,
      outgoing: Number(bal.quantityReserved),
    }),
  };
}

export async function listMovements(
  tenantId: TenantId,
  query?: {
    productId?: string;
    referenceType?: string;
    referenceId?: string;
    type?: string;
    from?: string;
    to?: string;
  }
) {
  const tid = requireTenantId(tenantId);
  return prisma.inventoryMovement.findMany({
    where: {
      organizationId: tid,
      ...(query?.productId ? { productId: query.productId } : {}),
      ...(query?.referenceType ? { referenceType: query.referenceType } : {}),
      ...(query?.referenceId ? { referenceId: query.referenceId } : {}),
      ...(query?.type ? { type: query.type as never } : {}),
      ...(query?.from || query?.to
        ? {
            postedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    },
    include: {
      product: { select: { id: true, sku: true, name: true } },
    },
    orderBy: { postedAt: "desc" },
    take: 500,
  });
}

export async function lookupByBarcode(tenantId: TenantId, barcode: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.productBarcode.findFirst({
    where: { organizationId: tid, barcode },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          nameAr: true,
          minStock: true,
          maxStock: true,
          reorderLevel: true,
          costingMethod: true,
        },
      },
    },
  });
  if (!row) return null;
  const stock = await getStockBalance(tid, row.productId);
  return { barcode: row.barcode, product: row.product, stock };
}

export async function inventoryValuation(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const list = await listStockBalances(tid);
  const totalValue = list.items.reduce((s, i) => s + i.totalValue, 0);
  return {
    warehouseId: list.warehouseId,
    costingMethod: "WEIGHTED_AVERAGE",
    itemCount: list.items.length,
    totalValue: Number(totalValue.toFixed(4)),
    items: list.items.map((i) => ({
      productId: i.productId,
      sku: i.product?.sku,
      name: i.product?.name,
      quantityOnHand: i.quantityOnHand,
      avgUnitCost: i.avgUnitCost,
      totalValue: i.totalValue,
      costingMethod: i.product?.costingMethod ?? "WEIGHTED_AVERAGE",
    })),
  };
}
