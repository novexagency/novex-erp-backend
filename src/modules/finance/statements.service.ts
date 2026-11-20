import { FinDocStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { resolveAccount } from "./treasury.service.js";

export async function cashboxStatement(
  tenantId: TenantId,
  cashboxId: string,
  from?: string,
  to?: string
) {
  const tid = requireTenantId(tenantId);
  const box = await prisma.cashbox.findFirst({ where: { id: cashboxId, organizationId: tid } });
  if (!box) throw new AppError("Cashbox not found", 404);

  const movements = await prisma.treasuryMovement.findMany({
    where: {
      organizationId: tid,
      cashboxId,
      ...(from || to
        ? {
            entryDate: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
  });

  return {
    account: {
      type: "CASHBOX" as const,
      id: box.id,
      code: box.code,
      name: box.name,
      currency: box.currency,
      currentBalance: Number(box.currentBalance),
      openingBalance: Number(box.openingBalance),
    },
    from: from ?? null,
    to: to ?? null,
    movements: movements.map((m) => ({
      id: m.id,
      type: m.type,
      direction: m.direction,
      amount: Number(m.amount),
      previousBalance: Number(m.previousBalance),
      resultingBalance: Number(m.resultingBalance),
      referenceType: m.referenceType,
      referenceId: m.referenceId,
      referenceCode: m.referenceCode,
      note: m.note,
      entryDate: m.entryDate,
      postedAt: m.postedAt,
    })),
  };
}

export async function bankStatement(
  tenantId: TenantId,
  bankAccountId: string,
  from?: string,
  to?: string
) {
  const tid = requireTenantId(tenantId);
  const bank = await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, organizationId: tid },
  });
  if (!bank) throw new AppError("Bank account not found", 404);

  const movements = await prisma.treasuryMovement.findMany({
    where: {
      organizationId: tid,
      bankAccountId,
      ...(from || to
        ? {
            entryDate: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
  });

  return {
    account: {
      type: "BANK" as const,
      id: bank.id,
      code: bank.code,
      name: bank.name,
      bankName: bank.bankName,
      currency: bank.currency,
      currentBalance: Number(bank.currentBalance),
      openingBalance: Number(bank.openingBalance),
    },
    from: from ?? null,
    to: to ?? null,
    movements: movements.map((m) => ({
      id: m.id,
      type: m.type,
      direction: m.direction,
      amount: Number(m.amount),
      previousBalance: Number(m.previousBalance),
      resultingBalance: Number(m.resultingBalance),
      referenceType: m.referenceType,
      referenceId: m.referenceId,
      referenceCode: m.referenceCode,
      note: m.note,
      entryDate: m.entryDate,
      postedAt: m.postedAt,
    })),
  };
}

export async function treasuryDashboard(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const [cashboxes, banks, receipts, payments, expenses] = await Promise.all([
    prisma.cashbox.findMany({ where: { organizationId: tid, isActive: true } }),
    prisma.bankAccount.findMany({ where: { organizationId: tid, isActive: true } }),
    prisma.finReceipt.aggregate({
      where: { organizationId: tid, status: FinDocStatus.POSTED },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.finPayment.aggregate({
      where: { organizationId: tid, status: FinDocStatus.POSTED },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.expense.aggregate({
      where: { organizationId: tid, status: FinDocStatus.POSTED },
      _sum: { totalAmount: true },
      _count: true,
    }),
  ]);

  const cashTotal = cashboxes.reduce((s, c) => s + Number(c.currentBalance), 0);
  const bankTotal = banks.reduce((s, b) => s + Number(b.currentBalance), 0);

  return {
    cashTotal: Number(cashTotal.toFixed(4)),
    bankTotal: Number(bankTotal.toFixed(4)),
    treasuryTotal: Number((cashTotal + bankTotal).toFixed(4)),
    cashboxes: cashboxes.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      balance: Number(c.currentBalance),
      currency: c.currency,
    })),
    banks: banks.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      balance: Number(b.currentBalance),
      currency: b.currency,
    })),
    postedReceipts: {
      count: receipts._count,
      total: Number(receipts._sum.amount ?? 0),
    },
    postedPayments: {
      count: payments._count,
      total: Number(payments._sum.amount ?? 0),
    },
    postedExpenses: {
      count: expenses._count,
      total: Number(expenses._sum.totalAmount ?? 0),
    },
  };
}

export async function cashFlowSummary(tenantId: TenantId, from?: string, to?: string) {
  const tid = requireTenantId(tenantId);
  const dateFilter =
    from || to
      ? {
          entryDate: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {};

  const movements = await prisma.treasuryMovement.findMany({
    where: {
      organizationId: tid,
      type: { not: "REVERSAL" },
      ...dateFilter,
    },
    select: { type: true, direction: true, amount: true },
  });

  let inflow = 0;
  let outflow = 0;
  const byType = new Map<string, { in: number; out: number }>();

  for (const m of movements) {
    const amt = Number(m.amount);
    const bucket = byType.get(m.type) ?? { in: 0, out: 0 };
    if (m.direction === "IN") {
      inflow += amt;
      bucket.in += amt;
    } else {
      outflow += amt;
      bucket.out += amt;
    }
    byType.set(m.type, bucket);
  }

  return {
    from: from ?? null,
    to: to ?? null,
    inflow: Number(inflow.toFixed(4)),
    outflow: Number(outflow.toFixed(4)),
    net: Number((inflow - outflow).toFixed(4)),
    byType: [...byType.entries()].map(([type, v]) => ({
      type,
      in: Number(v.in.toFixed(4)),
      out: Number(v.out.toFixed(4)),
      net: Number((v.in - v.out).toFixed(4)),
    })),
  };
}

export async function accountBalances(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const [cashboxes, banks] = await Promise.all([
    prisma.cashbox.findMany({
      where: { organizationId: tid, isActive: true },
      orderBy: { code: "asc" },
    }),
    prisma.bankAccount.findMany({
      where: { organizationId: tid, isActive: true },
      orderBy: { code: "asc" },
    }),
  ]);
  return {
    cashboxes: cashboxes.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      balance: Number(c.currentBalance),
      currency: c.currency,
    })),
    banks: banks.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      balance: Number(b.currentBalance),
      currency: b.currency,
    })),
  };
}

