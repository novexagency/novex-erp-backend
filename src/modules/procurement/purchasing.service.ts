import {
  AccountingEventType,
  InventoryDirection,
  InventoryMovementType,
  PaymentStatus,
  Prisma,
  PurchaseDocStatus,
  SupplierLedgerType,
  WorkflowDocumentType,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { generateForSourceIfAccountingEnabled } from "../accounting/posting.engine.js";
import type { WorkflowOpts } from "../workflow/adapters/types.js";
import {
  assertDirectApproveAllowed,
  startApprovalIfConfigured,
} from "../workflow/engine.service.js";
import { nextDocumentNumber } from "./documentNumber.js";
import { applyMovement, getActiveWarehouse } from "./inventory.service.js";
import { computeLineTotals, sumDocTotals } from "./lineMath.js";

async function assertProduct(tid: string, productId: string) {
  const p = await prisma.product.findUnique({ where: { id: productId } });
  if (!p || p.organizationId !== tid) throw new AppError("Product not found", 404);
  return p;
}

async function assertSupplier(tid: string, supplierId: string) {
  const s = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!s || s.organizationId !== tid) throw new AppError("Supplier not found", 404);
  return s;
}

// ---------- Purchase Requests ----------

export async function createPurchaseRequest(
  tenantId: TenantId,
  data: {
    notes?: string | null;
    neededBy?: string | null;
    lines: Array<{ productId: string; quantity: number; notes?: string | null }>;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  if (!data.lines?.length) throw new AppError("At least one line required", 400);
  for (const l of data.lines) await assertProduct(tid, l.productId);

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "PR", "PR");
    return tx.purchaseRequest.create({
      data: {
        organizationId: tid,
        code,
        notes: data.notes,
        neededBy: data.neededBy ? new Date(data.neededBy) : null,
        requestedByUserId: userId,
        lines: {
          create: data.lines.map((l) => ({
            organizationId: tid,
            productId: l.productId,
            quantity: new Prisma.Decimal(l.quantity),
            notes: l.notes,
          })),
        },
      },
      include: { lines: { include: { product: true } } },
    });
  });
}

