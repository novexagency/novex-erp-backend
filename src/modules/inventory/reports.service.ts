import { prisma } from "../../lib/prisma.js";
import { requireTenantId } from "../../lib/tenantDb.js";
import type { TenantId } from "../../types/tenant.js";
import { listStockBalances } from "./balances.service.js";
import { getActiveWarehouse } from "./ledger.service.js";

export async function lowStockAlerts(tenantId: TenantId) {
  const list = await listStockBalances(tenantId, { lowStockOnly: true });
  return {
    warehouseId: list.warehouseId,
    count: list.items.length,
    items: list.items,
  };
}

export async function reorderAlerts(tenantId: TenantId) {
  const list = await listStockBalances(tenantId);
  const items = list.items.filter((i) => i.quantityAvailable <= i.reorderLevel);
  return { warehouseId: list.warehouseId, count: items.length, items };
}

/** Products with no outbound movement in the last N days (default 90). */
export async function slowMovingReport(tenantId: TenantId, days = 90) {
  const tid = requireTenantId(tenantId);
  const warehouse = await getActiveWarehouse(tid);
  const since = new Date(Date.now() - days * 86400000);

  const balances = await prisma.stockBalance.findMany({
    where: {
      organizationId: tid,
      warehouseId: warehouse.id,
      quantityOnHand: { gt: 0 },
    },
    include: {
      product: { select: { id: true, sku: true, name: true, nameAr: true } },
    },
  });

  const recentOut = await prisma.inventoryMovement.findMany({
    where: {
      organizationId: tid,
      warehouseId: warehouse.id,
      direction: "OUT",
      postedAt: { gte: since },
    },
    select: { productId: true },
    distinct: ["productId"],
  });
  const moved = new Set(recentOut.map((m) => m.productId));

  const items = balances
    .filter((b) => !moved.has(b.productId))
    .map((b) => ({
      productId: b.productId,
      product: b.product,
      quantityOnHand: Number(b.quantityOnHand),
      avgUnitCost: b.avgUnitCost != null ? Number(b.avgUnitCost) : null,
      totalValue: Number(b.totalValue),
      lastMovementAt: b.lastMovementAt,
      daysWithoutOutbound: days,
    }));

  return { warehouseId: warehouse.id, days, count: items.length, items };
}

/** Inventory aging buckets by last movement / lot received date. */
export async function inventoryAging(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const warehouse = await getActiveWarehouse(tid);
  const now = Date.now();
  const balances = await prisma.stockBalance.findMany({
    where: { organizationId: tid, warehouseId: warehouse.id, quantityOnHand: { gt: 0 } },
    include: { product: { select: { id: true, sku: true, name: true } } },
  });

  const buckets = { "0-30": [] as unknown[], "31-60": [] as unknown[], "61-90": [] as unknown[], "90+": [] as unknown[] };

  for (const b of balances) {
    const ref = b.lastMovementAt ?? b.createdAt;
    const ageDays = Math.floor((now - ref.getTime()) / 86400000);
    const item = {
      productId: b.productId,
      product: b.product,
      quantityOnHand: Number(b.quantityOnHand),
      totalValue: Number(b.totalValue),
      ageDays,
      lastMovementAt: b.lastMovementAt,
    };
    if (ageDays <= 30) buckets["0-30"].push(item);
    else if (ageDays <= 60) buckets["31-60"].push(item);
    else if (ageDays <= 90) buckets["61-90"].push(item);
    else buckets["90+"].push(item);
  }

  return { warehouseId: warehouse.id, buckets };
}

export async function expiryReport(tenantId: TenantId, withinDays = 60) {
  const tid = requireTenantId(tenantId);
  const warehouse = await getActiveWarehouse(tid);
  const until = new Date(Date.now() + withinDays * 86400000);
  const lots = await prisma.inventoryLot.findMany({
    where: {
      organizationId: tid,
      warehouseId: warehouse.id,
      quantityRemaining: { gt: 0 },
      expiryDate: { not: null, lte: until },
    },
    include: { product: { select: { id: true, sku: true, name: true } } },
    orderBy: { expiryDate: "asc" },
  });
  return {
    warehouseId: warehouse.id,
    withinDays,
    items: lots.map((l) => ({
      lotId: l.id,
      product: l.product,
      batchNumber: l.batchNumber,
      expiryDate: l.expiryDate,
      quantityRemaining: Number(l.quantityRemaining),
      unitCost: Number(l.unitCost),
    })),
  };
}

export async function listLots(tenantId: TenantId, productId?: string) {
  const tid = requireTenantId(tenantId);
  const warehouse = await getActiveWarehouse(tid);
  return prisma.inventoryLot.findMany({
    where: {
      organizationId: tid,
      warehouseId: warehouse.id,
      ...(productId ? { productId } : {}),
      quantityRemaining: { gt: 0 },
    },
    include: { product: { select: { id: true, sku: true, name: true } } },
    orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }],
  });
}
