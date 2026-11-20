import {
  AccountingEventType,
  CustomerLedgerType,
  FinDocStatus,
  Prisma,
  SalesDocStatus,
  SalesPaymentStatus,
  SupplierLedgerType,
  TreasuryDirection,
  TreasuryMovementType,
  WorkflowDocumentType,
} from "@prisma/client";
import { nextDocumentNumber } from "../../lib/documentNumber.js";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import {
  generateForSourceIfAccountingEnabled,
  reverseJournalForSourceIfExists,
} from "../accounting/posting.engine.js";
import type { WorkflowOpts } from "../workflow/adapters/types.js";
import { startApprovalIfConfigured } from "../workflow/engine.service.js";
import { applyTreasuryMovement, resolveAccount, reverseTreasuryForDocument } from "./treasury.service.js";

export async function createFinReceipt(
  tenantId: TenantId,
  data: {
    customerId?: string | null;
    amount: number;
    cashboxId?: string | null;
    bankAccountId?: string | null;
    paymentMethod?: string | null;
    reference?: string | null;
    receiptDate?: string;
    notes?: string | null;
    isAdvance?: boolean;
    clientRequestId?: string | null;
    allocations?: Array<{ salesInvoiceId?: string | null; amount: number; note?: string | null }>;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  if (data.amount <= 0) throw new AppError("Amount must be positive", 400);
  resolveAccount(data);

  if (data.clientRequestId) {
    const dup = await prisma.finReceipt.findUnique({
      where: {
        organizationId_clientRequestId: { organizationId: tid, clientRequestId: data.clientRequestId },
      },
      include: { allocations: true },
    });
    if (dup) return dup;
  }

  const allocations = data.allocations ?? [];
  const allocated = allocations.reduce((s, a) => s + a.amount, 0);
  if (allocated - data.amount > 0.01) throw new AppError("Allocations exceed receipt amount", 400);
  const unallocated = Number((data.amount - allocated).toFixed(4));

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "FRCPT", "FRCPT");
    return tx.finReceipt.create({
      data: {
        organizationId: tid,
        code,
        customerId: data.customerId,
        amount: new Prisma.Decimal(data.amount),
        allocatedAmount: new Prisma.Decimal(allocated),
        unallocatedAmount: new Prisma.Decimal(unallocated),
        isAdvance: Boolean(data.isAdvance) || (!allocations.length && Boolean(data.customerId)),
        cashboxId: data.cashboxId,
        bankAccountId: data.bankAccountId,
        paymentMethod: data.paymentMethod,
        reference: data.reference,
        receiptDate: data.receiptDate ? new Date(data.receiptDate) : new Date(),
        notes: data.notes,
        clientRequestId: data.clientRequestId,
        createdByUserId: userId,
        allocations: allocations.length
          ? {
              create: allocations.map((a) => ({
                organizationId: tid,
                salesInvoiceId: a.salesInvoiceId,
                amount: new Prisma.Decimal(a.amount),
                note: a.note,
              })),
            }
          : undefined,
      },
      include: { allocations: true },
    });
  });
}