export async function listPurchaseRequests(tenantId: TenantId, status?: string) {
  const tid = requireTenantId(tenantId);
  return prisma.purchaseRequest.findMany({
    where: {
      organizationId: tid,
      ...(status ? { status: status as PurchaseDocStatus } : {}),
    },
    include: { lines: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPurchaseRequest(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.purchaseRequest.findUnique({
    where: { id },
    include: { lines: { include: { product: true } }, purchaseOrders: true },
  });
  if (!row) throw new AppError("Purchase request not found", 404);
  assertSameTenant(row.organizationId, tid);
  return row;
}

export async function submitPurchaseRequest(
  tenantId: TenantId,
  id: string,
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const row = await getPurchaseRequest(tid, id);
  if (row.status !== PurchaseDocStatus.DRAFT) throw new AppError("Only DRAFT requests can be submitted", 400);
  const updated = await prisma.purchaseRequest.update({
    where: { id },
    data: { status: PurchaseDocStatus.SUBMITTED },
    include: { lines: true },
  });
  const approval = await startApprovalIfConfigured(tid, {
    documentType: WorkflowDocumentType.PURCHASE_REQUEST,
    documentId: id,
    submittedByUserId: userId,
  });
  return approval ? { ...updated, pendingApproval: true, approvalId: approval.id } : updated;
}

export async function approvePurchaseRequest(
  tenantId: TenantId,
  id: string,
  userId?: string,
  opts?: WorkflowOpts
) {
  const tid = requireTenantId(tenantId);
  await assertDirectApproveAllowed(tid, WorkflowDocumentType.PURCHASE_REQUEST, id, opts);
  const row = await getPurchaseRequest(tid, id);
  if (row.status !== PurchaseDocStatus.SUBMITTED && row.status !== PurchaseDocStatus.DRAFT) {
    throw new AppError("Request cannot be approved in current status", 400);
  }
  return prisma.purchaseRequest.update({
    where: { id },
    data: {
      status: PurchaseDocStatus.APPROVED,
      approvedAt: new Date(),
      approvedByUserId: userId,
    },
    include: { lines: true },
  });
}

export async function rejectPurchaseRequest(
  tenantId: TenantId,
  id: string,
  reason?: string,
  userId?: string,
  opts?: WorkflowOpts
) {
  const tid = requireTenantId(tenantId);
  await assertDirectApproveAllowed(tid, WorkflowDocumentType.PURCHASE_REQUEST, id, opts);
  await getPurchaseRequest(tid, id);
  return prisma.purchaseRequest.update({
    where: { id },
    data: {
      status: PurchaseDocStatus.REJECTED,
      rejectionReason: reason,
      approvedByUserId: userId,
      approvedAt: new Date(),
    },
    include: { lines: true },
  });
}

// ---------- Purchase Orders ----------

export async function createPurchaseOrder(
  tenantId: TenantId,
  data: {
    supplierId: string;
    purchaseRequestId?: string | null;
    expectedDeliveryDate?: string | null;
    notes?: string | null;
    lines: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      discountPercent?: number;
      discountAmount?: number;
      taxPercent?: number;
      notes?: string | null;
    }>;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  await assertSupplier(tid, data.supplierId);
  if (!data.lines?.length) throw new AppError("At least one line required", 400);
  for (const l of data.lines) await assertProduct(tid, l.productId);

  if (data.purchaseRequestId) {
    const pr = await getPurchaseRequest(tid, data.purchaseRequestId);
    if (pr.status !== PurchaseDocStatus.APPROVED) {
      throw new AppError("Purchase request must be APPROVED before creating PO", 400);
    }
  }

  const computed = data.lines.map((l) => ({
    ...l,
    ...computeLineTotals(l),
  }));
  const totals = sumDocTotals(computed);

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "PO", "PO");
    return tx.purchaseOrder.create({
      data: {
        organizationId: tid,
        code,
        supplierId: data.supplierId,
        purchaseRequestId: data.purchaseRequestId ?? null,
        expectedDeliveryDate: data.expectedDeliveryDate
          ? new Date(data.expectedDeliveryDate)
          : null,
        notes: data.notes,
        createdByUserId: userId,
        ...totals,
        lines: {
          create: computed.map((l) => ({
            organizationId: tid,
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent,
            discountAmount: l.discountAmount,
            taxPercent: l.taxPercent,
            taxAmount: l.taxAmount,
            lineSubtotal: l.lineSubtotal,
            lineTotal: l.lineTotal,
            notes: l.notes,
          })),
        },
      },
      include: {
        lines: { include: { product: true } },
        supplier: true,
        attachments: true,
      },
    });
  });
}

export async function listPurchaseOrders(tenantId: TenantId, status?: string) {
  const tid = requireTenantId(tenantId);
  return prisma.purchaseOrder.findMany({
    where: {
      organizationId: tid,
      ...(status ? { status: status as PurchaseDocStatus } : {}),
    },
    include: { supplier: true, lines: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPurchaseOrder(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      lines: { include: { product: true } },
      attachments: true,
      goodsReceipts: { include: { lines: true } },
    },
  });
  if (!row) throw new AppError("Purchase order not found", 404);
  assertSameTenant(row.organizationId, tid);
  return row;
}

export async function issuePurchaseOrder(
  tenantId: TenantId,
  id: string,
  userId?: string,
  opts?: WorkflowOpts
) {
  const tid = requireTenantId(tenantId);
  const po = await getPurchaseOrder(tid, id);
  if (po.status !== PurchaseDocStatus.DRAFT) throw new AppError("Only DRAFT POs can be issued", 400);

  if (!opts?.fromWorkflow) {
    const amount = po.lines.reduce(
      (s, l) => s + Number(l.lineTotal ?? Number(l.quantity) * Number(l.unitPrice)),
      0
    );
    const approval = await startApprovalIfConfigured(tid, {
      documentType: WorkflowDocumentType.PURCHASE_ORDER,
      documentId: id,
      amount,
      submittedByUserId: userId,
    });
    if (approval) {
      return { ...po, pendingApproval: true, approvalId: approval.id };
    }
  }

  return prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: PurchaseDocStatus.ISSUED,
      issuedAt: new Date(),
      issuedByUserId: userId,
    },
    include: { lines: true, supplier: true },
  });
}

