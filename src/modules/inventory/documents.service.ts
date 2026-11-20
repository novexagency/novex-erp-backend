import {
  AccountingEventType,
  InventoryDirection,
  InventoryMovementType,
  Prisma,
  StockDocStatus,
  StockReservationStatus,
  WorkflowDocumentType,
} from "@prisma/client";
import { nextDocumentNumber } from "../../lib/documentNumber.js";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { generateForSourceIfAccountingEnabled } from "../accounting/posting.engine.js";
import type { WorkflowOpts } from "../workflow/adapters/types.js";
import { startApprovalIfConfigured } from "../workflow/engine.service.js";
import { adjustReserved, applyMovement, getActiveWarehouse } from "./ledger.service.js";

async function assertProduct(tid: string, productId: string) {
  const p = await prisma.product.findFirst({ where: { id: productId, organizationId: tid } });
  if (!p) throw new AppError("Product not found", 404);
  return p;
}

// ---------- Opening stock ----------

export async function createOpeningStock(
  tenantId: TenantId,
  data: {
    notes?: string | null;
    lines: Array<{
      productId: string;
      quantity: number;
      unitCost: number;
      batchNumber?: string | null;
      expiryDate?: string | null;
      note?: string | null;
    }>;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  if (!data.lines?.length) throw new AppError("At least one line required", 400);
  for (const l of data.lines) await assertProduct(tid, l.productId);
  const warehouse = await getActiveWarehouse(tid);

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "OST", "OST");
    return tx.openingStock.create({
      data: {
        organizationId: tid,
        warehouseId: warehouse.id,
        code,
        notes: data.notes,
        createdByUserId: userId,
        lines: {
          create: data.lines.map((l) => ({
            organizationId: tid,
            productId: l.productId,
            quantity: new Prisma.Decimal(l.quantity),
            unitCost: new Prisma.Decimal(l.unitCost),
            batchNumber: l.batchNumber,
            expiryDate: l.expiryDate ? new Date(l.expiryDate) : null,
            note: l.note,
          })),
        },
      },
      include: { lines: true },
    });
  });
}

export async function postOpeningStock(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);
  return prisma.$transaction(async (tx) => {
    const doc = await tx.openingStock.findUnique({ where: { id }, include: { lines: true } });
    if (!doc) throw new AppError("Opening stock not found", 404);
    assertSameTenant(doc.organizationId, tid);
    if (doc.status === StockDocStatus.POSTED) throw new AppError("Already posted", 409);

    for (const line of doc.lines) {
      await applyMovement(tx, {
        organizationId: tid,
        warehouseId: doc.warehouseId,
        productId: line.productId,
        type: InventoryMovementType.OPENING,
        direction: InventoryDirection.IN,
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost),
        referenceType: "OPENING_STOCK",
        referenceId: doc.id,
        referenceCode: doc.code,
        sourceLineId: `OST_LINE:${line.id}`,
        reason: "Opening stock",
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
        postedByUserId: userId,
      });
    }

    const updated = await tx.openingStock.update({
      where: { id },
      data: { status: StockDocStatus.POSTED, postedAt: new Date(), postedByUserId: userId },
      include: { lines: true },
    });

    const amount = doc.lines.reduce(
      (s, l) => s + Number(l.quantity) * Number(l.unitCost),
      0
    );
    if (amount > 0) {
      await generateForSourceIfAccountingEnabled(tx, {
        organizationId: tid,
        eventType: AccountingEventType.OPENING_BALANCE,
        sourceType: "OPENING_STOCK",
        sourceId: doc.id,
        sourceCode: doc.code,
        description: `Opening stock ${doc.code}`,
        amount: Number(amount.toFixed(4)),
        userId,
      });
    }

    return updated;
  });
}

export async function listOpeningStocks(tenantId: TenantId) {
  return prisma.openingStock.findMany({
    where: { organizationId: requireTenantId(tenantId) },
    include: { lines: true },
    orderBy: { createdAt: "desc" },
  });
}

// ---------- Adjustments (manual / damaged / expired) ----------

