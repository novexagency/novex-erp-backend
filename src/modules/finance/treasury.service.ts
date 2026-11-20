import { Prisma, TreasuryDirection, TreasuryMovementType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/AppError.js";

export type Tx = Prisma.TransactionClient;

type AccountRef =
  | { accountType: "CASHBOX"; cashboxId: string; bankAccountId?: null }
  | { accountType: "BANK"; bankAccountId: string; cashboxId?: null };

/** Atomically post a treasury movement and update cashbox/bank balance. Idempotent via sourceLineId. */
export async function applyTreasuryMovement(
  tx: Tx,
  args: AccountRef & {
    organizationId: string;
    type: TreasuryMovementType;
    direction: TreasuryDirection;
    amount: number;
    referenceType: string;
    referenceId: string;
    referenceCode?: string | null;
    sourceLineId: string;
    note?: string | null;
    entryDate?: Date;
    postedByUserId?: string | null;
    reversesMovementId?: string | null;
    allowNegative?: boolean;
  }
) {
  if (args.amount <= 0) throw new AppError("Amount must be positive", 400);

  const existing = await tx.treasuryMovement.findUnique({
    where: { sourceLineId: args.sourceLineId },
  });
  if (existing) return { movement: existing, duplicate: true as const };

  let previous = 0;
  if (args.accountType === "CASHBOX") {
    const box = await tx.cashbox.findUnique({ where: { id: args.cashboxId } });
    if (!box || box.organizationId !== args.organizationId) {
      throw new AppError("Cashbox not found", 404);
    }
    previous = Number(box.currentBalance);
  } else {
    const bank = await tx.bankAccount.findUnique({ where: { id: args.bankAccountId } });
    if (!bank || bank.organizationId !== args.organizationId) {
      throw new AppError("Bank account not found", 404);
    }
    previous = Number(bank.currentBalance);
  }

  const delta = args.direction === TreasuryDirection.IN ? args.amount : -args.amount;
  const resulting = previous + delta;
  if (resulting < -0.0001 && !args.allowNegative) {
    throw new AppError(
      `Insufficient ${args.accountType.toLowerCase()} balance (have ${previous}, need ${args.amount})`,
      400
    );
  }

  if (args.accountType === "CASHBOX") {
    await tx.cashbox.update({
      where: { id: args.cashboxId },
      data: { currentBalance: new Prisma.Decimal(resulting.toFixed(4)) },
    });
  } else {
    await tx.bankAccount.update({
      where: { id: args.bankAccountId },
      data: { currentBalance: new Prisma.Decimal(resulting.toFixed(4)) },
    });
  }

  const movement = await tx.treasuryMovement.create({
    data: {
      organizationId: args.organizationId,
      accountType: args.accountType,
      cashboxId: args.accountType === "CASHBOX" ? args.cashboxId : null,
      bankAccountId: args.accountType === "BANK" ? args.bankAccountId : null,
      type: args.type,
      direction: args.direction,
      amount: new Prisma.Decimal(args.amount),
      previousBalance: new Prisma.Decimal(previous.toFixed(4)),
      resultingBalance: new Prisma.Decimal(resulting.toFixed(4)),
      referenceType: args.referenceType,
      referenceId: args.referenceId,
      referenceCode: args.referenceCode,
      sourceLineId: args.sourceLineId,
      note: args.note,
      entryDate: args.entryDate ?? new Date(),
      postedByUserId: args.postedByUserId,
      reversesMovementId: args.reversesMovementId,
    },
  });

  return { movement, duplicate: false as const };
}

export function resolveAccount(data: {
  cashboxId?: string | null;
  bankAccountId?: string | null;
}): AccountRef {
  if (data.cashboxId && data.bankAccountId) {
    throw new AppError("Provide either cashboxId or bankAccountId, not both", 400);
  }
  if (data.cashboxId) return { accountType: "CASHBOX", cashboxId: data.cashboxId };
  if (data.bankAccountId) return { accountType: "BANK", bankAccountId: data.bankAccountId };
  throw new AppError("cashboxId or bankAccountId required", 400);
}

export async function reverseTreasuryForDocument(
  tx: Tx,
  organizationId: string,
  referenceType: string,
  referenceId: string,
  userId?: string,
  note?: string
) {
  const originals = await tx.treasuryMovement.findMany({
    where: {
      organizationId,
      referenceType,
      referenceId,
      type: { not: TreasuryMovementType.REVERSAL },
    },
  });

  for (const m of originals) {
    const already = await tx.treasuryMovement.findFirst({
      where: { reversesMovementId: m.id },
    });
    if (already) continue;

    const account =
      m.accountType === "CASHBOX"
        ? ({ accountType: "CASHBOX" as const, cashboxId: m.cashboxId! })
        : ({ accountType: "BANK" as const, bankAccountId: m.bankAccountId! });

    await applyTreasuryMovement(tx, {
      organizationId,
      ...account,
      type: TreasuryMovementType.REVERSAL,
      direction:
        m.direction === TreasuryDirection.IN ? TreasuryDirection.OUT : TreasuryDirection.IN,
      amount: Number(m.amount),
      referenceType,
      referenceId,
      referenceCode: m.referenceCode,
      sourceLineId: `REV:${m.id}`,
      note: note ?? `Reversal of ${m.id}`,
      postedByUserId: userId,
      reversesMovementId: m.id,
      allowNegative: true,
    });
  }
}