export async function rejectPurchaseOrderWorkflow(
  tenantId: TenantId,
  id: string,
  reason?: string
) {
  const tid = requireTenantId(tenantId);
  await getPurchaseOrder(tid, id);
  return prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: PurchaseDocStatus.CANCELLED,
      notes: reason ? `Workflow rejected: ${reason}` : "Workflow rejected",
    },
    include: { lines: true, supplier: true },
  });
}

export async function addPoAttachment(
  tenantId: TenantId,
  purchaseOrderId: string,
  data: {
    publicId: string;
    secureUrl: string;
    resourceType?: string;
    fileName?: string | null;
    bytes?: number | null;
  }
) {
  const tid = requireTenantId(tenantId);
  await getPurchaseOrder(tid, purchaseOrderId);
  return prisma.purchaseOrderAttachment.create({
    data: {
      organizationId: tid,
      purchaseOrderId,
      publicId: data.publicId,
      secureUrl: data.secureUrl,
      resourceType: data.resourceType || "raw",
      fileName: data.fileName,
      bytes: data.bytes,
    },
  });
}

async function refreshPoReceiveStatus(tx: Prisma.TransactionClient, purchaseOrderId: string) {
  const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId } });
  const allReceived = lines.every((l) => Number(l.quantityReceived) >= Number(l.quantity) - 0.0001);
  const anyReceived = lines.some((l) => Number(l.quantityReceived) > 0);
  const status = allReceived
    ? PurchaseDocStatus.RECEIVED
    : anyReceived
      ? PurchaseDocStatus.PARTIALLY_RECEIVED
      : PurchaseDocStatus.ISSUED;
  await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status } });
}

// ---------- Goods Receiving ----------

export async function createGoodsReceipt(
  tenantId: TenantId,
  data: {
    purchaseOrderId: string;
    allowOverReceive?: boolean;
    notes?: string | null;
    receivedAt?: string | null;
    lines: Array<{
      purchaseOrderLineId: string;
      quantityReceived: number;
      unitCost?: number;
      notes?: string | null;
    }>;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const po = await getPurchaseOrder(tid, data.purchaseOrderId);
  if (
    po.status !== PurchaseDocStatus.ISSUED &&
    po.status !== PurchaseDocStatus.PARTIALLY_RECEIVED
  ) {
    throw new AppError("PO must be ISSUED or PARTIALLY_RECEIVED to receive goods", 400);
  }
  if (!data.lines?.length) throw new AppError("At least one receive line required", 400);

  const warehouse = await getActiveWarehouse(tid);
  const allowOver = Boolean(data.allowOverReceive);

  const lineCreates: Array<{
    organizationId: string;
    purchaseOrderLineId: string;
    productId: string;
    quantityOrdered: Prisma.Decimal;
    quantityReceived: Prisma.Decimal;
    unitCost: Prisma.Decimal;
    notes?: string | null;
  }> = [];
  for (const l of data.lines) {
    const poLine = po.lines.find((x) => x.id === l.purchaseOrderLineId);
    if (!poLine) throw new AppError("PO line not found on this order", 400);
    const remaining = Number(poLine.quantity) - Number(poLine.quantityReceived);
    if (l.quantityReceived <= 0) throw new AppError("Received quantity must be positive", 400);
    if (!allowOver && l.quantityReceived > remaining + 0.0001) {
      throw new AppError(
        `Cannot receive more than remaining qty (${remaining}) without authorization (allowOverReceive)`,
        400
      );
    }
    lineCreates.push({
      organizationId: tid,
      purchaseOrderLineId: poLine.id,
      productId: poLine.productId,
      quantityOrdered: poLine.quantity,
      quantityReceived: new Prisma.Decimal(l.quantityReceived),
      unitCost: new Prisma.Decimal(l.unitCost ?? Number(poLine.unitPrice)),
      notes: l.notes,
    });
  }

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "GRN", "GRN");
    return tx.goodsReceipt.create({
      data: {
        organizationId: tid,
        code,
        purchaseOrderId: po.id,
        warehouseId: warehouse.id,
        allowOverReceive: allowOver,
        notes: data.notes,
        receivedAt: data.receivedAt ? new Date(data.receivedAt) : new Date(),
        createdByUserId: userId,
        lines: { create: lineCreates },
      },
      include: { lines: { include: { product: true } }, purchaseOrder: true },
    });
  });
}