/** Integrity check: last movement resultingBalance must match account currentBalance. */
export async function verifyTreasuryIntegrity(
  tenantId: TenantId,
  data: { cashboxId?: string | null; bankAccountId?: string | null }
) {
  const tid = requireTenantId(tenantId);
  const account = resolveAccount(data);

  if (account.accountType === "CASHBOX") {
    const box = await prisma.cashbox.findFirst({
      where: { id: account.cashboxId, organizationId: tid },
    });
    if (!box) throw new AppError("Cashbox not found", 404);
    const last = await prisma.treasuryMovement.findFirst({
      where: { organizationId: tid, cashboxId: account.cashboxId },
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    });
    const ledgerBalance = last ? Number(last.resultingBalance) : 0;
    const current = Number(box.currentBalance);
    return {
      accountType: "CASHBOX" as const,
      accountId: box.id,
      currentBalance: current,
      ledgerBalance,
      intact: Math.abs(current - ledgerBalance) < 0.01,
      difference: Number((current - ledgerBalance).toFixed(4)),
    };
  }

  const bank = await prisma.bankAccount.findFirst({
    where: { id: account.bankAccountId, organizationId: tid },
  });
  if (!bank) throw new AppError("Bank account not found", 404);
  const last = await prisma.treasuryMovement.findFirst({
    where: { organizationId: tid, bankAccountId: account.bankAccountId },
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
  });
  const ledgerBalance = last ? Number(last.resultingBalance) : 0;
  const current = Number(bank.currentBalance);
  return {
    accountType: "BANK" as const,
    accountId: bank.id,
    currentBalance: current,
    ledgerBalance,
    intact: Math.abs(current - ledgerBalance) < 0.01,
    difference: Number((current - ledgerBalance).toFixed(4)),
  };
}

export async function listTransfers(tenantId: TenantId) {
  return prisma.treasuryTransfer.findMany({
    where: { organizationId: requireTenantId(tenantId) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
