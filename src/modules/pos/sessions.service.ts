import { CashierSessionStatus, Prisma } from "@prisma/client";
import { nextDocumentNumber } from "../../lib/documentNumber.js";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

export async function getOpenSession(tenantId: TenantId, cashierUserId: string) {
  const tid = requireTenantId(tenantId);
  return prisma.cashierSession.findFirst({
    where: {
      organizationId: tid,
      cashierUserId,
      status: CashierSessionStatus.OPEN,
    },
    orderBy: { openedAt: "desc" },
  });
}

export async function openSession(
  tenantId: TenantId,
  data: { openingCash: number; notes?: string | null },
  cashierUserId: string
) {
  const tid = requireTenantId(tenantId);
  if (!cashierUserId) throw new AppError("Cashier user required", 400);
  const existing = await getOpenSession(tid, cashierUserId);
  if (existing) throw new AppError("Cashier already has an open session", 409);
  if (data.openingCash < 0) throw new AppError("Opening cash cannot be negative", 400);

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "POSH", "POSH");
    return tx.cashierSession.create({
      data: {
        organizationId: tid,
        code,
        cashierUserId,
        openingCash: new Prisma.Decimal(data.openingCash),
        notes: data.notes,
      },
    });
  });
}

export async function getSession(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.cashierSession.findUnique({
    where: { id },
    include: {
      cashMovements: { orderBy: { createdAt: "desc" } },
      sales: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!row) throw new AppError("Cashier session not found", 404);
  assertSameTenant(row.organizationId, tid);
  return row;
}

export async function listSessions(tenantId: TenantId, status?: string) {
  return prisma.cashierSession.findMany({
    where: {
      organizationId: requireTenantId(tenantId),
      ...(status ? { status: status as CashierSessionStatus } : {}),
    },
    orderBy: { openedAt: "desc" },
    take: 100,
  });
}

export async function recordCashMovement(
  tenantId: TenantId,
  sessionId: string,
  data: { type: "CASH_IN" | "CASH_OUT"; amount: number; reason?: string | null },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  if (data.amount <= 0) throw new AppError("Amount must be positive", 400);

  return prisma.$transaction(async (tx) => {
    const session = await tx.cashierSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new AppError("Session not found", 404);
    assertSameTenant(session.organizationId, tid);
    if (session.status !== CashierSessionStatus.OPEN) throw new AppError("Session is not open", 400);

    const movement = await tx.cashMovement.create({
      data: {
        organizationId: tid,
        sessionId,
        type: data.type,
        amount: new Prisma.Decimal(data.amount),
        reason: data.reason,
        createdByUserId: userId,
      },
    });

    await tx.cashierSession.update({
      where: { id: sessionId },
      data:
        data.type === "CASH_IN"
          ? { totalCashIn: { increment: data.amount } }
          : { totalCashOut: { increment: data.amount } },
    });

    return movement;
  });
}

function computeExpectedCash(session: {
  openingCash: Prisma.Decimal;
  totalCashSales: Prisma.Decimal;
  totalRefunds: Prisma.Decimal;
  totalCashIn: Prisma.Decimal;
  totalCashOut: Prisma.Decimal;
}) {
  return (
    Number(session.openingCash) +
    Number(session.totalCashSales) +
    Number(session.totalCashIn) -
    Number(session.totalCashOut) -
    Number(session.totalRefunds)
  );
}

export async function closeSession(
  tenantId: TenantId,
  sessionId: string,
  data: { actualCash: number; notes?: string | null; discrepancyReason?: string | null }
) {
  const tid = requireTenantId(tenantId);
  if (data.actualCash < 0) throw new AppError("Actual cash cannot be negative", 400);

  const session = await getSession(tid, sessionId);
  if (session.status !== CashierSessionStatus.OPEN) throw new AppError("Session is not open", 400);

  const expected = computeExpectedCash(session);
  const diff = Number((data.actualCash - expected).toFixed(4));
  const needsApproval = Math.abs(diff) >= 0.01;

  return prisma.cashierSession.update({
    where: { id: sessionId },
    data: {
      expectedCash: new Prisma.Decimal(expected.toFixed(4)),
      actualCash: new Prisma.Decimal(data.actualCash),
      cashDifference: new Prisma.Decimal(diff),
      notes: data.notes ?? session.notes,
      discrepancyReason: needsApproval ? data.discrepancyReason ?? "Cash difference" : null,
      status: needsApproval ? CashierSessionStatus.PENDING_APPROVAL : CashierSessionStatus.CLOSED,
      closedAt: needsApproval ? null : new Date(),
    },
  });
}

export async function approveSessionClose(
  tenantId: TenantId,
  sessionId: string,
  approverUserId: string,
  note?: string | null
) {
  const tid = requireTenantId(tenantId);
  const session = await getSession(tid, sessionId);
  if (session.status !== CashierSessionStatus.PENDING_APPROVAL) {
    throw new AppError("Session is not pending approval", 400);
  }

  return prisma.cashierSession.update({
    where: { id: sessionId },
    data: {
      status: CashierSessionStatus.CLOSED,
      closedAt: new Date(),
      approvedAt: new Date(),
      approvedByUserId: approverUserId,
      discrepancyReason: note
        ? `${session.discrepancyReason ?? ""} | ${note}`.trim()
        : session.discrepancyReason,
    },
  });
}

export { computeExpectedCash };