export async function getGoodsReceipt(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.goodsReceipt.findUnique({
    where: { id },
    include: {
      lines: { include: { product: true, purchaseOrderLine: true } },
      purchaseOrder: true,
    },
  });
  if (!row) throw new AppError("Goods receipt not found", 404);
  assertSameTenant(row.organizationId, tid);
  return row;
}

export async function listGoodsReceipts(tenantId: TenantId, status?: string) {
  const tid = requireTenantId(tenantId);
  return prisma.goodsReceipt.findMany({
    where: {
      organizationId: tid,
      ...(status ? { status: status as PurchaseDocStatus } : {}),
    },
    include: { lines: true, purchaseOrder: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Post GRN — only then inventory is updated. Idempotent against re-post. */
export async function postGoodsReceipt(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);

  return prisma.$transaction(async (tx) => {
    const grn = await tx.goodsReceipt.findUnique({
      where: { id },
      include: { lines: true, purchaseOrder: { include: { lines: true } } },
    });
    if (!grn) throw new AppError("Goods receipt not found", 404);
    assertSameTenant(grn.organizationId, tid);
    if (grn.status === PurchaseDocStatus.POSTED) throw new AppError("GRN already posted", 409);
    if (grn.status === PurchaseDocStatus.CANCELLED) throw new AppError("GRN is cancelled", 400);

    for (const line of grn.lines) {
      const poLine = grn.purchaseOrder.lines.find((l) => l.id === line.purchaseOrderLineId);
      if (!poLine) throw new AppError("PO line missing", 400);
      const remaining = Number(poLine.quantity) - Number(poLine.quantityReceived);
      const qty = Number(line.quantityReceived);
      if (!grn.allowOverReceive && qty > remaining + 0.0001) {
        throw new AppError(`Over-receive not authorized for line ${line.id}`, 400);
      }

      await applyMovement(tx, {
        organizationId: tid,
        warehouseId: grn.warehouseId,
        productId: line.productId,
        type: InventoryMovementType.GRN_RECEIPT,
        direction: InventoryDirection.IN,
        quantity: qty,
        unitCost: Number(line.unitCost),
        referenceType: "GOODS_RECEIPT",
        referenceId: grn.id,
        referenceCode: grn.code,
        sourceLineId: `GRN_LINE:${line.id}`,
        postedByUserId: userId,
      });

      await tx.purchaseOrderLine.update({
        where: { id: poLine.id },
        data: {
          quantityReceived: new Prisma.Decimal(
            (Number(poLine.quantityReceived) + qty).toFixed(4)
          ),
        },
      });
    }

    await refreshPoReceiveStatus(tx, grn.purchaseOrderId);

    return tx.goodsReceipt.update({
      where: { id: grn.id },
      data: {
        status: PurchaseDocStatus.POSTED,
        postedAt: new Date(),
        postedByUserId: userId,
      },
      include: { lines: true },
    });
  });
}

// ---------- Purchase Invoices ----------

export async function createPurchaseInvoice(
  tenantId: TenantId,
  data: {
    supplierId: string;
    purchaseOrderId?: string | null;
    supplierInvoiceNo?: string | null;
    invoiceDate?: string;
    dueDate?: string | null;
    notes?: string | null;
    lines: Array<{
      productId?: string | null;
      description?: string | null;
      quantity: number;
      unitPrice: number;
      discountPercent?: number;
      discountAmount?: number;
      taxPercent?: number;
    }>;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  await assertSupplier(tid, data.supplierId);
  if (!data.lines?.length) throw new AppError("At least one line required", 400);
  if (data.purchaseOrderId) await getPurchaseOrder(tid, data.purchaseOrderId);

  const computed = data.lines.map((l) => ({ ...l, ...computeLineTotals(l) }));
  const totals = sumDocTotals(computed);

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "PINV", "PINV");
    return tx.purchaseInvoice.create({
      data: {
        organizationId: tid,
        code,
        supplierId: data.supplierId,
        purchaseOrderId: data.purchaseOrderId ?? null,
        supplierInvoiceNo: data.supplierInvoiceNo,
        invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : new Date(),
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        notes: data.notes,
        createdByUserId: userId,
        ...totals,
        lines: {
          create: computed.map((l) => ({
            organizationId: tid,
            productId: l.productId ?? null,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent,
            discountAmount: l.discountAmount,
            taxPercent: l.taxPercent,
            taxAmount: l.taxAmount,
            lineSubtotal: l.lineSubtotal,
            lineTotal: l.lineTotal,
          })),
        },
      },
      include: { lines: true, supplier: true },
    });
  });
}

export async function getPurchaseInvoice(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.purchaseInvoice.findUnique({
    where: { id },
    include: { lines: true, supplier: true, paymentAllocations: true },
  });
  if (!row) throw new AppError("Purchase invoice not found", 404);
  assertSameTenant(row.organizationId, tid);
  return row;
}

export async function listPurchaseInvoices(tenantId: TenantId, status?: string) {
  const tid = requireTenantId(tenantId);
  return prisma.purchaseInvoice.findMany({
    where: {
      organizationId: tid,
      ...(status ? { status: status as PurchaseDocStatus } : {}),
    },
    include: { supplier: true, lines: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function postPurchaseInvoice(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);

  return prisma.$transaction(async (tx) => {
    const inv = await tx.purchaseInvoice.findUnique({ where: { id }, include: { lines: true } });
    if (!inv) throw new AppError("Purchase invoice not found", 404);
    assertSameTenant(inv.organizationId, tid);
    if (inv.status === PurchaseDocStatus.POSTED) throw new AppError("Invoice already posted", 409);

    await tx.supplierLedgerEntry.create({
      data: {
        organizationId: tid,
        supplierId: inv.supplierId,
        type: SupplierLedgerType.PURCHASE,
        amount: inv.totalAmount,
        direction: "CREDIT",
        reference: inv.code,
        referenceType: "PURCHASE_INVOICE",
        referenceId: inv.id,
        createdByUserId: userId,
      },
    });

    const updated = await tx.purchaseInvoice.update({
      where: { id },
      data: {
        status: PurchaseDocStatus.POSTED,
        postedAt: new Date(),
        postedByUserId: userId,
      },
      include: { lines: true },
    });

    await generateForSourceIfAccountingEnabled(tx, {
      organizationId: tid,
      eventType: AccountingEventType.PURCHASE_INVOICE,
      sourceType: "PURCHASE_INVOICE",
      sourceId: inv.id,
      sourceCode: inv.code,
      entryDate: inv.invoiceDate ?? new Date(),
      description: `Purchase invoice ${inv.code}`,
      amount: Number(inv.totalAmount),
      userId,
    });

    return updated;
  });
}

// ---------- Supplier Payments ----------

export async function createSupplierPayment(
  tenantId: TenantId,
  data: {
    supplierId: string;
    amount: number;
    paymentMethod?: string | null;
    reference?: string | null;
    paymentDate?: string;
    notes?: string | null;
    allocations: Array<{ purchaseInvoiceId: string; amount: number }>;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  await assertSupplier(tid, data.supplierId);
  if (data.amount <= 0) throw new AppError("Payment amount must be positive", 400);
  if (!data.allocations?.length) throw new AppError("At least one allocation required", 400);

  const allocSum = data.allocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(allocSum - data.amount) > 0.01) {
    throw new AppError("Allocation total must equal payment amount", 400);
  }

  return prisma.$transaction(async (tx) => {
    for (const a of data.allocations) {
      const inv = await tx.purchaseInvoice.findUnique({ where: { id: a.purchaseInvoiceId } });
      if (!inv || inv.organizationId !== tid) throw new AppError("Invoice not found", 404);
      if (inv.supplierId !== data.supplierId) throw new AppError("Invoice supplier mismatch", 400);
      if (inv.status !== PurchaseDocStatus.POSTED) throw new AppError("Invoice must be posted", 400);
      const due = Number(inv.totalAmount) - Number(inv.amountPaid);
      if (a.amount > due + 0.01) throw new AppError(`Allocation exceeds invoice balance (${due})`, 400);
    }

    const code = await nextDocumentNumber(tx, tid, "SPAY", "SPAY");
    const payment = await tx.supplierPayment.create({
      data: {
        organizationId: tid,
        code,
        supplierId: data.supplierId,
        amount: new Prisma.Decimal(data.amount),
        paymentMethod: data.paymentMethod,
        reference: data.reference,
        paymentDate: data.paymentDate ? new Date(data.paymentDate) : new Date(),
        notes: data.notes,
        status: "POSTED",
        postedAt: new Date(),
        postedByUserId: userId,
        createdByUserId: userId,
        allocations: {
          create: data.allocations.map((a) => ({
            organizationId: tid,
            purchaseInvoiceId: a.purchaseInvoiceId,
            amount: new Prisma.Decimal(a.amount),
          })),
        },
      },
      include: { allocations: true },
    });

    await tx.supplierLedgerEntry.create({
      data: {
        organizationId: tid,
        supplierId: data.supplierId,
        type: SupplierLedgerType.PAYMENT,
        amount: new Prisma.Decimal(data.amount),
        direction: "DEBIT",
        reference: code,
        referenceType: "SUPPLIER_PAYMENT",
        referenceId: payment.id,
        createdByUserId: userId,
      },
    });

    for (const a of data.allocations) {
      const inv = await tx.purchaseInvoice.findUnique({ where: { id: a.purchaseInvoiceId } });
      if (!inv) continue;
      const newPaid = Number(inv.amountPaid) + a.amount;
      const total = Number(inv.totalAmount);
      const paymentStatus =
        newPaid >= total - 0.01
          ? PaymentStatus.PAID
          : newPaid > 0
            ? PaymentStatus.PARTIAL
            : PaymentStatus.UNPAID;
      await tx.purchaseInvoice.update({
        where: { id: inv.id },
        data: {
          amountPaid: new Prisma.Decimal(newPaid.toFixed(4)),
          paymentStatus,
        },
      });
    }

    return payment;
  });
}

export async function listSupplierPayments(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  return prisma.supplierPayment.findMany({
    where: { organizationId: tid },
    include: { allocations: true, supplier: true },
    orderBy: { createdAt: "desc" },
  });
}

// ---------- Purchase Returns ----------

export async function createPurchaseReturn(
  tenantId: TenantId,
  data: {
    supplierId: string;
    purchaseOrderId?: string | null;
    goodsReceiptId?: string | null;
    reason?: string | null;
    notes?: string | null;
    lines: Array<{
      productId: string;
      purchaseOrderLineId?: string | null;
      quantity: number;
      unitCost?: number;
      notes?: string | null;
    }>;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  await assertSupplier(tid, data.supplierId);
  if (!data.lines?.length) throw new AppError("At least one line required", 400);
  for (const l of data.lines) await assertProduct(tid, l.productId);
  const warehouse = await getActiveWarehouse(tid);

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "PRTN", "PRTN");
    return tx.purchaseReturn.create({
      data: {
        organizationId: tid,
        code,
        supplierId: data.supplierId,
        purchaseOrderId: data.purchaseOrderId ?? null,
        goodsReceiptId: data.goodsReceiptId ?? null,
        warehouseId: warehouse.id,
        reason: data.reason,
        notes: data.notes,
        createdByUserId: userId,
        lines: {
          create: data.lines.map((l) => ({
            organizationId: tid,
            productId: l.productId,
            purchaseOrderLineId: l.purchaseOrderLineId ?? null,
            quantity: new Prisma.Decimal(l.quantity),
            unitCost: new Prisma.Decimal(l.unitCost ?? 0),
            notes: l.notes,
          })),
        },
      },
      include: { lines: true },
    });
  });
}

export async function getPurchaseReturn(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.purchaseReturn.findUnique({
    where: { id },
    include: { lines: { include: { product: true } }, supplier: true },
  });
  if (!row) throw new AppError("Purchase return not found", 404);
  assertSameTenant(row.organizationId, tid);
  return row;
}

export async function listPurchaseReturns(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  return prisma.purchaseReturn.findMany({
    where: { organizationId: tid },
    include: { lines: true, supplier: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Post return — reverse inventory + optionally reduce PO received qty. */
export async function postPurchaseReturn(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);

  return prisma.$transaction(async (tx) => {
    const ret = await tx.purchaseReturn.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!ret) throw new AppError("Purchase return not found", 404);
    assertSameTenant(ret.organizationId, tid);
    if (ret.status === PurchaseDocStatus.POSTED) throw new AppError("Return already posted", 409);

    for (const line of ret.lines) {
      await applyMovement(tx, {
        organizationId: tid,
        warehouseId: ret.warehouseId,
        productId: line.productId,
        type: InventoryMovementType.PURCHASE_RETURN,
        direction: InventoryDirection.OUT,
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost),
        referenceType: "PURCHASE_RETURN",
        referenceId: ret.id,
        referenceCode: ret.code,
        sourceLineId: `PRTN_LINE:${line.id}`,
        note: ret.reason,
        postedByUserId: userId,
      });

      if (line.purchaseOrderLineId) {
        const poLine = await tx.purchaseOrderLine.findUnique({
          where: { id: line.purchaseOrderLineId },
        });
        if (poLine) {
          const next = Math.max(0, Number(poLine.quantityReceived) - Number(line.quantity));
          await tx.purchaseOrderLine.update({
            where: { id: poLine.id },
            data: { quantityReceived: new Prisma.Decimal(next.toFixed(4)) },
          });
          await refreshPoReceiveStatus(tx, poLine.purchaseOrderId);
        }
      }
    }

    const updated = await tx.purchaseReturn.update({
      where: { id },
      data: {
        status: PurchaseDocStatus.POSTED,
        postedAt: new Date(),
        postedByUserId: userId,
      },
      include: { lines: true },
    });

    const returnAmount = ret.lines.reduce(
      (s, l) => s + Number(l.quantity) * Number(l.unitCost),
      0
    );
    if (returnAmount > 0) {
      await generateForSourceIfAccountingEnabled(tx, {
        organizationId: tid,
        eventType: AccountingEventType.PURCHASE_RETURN,
        sourceType: "PURCHASE_RETURN",
        sourceId: ret.id,
        sourceCode: ret.code,
        entryDate: new Date(),
        description: `Purchase return ${ret.code}`,
        amount: Number(returnAmount.toFixed(4)),
        userId,
      });
    }

    return updated;
  });
}
