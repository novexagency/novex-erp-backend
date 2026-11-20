import {
  InventoryDirection,
  InventoryMovementType,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

export type Tx = Prisma.TransactionClient;

export async function getActiveWarehouse(tenantId: TenantId, tx: Tx | typeof prisma = prisma) {
  const tid = requireTenantId(tenantId);
  const warehouse = await tx.warehouse.findFirst({
    where: { organizationId: tid, isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  if (!warehouse) throw new AppError("No active warehouse configured for this tenant", 400);
  return warehouse;
}

async function allowNegative(tx: Tx, organizationId: string): Promise<boolean> {
  const cfg = await tx.tenantSystemConfig.findUnique({ where: { organizationId } });
  return Boolean(cfg?.allowNegativeStock);
}

/**
 * Atomically apply a stock quantity + WAC valuation movement.
 * Idempotent via sourceLineId. Never edit/delete posted movements.
 * Creates InventoryLot on IN when batch/expiry provided (FIFO-ready layers).
 */
export async function applyMovement(
  tx: Tx,
  args: {
    organizationId: string;
    warehouseId: string;
    productId: string;
    productVariantId?: string | null;
    type: InventoryMovementType;
    direction: InventoryDirection;
    quantity: number;
    unitCost?: number | null;
    referenceType: string;
    referenceId: string;
    referenceCode?: string | null;
    sourceLineId: string;
    reason?: string | null;
    note?: string | null;
    postedByUserId?: string | null;
    batchNumber?: string | null;
    expiryDate?: string | Date | null;
    inventoryLotId?: string | null;
    /** When true on OUT, also reduce reserved qty (sales issue from reservation) */
    consumeReserved?: boolean;
  }
) {
  if (args.quantity <= 0) throw new AppError("Movement quantity must be positive", 400);

  const existing = await tx.inventoryMovement.findUnique({
    where: { sourceLineId: args.sourceLineId },
  });
  if (existing) {
    return { movement: existing, duplicate: true as const };
  }

  const variantKey = args.productVariantId ?? "";
  let balance = await tx.stockBalance.findUnique({
    where: {
      organizationId_warehouseId_productId_variantKey: {
        organizationId: args.organizationId,
        warehouseId: args.warehouseId,
        productId: args.productId,
        variantKey,
      },
    },
  });

  if (!balance) {
    balance = await tx.stockBalance.create({
      data: {
        organizationId: args.organizationId,
        warehouseId: args.warehouseId,
        productId: args.productId,
        productVariantId: args.productVariantId ?? null,
        variantKey,
        quantityOnHand: 0,
        quantityReserved: 0,
        totalValue: 0,
      },
    });
  }

  const previous = Number(balance.quantityOnHand);
  const previousAvg = balance.avgUnitCost != null ? Number(balance.avgUnitCost) : null;
  const delta = args.direction === InventoryDirection.IN ? args.quantity : -args.quantity;
  const resulting = previous + delta;

  if (resulting < -0.0001) {
    const allowed = await allowNegative(tx, args.organizationId);
    if (!allowed) {
      throw new AppError(
        `Insufficient stock for product ${args.productId} (have ${previous}, need ${args.quantity})`,
        400
      );
    }
  }

  let avgUnitCost = balance.avgUnitCost;
  let appliedUnitCost = args.unitCost ?? null;
  let inventoryLotId = args.inventoryLotId ?? null;

  if (args.direction === InventoryDirection.IN) {
    const incomingCost = args.unitCost ?? previousAvg ?? 0;
    appliedUnitCost = incomingCost;
    const prevQty = Math.max(0, previous);
    const prevCost = previousAvg ?? 0;
    const newQty = prevQty + args.quantity;
    avgUnitCost =
      newQty > 0
        ? new Prisma.Decimal(
            ((prevQty * prevCost + args.quantity * incomingCost) / newQty).toFixed(4)
          )
        : new Prisma.Decimal(incomingCost);

    // FIFO-ready lot layer (batch/expiry or always for inbound trail)
    if (args.batchNumber || args.expiryDate || args.type === InventoryMovementType.OPENING || args.type === InventoryMovementType.GRN_RECEIPT) {
      const lot = await tx.inventoryLot.create({
        data: {
          organizationId: args.organizationId,
          warehouseId: args.warehouseId,
          productId: args.productId,
          batchNumber: args.batchNumber ?? null,
          expiryDate: args.expiryDate ? new Date(args.expiryDate) : null,
          unitCost: new Prisma.Decimal(incomingCost),
          quantityReceived: new Prisma.Decimal(args.quantity),
          quantityRemaining: new Prisma.Decimal(args.quantity),
          sourceReferenceType: args.referenceType,
          sourceReferenceId: args.referenceId,
          sourceLineId: `LOT:${args.sourceLineId}`,
        },
      });
      inventoryLotId = lot.id;
    }
  } else {
    // OUT — value at current WAC (not FIFO)
    appliedUnitCost = previousAvg ?? args.unitCost ?? 0;
    if (args.inventoryLotId) {
      const lot = await tx.inventoryLot.findUnique({ where: { id: args.inventoryLotId } });
      if (!lot || lot.organizationId !== args.organizationId) {
        throw new AppError("Inventory lot not found", 404);
      }
      const rem = Number(lot.quantityRemaining);
      if (args.quantity > rem + 0.0001) {
        throw new AppError(`Lot remaining qty is ${rem}`, 400);
      }
      await tx.inventoryLot.update({
        where: { id: lot.id },
        data: {
          quantityRemaining: new Prisma.Decimal((rem - args.quantity).toFixed(4)),
        },
      });
      inventoryLotId = lot.id;
    }
    // Keep avgUnitCost unchanged on OUT (WAC)
  }

  let reserved = Number(balance.quantityReserved);
  if (args.consumeReserved && args.direction === InventoryDirection.OUT) {
    reserved = Math.max(0, reserved - args.quantity);
  }

  const onHand = Number(resulting.toFixed(4));
  const avg = avgUnitCost != null ? Number(avgUnitCost) : 0;
  const totalValue = new Prisma.Decimal((Math.max(0, onHand) * avg).toFixed(4));

  await tx.stockBalance.update({
    where: { id: balance.id },
    data: {
      quantityOnHand: new Prisma.Decimal(onHand.toFixed(4)),
      quantityReserved: new Prisma.Decimal(reserved.toFixed(4)),
      avgUnitCost,
      totalValue,
      lastMovementAt: new Date(),
    },
  });

  const movement = await tx.inventoryMovement.create({
    data: {
      organizationId: args.organizationId,
      warehouseId: args.warehouseId,
      productId: args.productId,
      productVariantId: args.productVariantId ?? null,
      inventoryLotId,
      type: args.type,
      direction: args.direction,
      quantity: new Prisma.Decimal(args.quantity),
      previousBalance: new Prisma.Decimal(previous.toFixed(4)),
      resultingBalance: new Prisma.Decimal(onHand.toFixed(4)),
      unitCost: appliedUnitCost != null ? new Prisma.Decimal(appliedUnitCost) : null,
      previousAvgCost: previousAvg != null ? new Prisma.Decimal(previousAvg) : null,
      resultingAvgCost: avgUnitCost,
      totalCost:
        appliedUnitCost != null
          ? new Prisma.Decimal((args.quantity * appliedUnitCost).toFixed(4))
          : null,
      referenceType: args.referenceType,
      referenceId: args.referenceId,
      referenceCode: args.referenceCode,
      sourceLineId: args.sourceLineId,
      reason: args.reason,
      note: args.note,
      postedByUserId: args.postedByUserId,
    },
  });

  return { movement, duplicate: false as const };
}

export async function adjustReserved(
  tx: Tx,
  args: {
    organizationId: string;
    warehouseId: string;
    productId: string;
    delta: number;
  }
) {
  const variantKey = "";
  let balance = await tx.stockBalance.findUnique({
    where: {
      organizationId_warehouseId_productId_variantKey: {
        organizationId: args.organizationId,
        warehouseId: args.warehouseId,
        productId: args.productId,
        variantKey,
      },
    },
  });
  if (!balance) {
    balance = await tx.stockBalance.create({
      data: {
        organizationId: args.organizationId,
        warehouseId: args.warehouseId,
        productId: args.productId,
        variantKey,
        quantityOnHand: 0,
        quantityReserved: 0,
        totalValue: 0,
      },
    });
  }
  const onHand = Number(balance.quantityOnHand);
  const next = Number(balance.quantityReserved) + args.delta;
  if (next < -0.0001) throw new AppError("Reserved quantity cannot go negative", 400);
  if (args.delta > 0 && next > onHand + 0.0001) {
    const allowed = await allowNegative(tx, args.organizationId);
    if (!allowed) {
      throw new AppError(
        `Cannot reserve ${args.delta}: available is ${onHand - Number(balance.quantityReserved)}`,
        400
      );
    }
  }
  return tx.stockBalance.update({
    where: { id: balance.id },
    data: { quantityReserved: new Prisma.Decimal(next.toFixed(4)) },
  });
}