export async function postFinReceipt(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);

  return prisma.$transaction(async (tx) => {
    const receipt = await tx.finReceipt.findUnique({
      where: { id },
      include: { allocations: true },
    });
    if (!receipt) throw new AppError("Receipt not found", 404);
    assertSameTenant(receipt.organizationId, tid);
    if (receipt.status === FinDocStatus.POSTED) throw new AppError("Already posted", 409);
    if (receipt.status === FinDocStatus.CANCELLED) throw new AppError("Receipt cancelled", 400);

    const account = resolveAccount({
      cashboxId: receipt.cashboxId,
      bankAccountId: receipt.bankAccountId,
    });

    await applyTreasuryMovement(tx, {
      organizationId: tid,
      ...account,
      type: TreasuryMovementType.RECEIPT,
      direction: TreasuryDirection.IN,
      amount: Number(receipt.amount),
      referenceType: "FIN_RECEIPT",
      referenceId: receipt.id,
      referenceCode: receipt.code,
      sourceLineId: `FRCPT:${receipt.id}`,
      note: receipt.notes,
      entryDate: receipt.receiptDate,
      postedByUserId: userId,
    });

    if (receipt.customerId) {
      await tx.customerLedgerEntry.create({
        data: {
          organizationId: tid,
          customerId: receipt.customerId,
          type: CustomerLedgerType.PAYMENT,
          amount: receipt.amount,
          direction: "CREDIT",
          reference: receipt.code,
          referenceType: "FIN_RECEIPT",
          referenceId: receipt.id,
          createdByUserId: userId,
        },
      });
    }

    for (const a of receipt.allocations) {
      if (!a.salesInvoiceId) continue;
      const inv = await tx.salesInvoice.findUnique({ where: { id: a.salesInvoiceId } });
      if (!inv || inv.organizationId !== tid) throw new AppError("Sales invoice not found", 404);
      if (inv.status !== SalesDocStatus.POSTED) throw new AppError("Invoice must be posted", 400);
      const due = Number(inv.totalAmount) - Number(inv.amountPaid);
      if (Number(a.amount) > due + 0.01) throw new AppError(`Allocation exceeds invoice balance (${due})`, 400);
      const newPaid = Number(inv.amountPaid) + Number(a.amount);
      const paymentStatus =
        newPaid >= Number(inv.totalAmount) - 0.01
          ? SalesPaymentStatus.PAID
          : SalesPaymentStatus.PARTIAL;
      await tx.salesInvoice.update({
        where: { id: inv.id },
        data: {
          amountPaid: new Prisma.Decimal(newPaid.toFixed(4)),
          paymentStatus,
        },
      });
    }

    const updated = await tx.finReceipt.update({
      where: { id },
      data: { status: FinDocStatus.POSTED, postedAt: new Date(), postedByUserId: userId },
      include: { allocations: true, customer: true },
    });

    await generateForSourceIfAccountingEnabled(tx, {
      organizationId: tid,
      eventType: AccountingEventType.CUSTOMER_RECEIPT,
      sourceType: "FIN_RECEIPT",
      sourceId: receipt.id,
      sourceCode: receipt.code,
      entryDate: receipt.receiptDate,
      description: `Customer receipt ${receipt.code}`,
      amount: Number(receipt.amount),
      useBank: Boolean(receipt.bankAccountId),
      userId,
    });

    return updated;
  });
}

export async function cancelFinReceipt(
  tenantId: TenantId,
  id: string,
  reason: string,
  userId?: string,
  authorized?: boolean
) {
  const tid = requireTenantId(tenantId);
  if (!authorized) throw new AppError("Receipt cancellation requires authorization", 403);

  return prisma.$transaction(async (tx) => {
    const receipt = await tx.finReceipt.findUnique({
      where: { id },
      include: { allocations: true },
    });
    if (!receipt) throw new AppError("Receipt not found", 404);
    assertSameTenant(receipt.organizationId, tid);
    if (receipt.status === FinDocStatus.CANCELLED) throw new AppError("Already cancelled", 409);

    if (receipt.status === FinDocStatus.POSTED) {
      await reverseTreasuryForDocument(tx, tid, "FIN_RECEIPT", receipt.id, userId, reason);
      await reverseJournalForSourceIfExists(tx, tid, "FIN_RECEIPT", receipt.id, userId, reason);

      if (receipt.customerId) {
        await tx.customerLedgerEntry.create({
          data: {
            organizationId: tid,
            customerId: receipt.customerId,
            type: CustomerLedgerType.ADJUSTMENT,
            amount: receipt.amount,
            direction: "DEBIT",
            reference: receipt.code,
            referenceType: "FIN_RECEIPT_CANCEL",
            referenceId: receipt.id,
            note: reason,
            createdByUserId: userId,
          },
        });
      }

      for (const a of receipt.allocations) {
        if (!a.salesInvoiceId) continue;
        const inv = await tx.salesInvoice.findUnique({ where: { id: a.salesInvoiceId } });
        if (!inv) continue;
        const newPaid = Math.max(0, Number(inv.amountPaid) - Number(a.amount));
        const paymentStatus =
          newPaid <= 0.01
            ? SalesPaymentStatus.UNPAID
            : newPaid < Number(inv.totalAmount) - 0.01
              ? SalesPaymentStatus.PARTIAL
              : SalesPaymentStatus.PAID;
        await tx.salesInvoice.update({
          where: { id: inv.id },
          data: {
            amountPaid: new Prisma.Decimal(newPaid.toFixed(4)),
            paymentStatus,
          },
        });
      }
    }

    return tx.finReceipt.update({
      where: { id },
      data: {
        status: FinDocStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledByUserId: userId,
        cancelReason: reason,
        cancelAuthorized: true,
      },
      include: { allocations: true },
    });
  });
}

