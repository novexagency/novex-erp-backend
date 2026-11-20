import { FinDocStatus, Prisma, TreasuryDirection, TreasuryMovementType } from "@prisma/client";
import { nextDocumentNumber } from "../../lib/documentNumber.js";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { applyTreasuryMovement, resolveAccount } from "./treasury.service.js";

export async function createCashbox(
  tenantId: TenantId,
  data: {
    code: string;
    name: string;
    nameAr?: string | null;
    currency?: string;
    openingBalance?: number;
    notes?: string | null;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const opening = Number(data.openingBalance ?? 0);

  return prisma.$transaction(async (tx) => {
    const dup = await tx.cashbox.findUnique({
      where: { organizationId_code: { organizationId: tid, code: data.code } },
    });
    if (dup) throw new AppError("Duplicate cashbox code", 409);

    const box = await tx.cashbox.create({
      data: {
        organizationId: tid,
        code: data.code,
        name: data.name,
        nameAr: data.nameAr,
        currency: data.currency || "EGP",
        openingBalance: new Prisma.Decimal(opening),
        currentBalance: new Prisma.Decimal(0),
        notes: data.notes,
      },
    });

    if (opening !== 0) {
      await applyTreasuryMovement(tx, {
        organizationId: tid,
        accountType: "CASHBOX",
        cashboxId: box.id,
        type: TreasuryMovementType.OPENING,
        direction: opening >= 0 ? TreasuryDirection.IN : TreasuryDirection.OUT,
        amount: Math.abs(opening),
        referenceType: "CASHBOX",
        referenceId: box.id,
        referenceCode: box.code,
        sourceLineId: `CASHBOX_OPEN:${box.id}`,
        note: "Opening balance",
        postedByUserId: userId,
      });
    }

    return tx.cashbox.findUniqueOrThrow({ where: { id: box.id } });
  });
}

export async function listCashboxes(tenantId: TenantId) {
  return prisma.cashbox.findMany({
    where: { organizationId: requireTenantId(tenantId), isActive: true },
    orderBy: { code: "asc" },
  });
}

export async function createBankAccount(
  tenantId: TenantId,
  data: {
    code: string;
    name: string;
    nameAr?: string | null;
    bankName?: string | null;
    accountNumber?: string | null;
    iban?: string | null;
    currency?: string;
    openingBalance?: number;
    notes?: string | null;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const opening = Number(data.openingBalance ?? 0);

  return prisma.$transaction(async (tx) => {
    const dup = await tx.bankAccount.findUnique({
      where: { organizationId_code: { organizationId: tid, code: data.code } },
    });
    if (dup) throw new AppError("Duplicate bank account code", 409);

    const bank = await tx.bankAccount.create({
      data: {
        organizationId: tid,
        code: data.code,
        name: data.name,
        nameAr: data.nameAr,
        bankName: data.bankName,
        accountNumber: data.accountNumber,
        iban: data.iban,
        currency: data.currency || "EGP",
        openingBalance: new Prisma.Decimal(opening),
        currentBalance: new Prisma.Decimal(0),
        notes: data.notes,
      },
    });

    if (opening !== 0) {
      await applyTreasuryMovement(tx, {
        organizationId: tid,
        accountType: "BANK",
        bankAccountId: bank.id,
        type: TreasuryMovementType.OPENING,
        direction: opening >= 0 ? TreasuryDirection.IN : TreasuryDirection.OUT,
        amount: Math.abs(opening),
        referenceType: "BANK_ACCOUNT",
        referenceId: bank.id,
        referenceCode: bank.code,
        sourceLineId: `BANK_OPEN:${bank.id}`,
        note: "Opening balance",
        postedByUserId: userId,
      });
    }

    return tx.bankAccount.findUniqueOrThrow({ where: { id: bank.id } });
  });
}

export async function listBankAccounts(tenantId: TenantId) {
  return prisma.bankAccount.findMany({
    where: { organizationId: requireTenantId(tenantId), isActive: true },
    orderBy: { code: "asc" },
  });
}

export async function postManualMovement(
  tenantId: TenantId,
  data: {
    cashboxId?: string | null;
    bankAccountId?: string | null;
    direction: "IN" | "OUT";
    amount: number;
    note?: string | null;
    entryDate?: string;
    clientRequestId?: string | null;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const account = resolveAccount(data);
  const type =
    account.accountType === "BANK"
      ? data.direction === "IN"
        ? TreasuryMovementType.DEPOSIT
        : TreasuryMovementType.WITHDRAWAL
      : data.direction === "IN"
        ? TreasuryMovementType.RECEIPT
        : TreasuryMovementType.PAYMENT;

  const sourceLineId = data.clientRequestId
    ? `MANUAL:${tid}:${data.clientRequestId}`
    : `MANUAL:${tid}:${Date.now()}:${Math.random()}`;

  return prisma.$transaction(async (tx) => {
    const result = await applyTreasuryMovement(tx, {
      organizationId: tid,
      ...account,
      type,
      direction: data.direction as TreasuryDirection,
      amount: data.amount,
      referenceType: "MANUAL",
      referenceId: sourceLineId,
      sourceLineId,
      note: data.note,
      entryDate: data.entryDate ? new Date(data.entryDate) : new Date(),
      postedByUserId: userId,
    });
    return result.movement;
  });
}

export async function createTransfer(
  tenantId: TenantId,
  data: {
    amount: number;
    fromCashboxId?: string | null;
    toCashboxId?: string | null;
    fromBankAccountId?: string | null;
    toBankAccountId?: string | null;
    note?: string | null;
    clientRequestId?: string | null;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  if (data.amount <= 0) throw new AppError("Amount must be positive", 400);

  const from = resolveAccount({
    cashboxId: data.fromCashboxId,
    bankAccountId: data.fromBankAccountId,
  });
  const to = resolveAccount({
    cashboxId: data.toCashboxId,
    bankAccountId: data.toBankAccountId,
  });
  if (
    from.accountType === to.accountType &&
    ((from.accountType === "CASHBOX" && from.cashboxId === (to as { cashboxId: string }).cashboxId) ||
      (from.accountType === "BANK" &&
        from.bankAccountId === (to as { bankAccountId: string }).bankAccountId))
  ) {
    throw new AppError("Cannot transfer to the same account", 400);
  }

  if (data.clientRequestId) {
    const dup = await prisma.treasuryTransfer.findUnique({
      where: {
        organizationId_clientRequestId: {
          organizationId: tid,
          clientRequestId: data.clientRequestId,
        },
      },
    });
    if (dup) return dup;
  }

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "TTRF", "TTRF");
    const transfer = await tx.treasuryTransfer.create({
      data: {
        organizationId: tid,
        code,
        amount: new Prisma.Decimal(data.amount),
        fromCashboxId: data.fromCashboxId,
        toCashboxId: data.toCashboxId,
        fromBankAccountId: data.fromBankAccountId,
        toBankAccountId: data.toBankAccountId,
        note: data.note,
        clientRequestId: data.clientRequestId,
        createdByUserId: userId,
        status: FinDocStatus.DRAFT,
      },
    });
    return transfer;
  });
}

export async function postTransfer(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);

  return prisma.$transaction(async (tx) => {
    const transfer = await tx.treasuryTransfer.findUnique({ where: { id } });
    if (!transfer) throw new AppError("Transfer not found", 404);
    assertSameTenant(transfer.organizationId, tid);
    if (transfer.status === FinDocStatus.POSTED) throw new AppError("Already posted", 409);
    if (transfer.status === FinDocStatus.CANCELLED) throw new AppError("Transfer cancelled", 400);

    const from = resolveAccount({
      cashboxId: transfer.fromCashboxId,
      bankAccountId: transfer.fromBankAccountId,
    });
    const to = resolveAccount({
      cashboxId: transfer.toCashboxId,
      bankAccountId: transfer.toBankAccountId,
    });

    await applyTreasuryMovement(tx, {
      organizationId: tid,
      ...from,
      type: TreasuryMovementType.TRANSFER_OUT,
      direction: TreasuryDirection.OUT,
      amount: Number(transfer.amount),
      referenceType: "TREASURY_TRANSFER",
      referenceId: transfer.id,
      referenceCode: transfer.code,
      sourceLineId: `TRF_OUT:${transfer.id}`,
      note: transfer.note,
      postedByUserId: userId,
    });

    await applyTreasuryMovement(tx, {
      organizationId: tid,
      ...to,
      type: TreasuryMovementType.TRANSFER_IN,
      direction: TreasuryDirection.IN,
      amount: Number(transfer.amount),
      referenceType: "TREASURY_TRANSFER",
      referenceId: transfer.id,
      referenceCode: transfer.code,
      sourceLineId: `TRF_IN:${transfer.id}`,
      note: transfer.note,
      postedByUserId: userId,
    });

    return tx.treasuryTransfer.update({
      where: { id },
      data: {
        status: FinDocStatus.POSTED,
        postedAt: new Date(),
        postedByUserId: userId,
      },
    });
  });
}

