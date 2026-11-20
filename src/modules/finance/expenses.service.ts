import {
  AccountingEventType,
  FinDocStatus,
  Prisma,
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
import {
  assertDirectApproveAllowed,
  isWorkflowActive,
  startApprovalIfConfigured,
} from "../workflow/engine.service.js";
import { applyTreasuryMovement, resolveAccount, reverseTreasuryForDocument } from "./treasury.service.js";

export async function createCostCenter(
  tenantId: TenantId,
  data: { code: string; name: string; nameAr?: string | null }
) {
  const tid = requireTenantId(tenantId);
  return prisma.costCenter.create({
    data: { organizationId: tid, code: data.code, name: data.name, nameAr: data.nameAr },
  });
}

export async function listCostCenters(tenantId: TenantId) {
  return prisma.costCenter.findMany({
    where: { organizationId: requireTenantId(tenantId), isActive: true },
    orderBy: { code: "asc" },
  });
}

export async function createExpense(
  tenantId: TenantId,
  data: {
    categoryId: string;
    costCenterId?: string | null;
    title: string;
    description?: string | null;
    amount: number;
    taxAmount?: number;
    expenseDate?: string;
    cashboxId?: string | null;
    bankAccountId?: string | null;
    vendorName?: string | null;
    notes?: string | null;
    clientRequestId?: string | null;
    requiresApproval?: boolean;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  if (data.amount <= 0) throw new AppError("Amount must be positive", 400);
  const tax = Number(data.taxAmount ?? 0);
  const total = Number((data.amount + tax).toFixed(4));

  if (data.clientRequestId) {
    const dup = await prisma.expense.findUnique({
      where: {
        organizationId_clientRequestId: { organizationId: tid, clientRequestId: data.clientRequestId },
      },
    });
    if (dup) return dup;
  }

  const workflowOn = await isWorkflowActive(tid, WorkflowDocumentType.EXPENSE);
  const needsApproval = Boolean(data.requiresApproval) || workflowOn;

  const created = await prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "EXP", "EXP");
    return tx.expense.create({
      data: {
        organizationId: tid,
        code,
        categoryId: data.categoryId,
        costCenterId: data.costCenterId,
        title: data.title,
        description: data.description,
        amount: new Prisma.Decimal(data.amount),
        taxAmount: new Prisma.Decimal(tax),
        totalAmount: new Prisma.Decimal(total),
        expenseDate: data.expenseDate ? new Date(data.expenseDate) : new Date(),
        cashboxId: data.cashboxId,
        bankAccountId: data.bankAccountId,
        vendorName: data.vendorName,
        notes: data.notes,
        clientRequestId: data.clientRequestId,
        createdByUserId: userId,
        status: needsApproval ? FinDocStatus.PENDING_APPROVAL : FinDocStatus.DRAFT,
      },
      include: { category: true, costCenter: true },
    });
  });

  if (needsApproval) {
    const approval = await startApprovalIfConfigured(tid, {
      documentType: WorkflowDocumentType.EXPENSE,
      documentId: created.id,
      amount: total,
      submittedByUserId: userId,
    });
    if (approval) {
      return { ...created, pendingApproval: true, approvalId: approval.id };
    }
  }
  return created;
}

export async function approveExpense(
  tenantId: TenantId,
  id: string,
  userId?: string,
  opts?: WorkflowOpts
) {
  const tid = requireTenantId(tenantId);
  await assertDirectApproveAllowed(tid, WorkflowDocumentType.EXPENSE, id, opts);
  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) throw new AppError("Expense not found", 404);
  assertSameTenant(expense.organizationId, tid);
  if (expense.status !== FinDocStatus.PENDING_APPROVAL && expense.status !== FinDocStatus.DRAFT) {
    throw new AppError("Expense cannot be approved in current status", 400);
  }
  return prisma.expense.update({
    where: { id },
    data: {
      status: FinDocStatus.APPROVED,
      approvedAt: new Date(),
      approvedByUserId: userId,
    },
  });
}

export async function rejectExpense(
  tenantId: TenantId,
  id: string,
  reason?: string,
  userId?: string,
  opts?: WorkflowOpts
) {
  const tid = requireTenantId(tenantId);
  await assertDirectApproveAllowed(tid, WorkflowDocumentType.EXPENSE, id, opts);
  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) throw new AppError("Expense not found", 404);
  assertSameTenant(expense.organizationId, tid);
  return prisma.expense.update({
    where: { id },
    data: {
      status: FinDocStatus.CANCELLED,
      notes: reason ? `Rejected: ${reason}` : "Rejected",
      approvedByUserId: userId,
      approvedAt: new Date(),
    },
  });
}