export async function listFinReceipts(tenantId: TenantId) {
  return prisma.finReceipt.findMany({
    where: { organizationId: requireTenantId(tenantId) },
    include: { allocations: true, customer: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function createFinPayment(
  tenantId: TenantId,
  data: {
    paymentType?: "SUPPLIER" | "EXPENSE" | "ADVANCE";
    supplierId?: string | null;
    expenseId?: string | null;
    amount: number;
    cashboxId?: string | null;
    bankAccountId?: string | null;
    paymentMethod?: string | null;
    reference?: string | null;
    paymentDate?: string;
    notes?: string | null;
    isAdvance?: boolean;
    clientRequestId?: string | null;
    allocations?: Array<{ purchaseInvoiceId?: string | null; amount: number; note?: string | null }>;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  if (data.amount <= 0) throw new AppError("Amount must be positive", 400);
  resolveAccount(data);
  const paymentType = data.paymentType || "SUPPLIER";
  if (paymentType === "SUPPLIER" && !data.supplierId) {
    throw new AppError("supplierId required for supplier payments", 400);
  }

  if (data.clientRequestId) {
    const dup = await prisma.finPayment.findUnique({
      where: {
        organizationId_clientRequestId: { organizationId: tid, clientRequestId: data.clientRequestId },
      },
      include: { allocations: true },
    });
    if (dup) return dup;
  }

  const allocations = data.allocations ?? [];
  const allocated = allocations.reduce((s, a) => s + a.amount, 0);
  if (allocated - data.amount > 0.01) throw new AppError("Allocations exceed payment amount", 400);
  const unallocated = Number((data.amount - allocated).toFixed(4));

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "FPAY", "FPAY");
    return tx.finPayment.create({
      data: {
        organizationId: tid,
        code,
        paymentType,
        supplierId: data.supplierId,
        expenseId: data.expenseId,
        amount: new Prisma.Decimal(data.amount),
        allocatedAmount: new Prisma.Decimal(allocated),
        unallocatedAmount: new Prisma.Decimal(unallocated),
        isAdvance: Boolean(data.isAdvance) || paymentType === "ADVANCE",
        cashboxId: data.cashboxId,
        bankAccountId: data.bankAccountId,
        paymentMethod: data.paymentMethod,
        reference: data.reference,
        paymentDate: data.paymentDate ? new Date(data.paymentDate) : new Date(),
        notes: data.notes,
        clientRequestId: data.clientRequestId,
        createdByUserId: userId,
        allocations: allocations.length
          ? {
              create: allocations.map((a) => ({
                organizationId: tid,
                purchaseInvoiceId: a.purchaseInvoiceId,
                amount: new Prisma.Decimal(a.amount),
                note: a.note,
              })),
            }
          : undefined,
      },
      include: { allocations: true },
    });
  });
}

export async function postFinPayment(
  tenantId: TenantId,
  id: string,
  userId?: string,
  opts?: WorkflowOpts
) {
  const tid = requireTenantId(tenantId);

  const existing = await prisma.finPayment.findUnique({
    where: { id },
    include: { allocations: true },
  });
  if (!existing) throw new AppError("Payment not found", 404);
  assertSameTenant(existing.organizationId, tid);
  if (existing.status === FinDocStatus.POSTED) throw new AppError("Already posted", 409);
  if (existing.status === FinDocStatus.CANCELLED) throw new AppError("Payment cancelled", 400);

  if (!opts?.fromWorkflow) {
    const approval = await startApprovalIfConfigured(tid, {
      documentType: WorkflowDocumentType.PAYMENT,
      documentId: id,
      amount: Number(existing.amount),
      submittedByUserId: userId,
    });
    if (approval) {
      return { ...existing, pendingApproval: true, approvalId: approval.id };
    }
  }

  return prisma.$transaction(async (tx) => {
    const payment = await tx.finPayment.findUnique({
      where: { id },
      include: { allocations: true },
    });
    if (!payment) throw new AppError("Payment not found", 404);
    assertSameTenant(payment.organizationId, tid);
    if (payment.status === FinDocStatus.POSTED) throw new AppError("Already posted", 409);
    if (payment.status === FinDocStatus.CANCELLED) throw new AppError("Payment cancelled", 400);

    const account = resolveAccount({
      cashboxId: payment.cashboxId,
      bankAccountId: payment.bankAccountId,
    });

    await applyTreasuryMovement(tx, {
      organizationId: tid,
      ...account,
      type: TreasuryMovementType.PAYMENT,
      direction: TreasuryDirection.OUT,
      amount: Number(payment.amount),
      referenceType: "FIN_PAYMENT",
      referenceId: payment.id,
      referenceCode: payment.code,
      sourceLineId: `FPAY:${payment.id}`,
      note: payment.notes,
      entryDate: payment.paymentDate,
      postedByUserId: userId,
    });

    if (payment.supplierId) {
      await tx.supplierLedgerEntry.create({
        data: {
          organizationId: tid,
          supplierId: payment.supplierId,
          type: SupplierLedgerType.PAYMENT,
          amount: payment.amount,
          direction: "DEBIT",
          reference: payment.code,
          referenceType: "FIN_PAYMENT",
          referenceId: payment.id,
          createdByUserId: userId,
        },
      });
    }

    for (const a of payment.allocations) {
      if (!a.purchaseInvoiceId) continue;
      const inv = await tx.purchaseInvoice.findUnique({ where: { id: a.purchaseInvoiceId } });
      if (!inv || inv.organizationId !== tid) throw new AppError("Purchase invoice not found", 404);
      const due = Number(inv.totalAmount) - Number(inv.amountPaid);
      if (Number(a.amount) > due + 0.01) throw new AppError(`Allocation exceeds invoice balance (${due})`, 400);
      const newPaid = Number(inv.amountPaid) + Number(a.amount);
      await tx.purchaseInvoice.update({
        where: { id: inv.id },
        data: {
          amountPaid: new Prisma.Decimal(newPaid.toFixed(4)),
          paymentStatus:
            newPaid >= Number(inv.totalAmount) - 0.01 ? "PAID" : "PARTIAL",
        },
      });
    }

    const updated = await tx.finPayment.update({
      where: { id },
      data: { status: FinDocStatus.POSTED, postedAt: new Date(), postedByUserId: userId },
      include: { allocations: true, supplier: true },
    });

    await generateForSourceIfAccountingEnabled(tx, {
      organizationId: tid,
      eventType: AccountingEventType.SUPPLIER_PAYMENT,
      sourceType: "FIN_PAYMENT",
      sourceId: payment.id,
      sourceCode: payment.code,
      entryDate: payment.paymentDate,
      description: `Supplier payment ${payment.code}`,
      amount: Number(payment.amount),
      useBank: Boolean(payment.bankAccountId),
      userId,
    });

    return updated;
  });
}

export async function cancelFinPayment(
  tenantId: TenantId,
  id: string,
  reason: string,
  userId?: string,
  authorized?: boolean
) {
  const tid = requireTenantId(tenantId);
  if (!authorized) throw new AppError("Payment cancellation requires authorization", 403);

  return prisma.$transaction(async (tx) => {
    const payment = await tx.finPayment.findUnique({
      where: { id },
      include: { allocations: true },
    });
    if (!payment) throw new AppError("Payment not found", 404);
    assertSameTenant(payment.organizationId, tid);
    if (payment.status === FinDocStatus.CANCELLED) throw new AppError("Already cancelled", 409);

    if (payment.status === FinDocStatus.POSTED) {
      await reverseTreasuryForDocument(tx, tid, "FIN_PAYMENT", payment.id, userId, reason);
      await reverseJournalForSourceIfExists(tx, tid, "FIN_PAYMENT", payment.id, userId, reason);
      if (payment.supplierId) {
        await tx.supplierLedgerEntry.create({
          data: {
            organizationId: tid,
            supplierId: payment.supplierId,
            type: SupplierLedgerType.ADJUSTMENT,
            amount: payment.amount,
            direction: "CREDIT",
            reference: payment.code,
            referenceType: "FIN_PAYMENT_CANCEL",
            referenceId: payment.id,
            note: reason,
            createdByUserId: userId,
          },
        });
      }
    }

    return tx.finPayment.update({
      where: { id },
      data: {
        status: FinDocStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledByUserId: userId,
        cancelReason: reason,
        cancelAuthorized: true,
      },
      include: { allocations: true },
    });
  });
}

export async function listFinPayments(tenantId: TenantId) {
  return prisma.finPayment.findMany({
    where: { organizationId: requireTenantId(tenantId) },
    include: { allocations: true, supplier: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function cancelFinPaymentWorkflow(
  tenantId: TenantId,
  id: string,
  reason?: string
) {
  const tid = requireTenantId(tenantId);
  const payment = await prisma.finPayment.findUnique({ where: { id } });
  if (!payment) throw new AppError("Payment not found", 404);
  assertSameTenant(payment.organizationId, tid);
  return prisma.finPayment.update({
    where: { id },
    data: {
      status: FinDocStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelReason: reason ?? "Workflow rejected",
      cancelAuthorized: true,
    },
    include: { allocations: true },
  });
}