export async function createStockAdjustment(
  tenantId: TenantId,
  data: {
    reason: string;
    reasonCode?: "MANUAL" | "DAMAGED" | "EXPIRED" | "OTHER";
    notes?: string | null;
    lines: Array<{
      productId: string;
      direction: "IN" | "OUT";
      quantity: number;
      unitCost?: number | null;
      inventoryLotId?: string | null;
      note?: string | null;
    }>;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  if (!data.lines?.length) throw new AppError("At least one adjustment line required", 400);
  const warehouse = await getActiveWarehouse(tid);

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "ADJ", "ADJ");
    return tx.stockAdjustment.create({
      data: {
        organizationId: tid,
        warehouseId: warehouse.id,
        code,
        reason: data.reason,
        reasonCode: data.reasonCode || "MANUAL",
        notes: data.notes,
        createdByUserId: userId,
        lines: {
          create: data.lines.map((l) => ({
            organizationId: tid,
            productId: l.productId,
            direction: l.direction as InventoryDirection,
            quantity: new Prisma.Decimal(l.quantity),
            unitCost: l.unitCost != null ? new Prisma.Decimal(l.unitCost) : null,
            note: l.note,
          })),
        },
      },
      include: { lines: true },
    });
  });
}

export async function postStockAdjustment(
  tenantId: TenantId,
  adjustmentId: string,
  userId?: string,
  opts?: WorkflowOpts
) {
  const tid = requireTenantId(tenantId);

  const existing = await prisma.stockAdjustment.findUnique({
    where: { id: adjustmentId },
    include: { lines: true },
  });
  if (!existing) throw new AppError("Stock adjustment not found", 404);
  assertSameTenant(existing.organizationId, tid);
  if (existing.status === "POSTED") throw new AppError("Adjustment already posted", 409);
  if (existing.status === "CANCELLED") throw new AppError("Adjustment is cancelled", 400);

  if (!opts?.fromWorkflow) {
    const approval = await startApprovalIfConfigured(tid, {
      documentType: WorkflowDocumentType.STOCK_ADJUSTMENT,
      documentId: adjustmentId,
      submittedByUserId: userId,
    });
    if (approval) {
      return { ...existing, pendingApproval: true, approvalId: approval.id };
    }
  }

  return prisma.$transaction(async (tx) => {
    const adj = await tx.stockAdjustment.findUnique({
      where: { id: adjustmentId },
      include: { lines: true },
    });
    if (!adj) throw new AppError("Stock adjustment not found", 404);
    assertSameTenant(adj.organizationId, tid);
    if (adj.status === "POSTED") throw new AppError("Adjustment already posted", 409);
    if (adj.status === "CANCELLED") throw new AppError("Adjustment is cancelled", 400);

    for (const line of adj.lines) {
      let type: InventoryMovementType =
        line.direction === InventoryDirection.IN
          ? InventoryMovementType.ADJUSTMENT_IN
          : InventoryMovementType.ADJUSTMENT_OUT;
      if (adj.reasonCode === "DAMAGED" && line.direction === InventoryDirection.OUT) {
        type = InventoryMovementType.DAMAGED;
      }
      if (adj.reasonCode === "EXPIRED" && line.direction === InventoryDirection.OUT) {
        type = InventoryMovementType.EXPIRED;
      }

      await applyMovement(tx, {
        organizationId: tid,
        warehouseId: adj.warehouseId,
        productId: line.productId,
        type,
        direction: line.direction,
        quantity: Number(line.quantity),
        unitCost: line.unitCost != null ? Number(line.unitCost) : null,
        referenceType: "STOCK_ADJUSTMENT",
        referenceId: adj.id,
        referenceCode: adj.code,
        sourceLineId: `ADJ_LINE:${line.id}`,
        reason: adj.reason,
        note: line.note,
        postedByUserId: userId,
      });
    }

    const updated = await tx.stockAdjustment.update({
      where: { id: adj.id },
      data: { status: "POSTED", postedAt: new Date(), postedByUserId: userId },
      include: { lines: true },
    });

    const amount = adj.lines.reduce(
      (s, l) => s + Number(l.quantity) * Number(l.unitCost ?? 0),
      0
    );
    if (amount > 0) {
      await generateForSourceIfAccountingEnabled(tx, {
        organizationId: tid,
        eventType: AccountingEventType.INVENTORY_MOVEMENT,
        sourceType: "STOCK_ADJUSTMENT",
        sourceId: adj.id,
        sourceCode: adj.code,
        description: `Stock adjustment ${adj.code}: ${adj.reason}`,
        amount: Number(amount.toFixed(4)),
        userId,
      });
    }

    return updated;
  });
}

export async function cancelStockAdjustmentWorkflow(
  tenantId: TenantId,
  adjustmentId: string,
  reason?: string
) {
  const tid = requireTenantId(tenantId);
  const adj = await prisma.stockAdjustment.findUnique({ where: { id: adjustmentId } });
  if (!adj) throw new AppError("Stock adjustment not found", 404);
  assertSameTenant(adj.organizationId, tid);
  return prisma.stockAdjustment.update({
    where: { id: adjustmentId },
    data: {
      status: "CANCELLED",
      notes: reason ? `Workflow rejected: ${reason}` : "Workflow rejected",
    },
    include: { lines: true },
  });
}