export async function cancelTransfer(
  tenantId: TenantId,
  id: string,
  reason: string,
  userId?: string,
  authorized?: boolean
) {
  const tid = requireTenantId(tenantId);
  if (!authorized) throw new AppError("Cancellation requires authorization", 403);

  return prisma.$transaction(async (tx) => {
    const transfer = await tx.treasuryTransfer.findUnique({ where: { id } });
    if (!transfer) throw new AppError("Transfer not found", 404);
    assertSameTenant(transfer.organizationId, tid);
    if (transfer.status === FinDocStatus.CANCELLED) throw new AppError("Already cancelled", 409);

    if (transfer.status === FinDocStatus.POSTED) {
      const { reverseTreasuryForDocument } = await import("./treasury.service.js");
      await reverseTreasuryForDocument(
        tx,
        tid,
        "TREASURY_TRANSFER",
        transfer.id,
        userId,
        reason
      );
    }

    return tx.treasuryTransfer.update({
      where: { id },
      data: {
        status: FinDocStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledByUserId: userId,
        cancelReason: reason,
      },
    });
  });
}

export async function reconcileAccount(
  tenantId: TenantId,
  data: { cashboxId?: string | null; bankAccountId?: string | null; actualBalance: number }
) {
  const tid = requireTenantId(tenantId);
  const account = resolveAccount(data);
  const system =
    account.accountType === "CASHBOX"
      ? await prisma.cashbox.findFirst({
          where: { id: account.cashboxId, organizationId: tid },
        })
      : await prisma.bankAccount.findFirst({
          where: { id: account.bankAccountId, organizationId: tid },
        });
  if (!system) throw new AppError("Account not found", 404);

  const systemBalance = Number(system.currentBalance);
  const difference = Number((data.actualBalance - systemBalance).toFixed(4));
  return {
    accountType: account.accountType,
    accountId: account.accountType === "CASHBOX" ? account.cashboxId : account.bankAccountId,
    systemBalance,
    actualBalance: data.actualBalance,
    difference,
    reconciled: Math.abs(difference) < 0.01,
  };
}
