import { InventoryDirection, InventoryMovementType, Prisma, StockDocStatus } from "@prisma/client";
import { nextDocumentNumber } from "../../lib/documentNumber.js";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { applyMovement, getActiveWarehouse } from "./ledger.service.js";

export async function createStockCount(
  tenantId: TenantId,
  data: { notes?: string | null; productIds?: string[] },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const warehouse = await getActiveWarehouse(tid);

  const balances = await prisma.stockBalance.findMany({
    where: {
      organizationId: tid,
      warehouseId: warehouse.id,
      ...(data.productIds?.length ? { productId: { in: data.productIds } } : {}),
    },
  });

  // Also allow counting products with zero balance if explicitly listed
  const productIds = new Set(balances.map((b) => b.productId));
  if (data.productIds) {
    for (const id of data.productIds) productIds.add(id);
  }

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "CNT", "CNT");
    const lines: Array<{
      organizationId: string;
      productId: string;
      systemQuantity: Prisma.Decimal;
      unitCost: Prisma.Decimal | null;
    }> = [];
    for (const productId of productIds) {
      const bal = balances.find((b) => b.productId === productId);
      lines.push({
        organizationId: tid,
        productId,
        systemQuantity: bal?.quantityOnHand ?? new Prisma.Decimal(0),
        unitCost: bal?.avgUnitCost ?? null,
      });
    }
    if (!lines.length) throw new AppError("No products to count", 400);

    return tx.stockCount.create({
      data: {
        organizationId: tid,
        warehouseId: warehouse.id,
        code,
        notes: data.notes,
        status: StockDocStatus.IN_PROGRESS,
        countedAt: new Date(),
        createdByUserId: userId,
        lines: { create: lines },
      },
      include: { lines: { include: { product: true } } },
    });
  });
}

export async function recordCountQuantities(
  tenantId: TenantId,
  countId: string,
  lines: Array<{ productId: string; countedQuantity: number; note?: string | null }>
) {
  const tid = requireTenantId(tenantId);
  const count = await prisma.stockCount.findUnique({
    where: { id: countId },
    include: { lines: true },
  });
  if (!count) throw new AppError("Stock count not found", 404);
  assertSameTenant(count.organizationId, tid);
  if (
    count.status !== StockDocStatus.DRAFT &&
    count.status !== StockDocStatus.IN_PROGRESS
  ) {
    throw new AppError("Count is locked", 400);
  }

  for (const input of lines) {
    const line = count.lines.find((l) => l.productId === input.productId);
    if (!line) throw new AppError(`Product ${input.productId} not on this count`, 400);
    const diff = input.countedQuantity - Number(line.systemQuantity);
    await prisma.stockCountLine.update({
      where: { id: line.id },
      data: {
        countedQuantity: new Prisma.Decimal(input.countedQuantity),
        difference: new Prisma.Decimal(diff.toFixed(4)),
        note: input.note,
      },
    });
  }

  return getStockCount(tid, countId);
}

export async function getStockCount(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.stockCount.findUnique({
    where: { id },
    include: { lines: { include: { product: true } } },
  });
  if (!row) throw new AppError("Stock count not found", 404);
  assertSameTenant(row.organizationId, tid);
  return row;
}

export async function listStockCounts(tenantId: TenantId) {
  return prisma.stockCount.findMany({
    where: { organizationId: requireTenantId(tenantId) },
    include: { lines: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function submitStockCount(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const count = await getStockCount(tid, id);
  const missing = count.lines.filter((l) => l.countedQuantity == null);
  if (missing.length) throw new AppError("All lines must have counted quantities", 400);
  return prisma.stockCount.update({
    where: { id },
    data: { status: StockDocStatus.PENDING_APPROVAL, submittedAt: new Date() },
    include: { lines: true },
  });
}

export async function approveStockCount(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);
  const count = await getStockCount(tid, id);
  if (count.status !== StockDocStatus.PENDING_APPROVAL) {
    throw new AppError("Count must be pending approval", 400);
  }
  return prisma.stockCount.update({
    where: { id },
    data: {
      status: StockDocStatus.APPROVED,
      approvedAt: new Date(),
      approvedByUserId: userId,
    },
    include: { lines: true },
  });
}

/** Post approved count differences as STOCK_COUNT_ADJ movements. */
export async function postStockCount(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);

  return prisma.$transaction(async (tx) => {
    const count = await tx.stockCount.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!count) throw new AppError("Stock count not found", 404);
    assertSameTenant(count.organizationId, tid);
    if (count.status === StockDocStatus.POSTED) throw new AppError("Count already posted", 409);
    if (count.status !== StockDocStatus.APPROVED) {
      throw new AppError("Count must be approved before posting adjustments", 400);
    }

    for (const line of count.lines) {
      if (line.countedQuantity == null || line.difference == null) continue;
      const diff = Number(line.difference);
      if (Math.abs(diff) < 0.0001) continue;

      await applyMovement(tx, {
        organizationId: tid,
        warehouseId: count.warehouseId,
        productId: line.productId,
        type: InventoryMovementType.STOCK_COUNT_ADJ,
        direction: diff > 0 ? InventoryDirection.IN : InventoryDirection.OUT,
        quantity: Math.abs(diff),
        unitCost: line.unitCost != null ? Number(line.unitCost) : null,
        referenceType: "STOCK_COUNT",
        referenceId: count.id,
        referenceCode: count.code,
        sourceLineId: `CNT_LINE:${line.id}`,
        reason: "Stock count adjustment",
        note: line.note,
        postedByUserId: userId,
      });
    }

    return tx.stockCount.update({
      where: { id },
      data: {
        status: StockDocStatus.POSTED,
        postedAt: new Date(),
        postedByUserId: userId,
      },
      include: { lines: true },
    });
  });
}