// ---------- Sales issue ----------

export async function createStockIssue(
  tenantId: TenantId,
  data: {
    salesOrderId?: string | null;
    customerId?: string | null;
    reservationId?: string | null;
    reason?: string | null;
    notes?: string | null;
    lines: Array<{ productId: string; quantity: number; note?: string | null }>;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  if (!data.lines?.length) throw new AppError("At least one line required", 400);
  for (const l of data.lines) await assertProduct(tid, l.productId);
  const warehouse = await getActiveWarehouse(tid);

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "ISS", "ISS");
    return tx.stockIssue.create({
      data: {
        organizationId: tid,
        warehouseId: warehouse.id,
        code,
        salesOrderId: data.salesOrderId,
        customerId: data.customerId,
        reservationId: data.reservationId,
        reason: data.reason,
        notes: data.notes,
        createdByUserId: userId,
        lines: {
          create: data.lines.map((l) => ({
            organizationId: tid,
            productId: l.productId,
            quantity: new Prisma.Decimal(l.quantity),
            note: l.note,
          })),
        },
      },
      include: { lines: true },
    });
  });
}

export async function postStockIssue(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);
  return prisma.$transaction(async (tx) => {
    const doc = await tx.stockIssue.findUnique({ where: { id }, include: { lines: true } });
    if (!doc) throw new AppError("Stock issue not found", 404);
    assertSameTenant(doc.organizationId, tid);
    if (doc.status === StockDocStatus.POSTED) throw new AppError("Already posted", 409);

    for (const line of doc.lines) {
      await applyMovement(tx, {
        organizationId: tid,
        warehouseId: doc.warehouseId,
        productId: line.productId,
        type: InventoryMovementType.SALES_ISSUE,
        direction: InventoryDirection.OUT,
        quantity: Number(line.quantity),
        referenceType: "STOCK_ISSUE",
        referenceId: doc.id,
        referenceCode: doc.code,
        sourceLineId: `ISS_LINE:${line.id}`,
        reason: doc.reason ?? "Sales issue",
        consumeReserved: Boolean(doc.reservationId),
        postedByUserId: userId,
      });
    }

    if (doc.reservationId) {
      await tx.stockReservation.update({
        where: { id: doc.reservationId },
        data: { status: StockReservationStatus.CONSUMED },
      });
    }

    return tx.stockIssue.update({
      where: { id },
      data: { status: StockDocStatus.POSTED, postedAt: new Date(), postedByUserId: userId },
      include: { lines: true },
    });
  });
}

export async function listStockIssues(tenantId: TenantId) {
  return prisma.stockIssue.findMany({
    where: { organizationId: requireTenantId(tenantId) },
    include: { lines: true },
    orderBy: { createdAt: "desc" },
  });
}

// ---------- Sales return ----------

export async function createStockReturn(
  tenantId: TenantId,
  data: {
    salesReturnId?: string | null;
    customerId?: string | null;
    stockIssueId?: string | null;
    reason?: string | null;
    notes?: string | null;
    lines: Array<{
      productId: string;
      quantity: number;
      unitCost?: number | null;
      batchNumber?: string | null;
      expiryDate?: string | null;
      note?: string | null;
    }>;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  if (!data.lines?.length) throw new AppError("At least one line required", 400);
  for (const l of data.lines) await assertProduct(tid, l.productId);
  const warehouse = await getActiveWarehouse(tid);

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "SRET", "SRET");
    return tx.stockReturn.create({
      data: {
        organizationId: tid,
        warehouseId: warehouse.id,
        code,
        salesReturnId: data.salesReturnId,
        customerId: data.customerId,
        stockIssueId: data.stockIssueId,
        reason: data.reason,
        notes: data.notes,
        createdByUserId: userId,
        lines: {
          create: data.lines.map((l) => ({
            organizationId: tid,
            productId: l.productId,
            quantity: new Prisma.Decimal(l.quantity),
            unitCost: l.unitCost != null ? new Prisma.Decimal(l.unitCost) : null,
            batchNumber: l.batchNumber,
            expiryDate: l.expiryDate ? new Date(l.expiryDate) : null,
            note: l.note,
          })),
        },
      },
      include: { lines: true },
    });
  });
}