export async function postExpense(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);

  return prisma.$transaction(async (tx) => {
    const expense = await tx.expense.findUnique({ where: { id } });
    if (!expense) throw new AppError("Expense not found", 404);
    assertSameTenant(expense.organizationId, tid);
    if (expense.status === FinDocStatus.POSTED) throw new AppError("Already posted", 409);
    if (expense.status === FinDocStatus.CANCELLED) throw new AppError("Expense cancelled", 400);
    if (expense.status === FinDocStatus.PENDING_APPROVAL) {
      throw new AppError("Expense requires approval before posting", 400);
    }

    const account = resolveAccount({
      cashboxId: expense.cashboxId,
      bankAccountId: expense.bankAccountId,
    });

    await applyTreasuryMovement(tx, {
      organizationId: tid,
      ...account,
      type: TreasuryMovementType.EXPENSE,
      direction: TreasuryDirection.OUT,
      amount: Number(expense.totalAmount),
      referenceType: "EXPENSE",
      referenceId: expense.id,
      referenceCode: expense.code,
      sourceLineId: `EXP:${expense.id}`,
      note: expense.title,
      entryDate: expense.expenseDate,
      postedByUserId: userId,
    });

    const updated = await tx.expense.update({
      where: { id },
      data: { status: FinDocStatus.POSTED, postedAt: new Date(), postedByUserId: userId },
      include: { category: true, costCenter: true, attachments: true },
    });

    await generateForSourceIfAccountingEnabled(tx, {
      organizationId: tid,
      eventType: AccountingEventType.EXPENSE,
      sourceType: "EXPENSE",
      sourceId: expense.id,
      sourceCode: expense.code,
      entryDate: expense.expenseDate,
      description: expense.title,
      amount: Number(expense.totalAmount),
      userId,
    });

    return updated;
  });
}

export async function cancelExpense(
  tenantId: TenantId,
  id: string,
  reason: string,
  userId?: string,
  authorized?: boolean
) {
  const tid = requireTenantId(tenantId);
  if (!authorized) throw new AppError("Expense cancellation requires authorization", 403);

  return prisma.$transaction(async (tx) => {
    const expense = await tx.expense.findUnique({ where: { id } });
    if (!expense) throw new AppError("Expense not found", 404);
    assertSameTenant(expense.organizationId, tid);
    if (expense.status === FinDocStatus.CANCELLED) throw new AppError("Already cancelled", 409);

    if (expense.status === FinDocStatus.POSTED) {
      await reverseTreasuryForDocument(tx, tid, "EXPENSE", expense.id, userId, reason);
      await reverseJournalForSourceIfExists(tx, tid, "EXPENSE", expense.id, userId, reason);
    }

    return tx.expense.update({
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

export async function addExpenseAttachment(
  tenantId: TenantId,
  expenseId: string,
  data: { publicId: string; secureUrl: string; fileName?: string | null; bytes?: number | null }
) {
  const tid = requireTenantId(tenantId);
  const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!expense) throw new AppError("Expense not found", 404);
  assertSameTenant(expense.organizationId, tid);
  return prisma.expenseAttachment.create({
    data: {
      organizationId: tid,
      expenseId,
      publicId: data.publicId,
      secureUrl: data.secureUrl,
      fileName: data.fileName,
      bytes: data.bytes,
    },
  });
}

export async function listExpenses(tenantId: TenantId, status?: string) {
  return prisma.expense.findMany({
    where: {
      organizationId: requireTenantId(tenantId),
      ...(status ? { status: status as FinDocStatus } : {}),
    },
    include: { category: true, costCenter: true, attachments: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function expenseReport(tenantId: TenantId, from?: string, to?: string) {
  const tid = requireTenantId(tenantId);
  const items = await prisma.expense.findMany({
    where: {
      organizationId: tid,
      status: FinDocStatus.POSTED,
      ...(from || to
        ? {
            expenseDate: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    },
    include: { category: true, costCenter: true },
    orderBy: { expenseDate: "desc" },
  });
  const total = items.reduce((s, e) => s + Number(e.totalAmount), 0);
  const byCategory = new Map<string, number>();
  for (const e of items) {
    const key = e.category.name;
    byCategory.set(key, (byCategory.get(key) ?? 0) + Number(e.totalAmount));
  }
  return {
    total: Number(total.toFixed(4)),
    count: items.length,
    byCategory: [...byCategory.entries()].map(([name, amount]) => ({ name, amount })),
    items,
  };
}

export async function createRecurringExpense(
  tenantId: TenantId,
  data: {
    code: string;
    title: string;
    categoryId: string;
    costCenterId?: string | null;
    amount: number;
    frequency?: string;
    nextRunAt?: string | null;
    notes?: string | null;
  }
) {
  const tid = requireTenantId(tenantId);
  return prisma.recurringExpense.create({
    data: {
      organizationId: tid,
      code: data.code,
      title: data.title,
      categoryId: data.categoryId,
      costCenterId: data.costCenterId,
      amount: new Prisma.Decimal(data.amount),
      frequency: data.frequency || "MONTHLY",
      nextRunAt: data.nextRunAt ? new Date(data.nextRunAt) : null,
      notes: data.notes,
    },
  });
}

export async function listRecurringExpenses(tenantId: TenantId) {
  return prisma.recurringExpense.findMany({
    where: { organizationId: requireTenantId(tenantId), isActive: true },
    include: { category: true, costCenter: true },
  });
}
