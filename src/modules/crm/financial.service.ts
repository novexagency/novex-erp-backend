import { CustomerLedgerType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { getCustomer } from "./customers.service.js";

function signedAmount(direction: string, amount: Prisma.Decimal | number): number {
  const n = Number(amount);
  return direction === "CREDIT" ? -n : n;
}

export async function addLedgerEntry(
  tenantId: TenantId,
  customerId: string,
  data: {
    type: CustomerLedgerType;
    amount: number;
    direction?: "DEBIT" | "CREDIT";
    reference?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    note?: string | null;
    entryDate?: string;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new AppError("Customer not found", 404);
  assertSameTenant(customer.organizationId, tid);

  let direction = data.direction;
  if (!direction) {
    direction =
      data.type === CustomerLedgerType.PAYMENT || data.type === CustomerLedgerType.CREDIT_NOTE
        ? "CREDIT"
        : "DEBIT";
  }

  return prisma.customerLedgerEntry.create({
    data: {
      organizationId: tid,
      customerId,
      type: data.type,
      amount: new Prisma.Decimal(data.amount),
      direction,
      reference: data.reference,
      referenceType: data.referenceType,
      referenceId: data.referenceId,
      note: data.note,
      entryDate: data.entryDate ? new Date(data.entryDate) : new Date(),
      createdByUserId: userId,
    },
  });
}

export async function getFinancialSummary(tenantId: TenantId, customerId: string) {
  const tid = requireTenantId(tenantId);
  const customer = await getCustomer(tid, customerId);
  const entries = await prisma.customerLedgerEntry.findMany({
    where: { organizationId: tid, customerId },
    orderBy: { entryDate: "asc" },
  });

  let balance = 0;
  let totalSales = 0;
  let totalPaid = 0;
  let totalCredits = 0;

  for (const e of entries) {
    const signed = signedAmount(e.direction, e.amount);
    balance += signed;
    if (e.type === CustomerLedgerType.SALE || e.type === CustomerLedgerType.DEBIT_NOTE) {
      totalSales += Number(e.amount);
    }
    if (e.type === CustomerLedgerType.PAYMENT) {
      totalPaid += Number(e.amount);
    }
    if (e.type === CustomerLedgerType.CREDIT_NOTE) {
      totalCredits += Number(e.amount);
    }
  }

  const creditLimit = Number(customer.creditLimit);
  const utilization = creditLimit > 0 ? Math.max(0, balance) / creditLimit : null;

  // Outstanding invoices foundation — until sales invoices module posts SALE entries with invoice refs
  const outstandingInvoices = entries
    .filter(
      (e) =>
        e.type === CustomerLedgerType.SALE &&
        e.direction === "DEBIT" &&
        e.referenceType === "SALES_INVOICE"
    )
    .map((e) => ({
      reference: e.reference,
      referenceId: e.referenceId,
      amount: Number(e.amount),
      entryDate: e.entryDate.toISOString(),
      note: e.note,
    }));

  return {
    customerId,
    accountBalance: Number(balance.toFixed(4)),
    totalSales: Number(totalSales.toFixed(4)),
    totalPaid: Number(totalPaid.toFixed(4)),
    totalCredits: Number(totalCredits.toFixed(4)),
    outstandingAmount: Number(Math.max(0, balance).toFixed(4)),
    creditLimit,
    creditLimitUtilization: utilization === null ? null : Number(utilization.toFixed(4)),
    creditAvailable:
      creditLimit > 0 ? Number(Math.max(0, creditLimit - Math.max(0, balance)).toFixed(4)) : null,
    outstandingInvoices,
    paymentHistory: entries
      .filter((e) => e.type === CustomerLedgerType.PAYMENT)
      .map((e) => ({
        id: e.id,
        amount: Number(e.amount),
        reference: e.reference,
        note: e.note,
        entryDate: e.entryDate.toISOString(),
      }))
      .reverse(),
  };
}

export async function getCustomerStatement(
  tenantId: TenantId,
  customerId: string,
  options?: { from?: string; to?: string }
) {
  const tid = requireTenantId(tenantId);
  const customer = await getCustomer(tid, customerId);

  const from = options?.from ? new Date(options.from) : undefined;
  const to = options?.to ? new Date(options.to) : undefined;

  const all = await prisma.customerLedgerEntry.findMany({
    where: { organizationId: tid, customerId },
    orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
  });

  const lines: Array<{
    id: string;
    entryDate: string;
    type: string;
    direction: string;
    amount: number;
    signedAmount: number;
    runningBalance: number;
    reference: string | null;
    note: string | null;
  }> = [];

  let prior = 0;
  const inRange: Array<{ e: (typeof all)[number]; signed: number }> = [];
  for (const e of all) {
    const signed = signedAmount(e.direction, e.amount);
    if (from && e.entryDate < from) {
      prior += signed;
      continue;
    }
    if (to && e.entryDate > to) continue;
    inRange.push({ e, signed });
  }

  let running = prior;
  for (const { e, signed } of inRange) {
    running += signed;
    lines.push({
      id: e.id,
      entryDate: e.entryDate.toISOString(),
      type: e.type,
      direction: e.direction,
      amount: Number(e.amount),
      signedAmount: signed,
      runningBalance: Number(running.toFixed(4)),
      reference: e.reference,
      note: e.note,
    });
  }

  return {
    customer: {
      id: customer.id,
      code: customer.code,
      name: customer.name,
      nameAr: customer.nameAr,
    },
    from: from?.toISOString() ?? null,
    to: to?.toISOString() ?? null,
    openingBalance: Number(prior.toFixed(4)),
    closingBalance: Number(running.toFixed(4)),
    lines,
  };
}

export async function listLedger(
  tenantId: TenantId,
  customerId: string
) {
  const tid = requireTenantId(tenantId);
  await getCustomer(tid, customerId);
  return prisma.customerLedgerEntry.findMany({
    where: { organizationId: tid, customerId },
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
  });
}