export async function postStockReturn(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);
  return prisma.$transaction(async (tx) => {
    const doc = await tx.stockReturn.findUnique({ where: { id }, include: { lines: true } });
    if (!doc) throw new AppError("Stock return not found", 404);
    assertSameTenant(doc.organizationId, tid);
    if (doc.status === StockDocStatus.POSTED) throw new AppError("Already posted", 409);

    for (const line of doc.lines) {
      const bal = await tx.stockBalance.findUnique({
        where: {
          organizationId_warehouseId_productId_variantKey: {
            organizationId: tid,
            warehouseId: doc.warehouseId,
            productId: line.productId,
            variantKey: "",
          },
        },
      });
      const unitCost =
        line.unitCost != null
          ? Number(line.unitCost)
          : bal?.avgUnitCost != null
            ? Number(bal.avgUnitCost)
            : 0;

      await applyMovement(tx, {
        organizationId: tid,
        warehouseId: doc.warehouseId,
        productId: line.productId,
        type: InventoryMovementType.SALES_RETURN,
        direction: InventoryDirection.IN,
        quantity: Number(line.quantity),
        unitCost,
        referenceType: "STOCK_RETURN",
        referenceId: doc.id,
        referenceCode: doc.code,
        sourceLineId: `SRET_LINE:${line.id}`,
        reason: doc.reason ?? "Sales return",
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
        postedByUserId: userId,
      });
    }

    return tx.stockReturn.update({
      where: { id },
      data: { status: StockDocStatus.POSTED, postedAt: new Date(), postedByUserId: userId },
      include: { lines: true },
    });
  });
}

export async function listStockReturns(tenantId: TenantId) {
  return prisma.stockReturn.findMany({
    where: { organizationId: requireTenantId(tenantId) },
    include: { lines: true },
    orderBy: { createdAt: "desc" },
  });
}

// ---------- Reservations ----------

export async function createReservation(
  tenantId: TenantId,
  data: {
    salesOrderId?: string | null;
    customerId?: string | null;
    expiresAt?: string | null;
    notes?: string | null;
    lines: Array<{ productId: string; quantity: number; note?: string | null }>;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  if (!data.lines?.length) throw new AppError("At least one line required", 400);
  for (const l of data.lines) await assertProduct(tid, l.productId);
  const warehouse = await getActiveWarehouse(tid);

  return prisma.$transaction(async (tx) => {
    for (const l of data.lines) {
      await adjustReserved(tx, {
        organizationId: tid,
        warehouseId: warehouse.id,
        productId: l.productId,
        delta: l.quantity,
      });
    }
    const code = await nextDocumentNumber(tx, tid, "RSV", "RSV");
    return tx.stockReservation.create({
      data: {
        organizationId: tid,
        warehouseId: warehouse.id,
        code,
        salesOrderId: data.salesOrderId,
        customerId: data.customerId,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        notes: data.notes,
        createdByUserId: userId,
        lines: {
          create: data.lines.map((l) => ({
            organizationId: tid,
            productId: l.productId,
            quantity: new Prisma.Decimal(l.quantity),
            note: l.note,
          })),
        },
      },
      include: { lines: true },
    });
  });
}

export async function releaseReservation(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  return prisma.$transaction(async (tx) => {
    const resv = await tx.stockReservation.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!resv) throw new AppError("Reservation not found", 404);
    assertSameTenant(resv.organizationId, tid);
    if (resv.status === StockReservationStatus.RELEASED || resv.status === StockReservationStatus.CANCELLED) {
      throw new AppError("Reservation already released", 409);
    }

    for (const line of resv.lines) {
      const active =
        Number(line.quantity) - Number(line.quantityReleased) - Number(line.quantityConsumed);
      if (active > 0) {
        await adjustReserved(tx, {
          organizationId: tid,
          warehouseId: resv.warehouseId,
          productId: line.productId,
          delta: -active,
        });
        await tx.stockReservationLine.update({
          where: { id: line.id },
          data: {
            quantityReleased: new Prisma.Decimal(
              (Number(line.quantityReleased) + active).toFixed(4)
            ),
          },
        });
      }
    }

    return tx.stockReservation.update({
      where: { id },
      data: { status: StockReservationStatus.RELEASED },
      include: { lines: true },
    });
  });
}

export async function listReservations(tenantId: TenantId) {
  return prisma.stockReservation.findMany({
    where: { organizationId: requireTenantId(tenantId) },
    include: { lines: true },
    orderBy: { createdAt: "desc" },
  });
}
