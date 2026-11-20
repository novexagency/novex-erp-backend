import { prisma } from "../../lib/prisma.js";
import { requireTenantId } from "../../lib/tenantDb.js";
import type { TenantId } from "../../types/tenant.js";
import * as invBalances from "../inventory/balances.service.js";
import * as invReports from "../inventory/reports.service.js";
import { n, round4 } from "./period.js";
import { salesByProduct } from "./sales-reports.service.js";

export async function currentStock(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const rows = await prisma.stockBalance.findMany({
    where: { organizationId: tid },
    include: {
      product: { select: { sku: true, name: true, minStock: true, reorderLevel: true } },
      warehouse: { select: { code: true, name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  const items = rows.map((b) => ({
    productId: b.productId,
    sku: b.product.sku,
    name: b.product.name,
    warehouse: b.warehouse.code,
    quantityOnHand: n(b.quantityOnHand),
    quantityReserved: n(b.quantityReserved),
    available: round4(n(b.quantityOnHand) - n(b.quantityReserved)),
    avgUnitCost: n(b.avgUnitCost),
    totalValue: n(b.totalValue),
  }));
  return {
    definitions: {
      available: "quantityOnHand - quantityReserved",
      totalValue: "Cached onHand * avgUnitCost (WAC)",
    },
    rows: items,
    items,
  };
}

export async function stockValuation(tenantId: TenantId) {
  const data = await invBalances.inventoryValuation(tenantId);
  return {
    ...data,
    definitions: {
      valuation: "Weighted average cost (WAC) on StockBalance — not FIFO",
    },
  };
}

export async function stockMovements(tenantId: TenantId, from?: string, to?: string) {
  const tid = requireTenantId(tenantId);
  const movements = await prisma.inventoryMovement.findMany({
    where: {
      organizationId: tid,
      ...(from || to
        ? {
            postedAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    },
    include: {
      product: { select: { sku: true, name: true } },
    },
    orderBy: { postedAt: "desc" },
    take: 500,
  });
  const rows = movements.map((m) => ({
    id: m.id,
    postedAt: m.postedAt,
    type: m.type,
    direction: m.direction,
    sku: m.product.sku,
    name: m.product.name,
    quantity: n(m.quantity),
    unitCost: n(m.unitCost),
    referenceType: m.referenceType,
    referenceCode: m.referenceCode,
  }));
  return { from: from ?? null, to: to ?? null, rows, items: rows };
}

export async function lowStock(tenantId: TenantId) {
  return invReports.lowStockAlerts(tenantId);
}

export async function inventoryAging(tenantId: TenantId) {
  return invReports.inventoryAging(tenantId);
}

export async function stockCountDifferences(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const counts = await prisma.stockCount.findMany({
    where: {
      organizationId: tid,
      status: { in: ["POSTED", "APPROVED"] },
    },
    include: {
      lines: {
        include: { product: { select: { sku: true, name: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const rows: Array<Record<string, unknown>> = [];
  for (const c of counts) {
    for (const line of c.lines) {
      const systemQty = n(line.systemQuantity);
      const countedQty = n(line.countedQuantity);
      const variance = round4(countedQty - systemQty);
      if (Math.abs(variance) < 0.0001) continue;
      rows.push({
        countCode: c.code,
        sku: line.product.sku,
        name: line.product.name,
        systemQty,
        countedQty,
        variance,
      });
    }
  }
  return {
    definitions: {
      variance: "countedQuantity - systemQuantity from posted/approved stock counts",
    },
    rows,
    items: rows,
  };
}

export async function productProfitability(tenantId: TenantId, from?: string, to?: string) {
  return salesByProduct(tenantId, from, to);
}
