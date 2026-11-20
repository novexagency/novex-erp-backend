import {
  AccountingEventType,
  CustomerLedgerType,
  Prisma,
  SalesDocStatus,
  SalesPaymentStatus,
  WorkflowDocumentType,
} from "@prisma/client";
import { nextDocumentNumber } from "../../lib/documentNumber.js";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { generateForSourceIfAccountingEnabled } from "../accounting/posting.engine.js";
import { computeLineTotals, sumDocTotals } from "../procurement/lineMath.js";
import type { WorkflowOpts } from "../workflow/adapters/types.js";
import { startApprovalIfConfigured } from "../workflow/engine.service.js";
import * as invDocs from "../inventory/documents.service.js";
import { resolveUnitPrice } from "./pricing.service.js";

type LineIn = {
  productId: string;
  quantity: number;
  unitPrice?: number;
  manualUnitPrice?: number | null;
  allowManualPrice?: boolean;
  discountPercent?: number;
  discountAmount?: number;
  taxPercent?: number;
  notes?: string | null;
};

async function assertCustomer(tid: string, customerId: string) {
  const c = await prisma.customer.findFirst({ where: { id: customerId, organizationId: tid } });
  if (!c) throw new AppError("Customer not found", 404);
  return c;
}

async function buildPricedLines(
  tid: string,
  customerId: string,
  priceListId: string | null | undefined,
  lines: LineIn[]
) {
  const computed = [];
  for (const l of lines) {
    const priced = await resolveUnitPrice(tid, {
      customerId,
      productId: l.productId,
      priceListId,
      quantity: l.quantity,
      manualUnitPrice: l.manualUnitPrice ?? (l.unitPrice != null && l.allowManualPrice ? l.unitPrice : null),
      allowManualPrice: l.allowManualPrice,
    });
    const unitPrice = l.allowManualPrice && l.unitPrice != null ? l.unitPrice : priced.unitPrice;
    const totals = computeLineTotals({
      quantity: l.quantity,
      unitPrice,
      discountPercent: l.discountPercent ?? priced.discountPercent ?? 0,
      discountAmount: l.discountAmount,
      taxPercent: l.taxPercent ?? 0,
    });
    computed.push({
      productId: l.productId,
      notes: l.notes,
      listPrice: priced.listPrice != null ? new Prisma.Decimal(priced.listPrice) : null,
      manualPrice: priced.manualPrice || Boolean(l.allowManualPrice && l.unitPrice != null),
      ...totals,
    });
  }
  return { computed, totals: sumDocTotals(computed) };
}

// ---------- Quotations ----------

export async function createQuotation(
  tenantId: TenantId,
  data: {
    customerId: string;
    priceListId?: string | null;
    expiresAt?: string | null;
    notes?: string | null;
    lines: LineIn[];
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  await assertCustomer(tid, data.customerId);
  if (!data.lines?.length) throw new AppError("At least one line required", 400);
  const { computed, totals } = await buildPricedLines(tid, data.customerId, data.priceListId, data.lines);

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "SQ", "SQ");
    return tx.salesQuotation.create({
      data: {
        organizationId: tid,
        code,
        customerId: data.customerId,
        priceListId: data.priceListId,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        notes: data.notes,
        createdByUserId: userId,
        ...totals,
        lines: {
          create: computed.map((l) => ({
            organizationId: tid,
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            listPrice: l.listPrice,
            manualPrice: l.manualPrice,
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
      include: { lines: { include: { product: true } }, customer: true },
    });
  });
}

export async function listQuotations(tenantId: TenantId, status?: string) {
  return prisma.salesQuotation.findMany({
    where: {
      organizationId: requireTenantId(tenantId),
      ...(status ? { status: status as SalesDocStatus } : {}),
    },
    include: { customer: true, lines: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getQuotation(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.salesQuotation.findUnique({
    where: { id },
    include: { lines: { include: { product: true } }, customer: true },
  });
  if (!row) throw new AppError("Quotation not found", 404);
  assertSameTenant(row.organizationId, tid);
  if (row.status === SalesDocStatus.DRAFT || row.status === SalesDocStatus.SENT) {
    if (row.expiresAt && row.expiresAt < new Date()) {
      return prisma.salesQuotation.update({
        where: { id },
        data: { status: SalesDocStatus.EXPIRED },
        include: { lines: { include: { product: true } }, customer: true },
      });
    }
  }
  return row;
}

export async function updateQuotationStatus(
  tenantId: TenantId,
  id: string,
  status: "SENT" | "ACCEPTED" | "REJECTED" | "CANCELLED"
) {
  const tid = requireTenantId(tenantId);
  await getQuotation(tid, id);
  return prisma.salesQuotation.update({
    where: { id },
    data: { status: status as SalesDocStatus },
    include: { lines: true },
  });
}

export async function convertQuotationToOrder(tenantId: TenantId, quotationId: string, userId?: string) {
  const tid = requireTenantId(tenantId);
  const q = await getQuotation(tid, quotationId);
  if (q.status === SalesDocStatus.CONVERTED) throw new AppError("Quotation already converted", 409);
  if (q.status === SalesDocStatus.EXPIRED || q.status === SalesDocStatus.CANCELLED) {
    throw new AppError("Cannot convert expired/cancelled quotation", 400);
  }
  if (q.status !== SalesDocStatus.ACCEPTED && q.status !== SalesDocStatus.SENT && q.status !== SalesDocStatus.DRAFT) {
    throw new AppError("Quotation cannot be converted in current status", 400);
  }

  const order = await createSalesOrder(
    tid,
    {
      customerId: q.customerId,
      quotationId: q.id,
      priceListId: q.priceListId,
      notes: q.notes,
      lines: q.lines.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        allowManualPrice: true,
        discountPercent: Number(l.discountPercent),
        discountAmount: Number(l.discountAmount),
        taxPercent: Number(l.taxPercent),
        notes: l.notes,
      })),
    },
    userId
  );

  await prisma.salesQuotation.update({
    where: { id: q.id },
    data: { status: SalesDocStatus.CONVERTED, convertedOrderId: order.id },
  });

  return order;
}

// ---------- Sales Orders ----------

export async function createSalesOrder(
  tenantId: TenantId,
  data: {
    customerId: string;
    quotationId?: string | null;
    priceListId?: string | null;
    notes?: string | null;
    promisedDeliveryAt?: string | null;
    lines: LineIn[];
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  await assertCustomer(tid, data.customerId);
  if (!data.lines?.length) throw new AppError("At least one line required", 400);
  const { computed, totals } = await buildPricedLines(tid, data.customerId, data.priceListId, data.lines);

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "SO", "SO");
    return tx.salesOrder.create({
      data: {
        organizationId: tid,
        code,
        customerId: data.customerId,
        quotationId: data.quotationId,
        priceListId: data.priceListId,
        notes: data.notes,
        promisedDeliveryAt: data.promisedDeliveryAt ? new Date(data.promisedDeliveryAt) : null,
        createdByUserId: userId,
        ...totals,
        lines: {
          create: computed.map((l) => ({
            organizationId: tid,
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            listPrice: l.listPrice,
            manualPrice: l.manualPrice,
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
      include: { lines: { include: { product: true } }, customer: true },
    });
  });
}

export async function listSalesOrders(tenantId: TenantId, status?: string) {
  return prisma.salesOrder.findMany({
    where: {
      organizationId: requireTenantId(tenantId),
      ...(status ? { status: status as SalesDocStatus } : {}),
    },
    include: { customer: true, lines: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getSalesOrder(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.salesOrder.findUnique({
    where: { id },
    include: {
      lines: { include: { product: true } },
      customer: true,
      quotation: true,
      invoices: true,
    },
  });
  if (!row) throw new AppError("Sales order not found", 404);
  assertSameTenant(row.organizationId, tid);
  return row;
}

/** Update draft sales order only (same payload shape as create). */
export async function updateSalesOrder(
  tenantId: TenantId,
  id: string,
  data: {
    customerId: string;
    quotationId?: string | null;
    priceListId?: string | null;
    notes?: string | null;
    promisedDeliveryAt?: string | null;
    lines: LineIn[];
  }
) {
  const tid = requireTenantId(tenantId);
  const existing = await getSalesOrder(tid, id);
  if (existing.status !== SalesDocStatus.DRAFT) {
    throw new AppError(
      `Only DRAFT sales orders can be edited (current status: ${existing.status})`,
      400
    );
  }
  await assertCustomer(tid, data.customerId);
  if (!data.lines?.length) throw new AppError("At least one line required", 400);
  const { computed, totals } = await buildPricedLines(
    tid,
    data.customerId,
    data.priceListId,
    data.lines
  );

  await prisma.$transaction(async (tx) => {
    await tx.salesOrderLine.deleteMany({ where: { salesOrderId: id } });
    await tx.salesOrder.update({
      where: { id },
      data: {
        customerId: data.customerId,
        quotationId: data.quotationId ?? null,
        priceListId: data.priceListId ?? null,
        notes: data.notes ?? null,
        promisedDeliveryAt: data.promisedDeliveryAt
          ? new Date(data.promisedDeliveryAt)
          : null,
        ...totals,
        lines: {
          create: computed.map((l) => ({
            organizationId: tid,
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            listPrice: l.listPrice,
            manualPrice: l.manualPrice,
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
    });
  });

  return getSalesOrder(tid, id);
}

/**
 * Cancel draft / confirmed / reserved orders.
 * Blocks after any delivery. Releases inventory reservation when present.
 */
export async function cancelSalesOrder(
  tenantId: TenantId,
  id: string,
  data: { reason: string }
) {
  const tid = requireTenantId(tenantId);
  const reason = data.reason?.trim();
  if (!reason) throw new AppError("Cancel reason is required", 400);

  const order = await getSalesOrder(tid, id);
  if (
    order.status === SalesDocStatus.DELIVERED ||
    order.status === SalesDocStatus.PARTIALLY_DELIVERED ||
    order.deliveryStatus === "DELIVERED" ||
    order.deliveryStatus === "PARTIAL" ||
    order.lines.some((l) => Number(l.quantityDelivered) > 0)
  ) {
    throw new AppError("Cannot cancel a sales order after delivery has started", 400);
  }
  if (order.status === SalesDocStatus.CANCELLED) {
    throw new AppError("Sales order already cancelled", 409);
  }
  if (order.status === SalesDocStatus.INVOICED) {
    throw new AppError("Cannot cancel an invoiced sales order", 400);
  }

  if (order.reservationId && order.reservationStatus === "RESERVED") {
    try {
      await invDocs.releaseReservation(tid, order.reservationId);
    } catch (err) {
      // Already released/consumed is acceptable during cancel races
      if (!(err instanceof AppError && (err.statusCode === 409 || err.statusCode === 404))) {
        throw err;
      }
    }
  }

  await prisma.salesOrderLine.updateMany({
    where: { salesOrderId: id },
    data: { quantityReserved: new Prisma.Decimal(0) },
  });

  await prisma.salesOrder.update({
    where: { id },
    data: {
      status: SalesDocStatus.CANCELLED,
      reservationStatus: order.reservationId ? "RELEASED" : order.reservationStatus,
      notes: order.notes
        ? `${order.notes}\n[CANCELLED] ${reason}`
        : `[CANCELLED] ${reason}`,
    },
  });

  return getSalesOrder(tid, id);
}

export async function confirmSalesOrder(
  tenantId: TenantId,
  id: string,
  opts?: WorkflowOpts
) {
  const tid = requireTenantId(tenantId);
  const order = await getSalesOrder(tid, id);
  if (order.status !== SalesDocStatus.DRAFT) throw new AppError("Only DRAFT orders can be confirmed", 400);

  const needsDiscountApproval = order.lines.some(
    (l) => Number(l.discountPercent) > 5 || l.manualPrice === true
  );
  if (needsDiscountApproval && !opts?.fromWorkflow) {
    const discountAmount = order.lines.reduce((s, l) => {
      const base = Number(l.quantity) * Number(l.unitPrice);
      return s + (base * Number(l.discountPercent)) / 100 + Number(l.discountAmount ?? 0);
    }, 0);
    const approval = await startApprovalIfConfigured(tid, {
      documentType: WorkflowDocumentType.SALES_DISCOUNT,
      documentId: id,
      amount: discountAmount,
    });
    if (approval) {
      return { ...order, pendingApproval: true, approvalId: approval.id };
    }
  }

  return prisma.salesOrder.update({
    where: { id },
    data: { status: SalesDocStatus.CONFIRMED, confirmedAt: new Date() },
    include: { lines: true, customer: true },
  });
}

export async function rejectSalesDiscountWorkflow(
  tenantId: TenantId,
  id: string,
  reason?: string
) {
  const tid = requireTenantId(tenantId);
  await getSalesOrder(tid, id);
  return prisma.salesOrder.update({
    where: { id },
    data: {
      status: SalesDocStatus.REJECTED,
      notes: reason ? `Discount rejected: ${reason}` : "Discount rejected",
    },
    include: { lines: true, customer: true },
  });
}

export async function reserveSalesOrder(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);
  const order = await getSalesOrder(tid, id);
  if (order.status !== SalesDocStatus.CONFIRMED && order.status !== SalesDocStatus.DRAFT) {
    throw new AppError("Order must be confirmed before reservation", 400);
  }
  if (order.reservationStatus === "RESERVED") throw new AppError("Already reserved", 409);

  const reserveLines = order.lines
    .map((l) => ({
      productId: l.productId,
      quantity: Number(l.quantity) - Number(l.quantityDelivered),
    }))
    .filter((l) => l.quantity > 0);
  if (!reserveLines.length) throw new AppError("Nothing left to reserve", 400);

  const reservation = await invDocs.createReservation(
    tid,
    {
      salesOrderId: order.id,
      customerId: order.customerId,
      lines: reserveLines,
    },
    userId
  );

  await prisma.$transaction(
    order.lines.map((l) =>
      prisma.salesOrderLine.update({
        where: { id: l.id },
        data: {
          quantityReserved: new Prisma.Decimal(
            (Number(l.quantity) - Number(l.quantityDelivered)).toFixed(4)
          ),
        },
      })
    )
  );

  return prisma.salesOrder.update({
    where: { id },
    data: {
      status: SalesDocStatus.RESERVED,
      reservationStatus: "RESERVED",
      reservationId: reservation.id,
    },
    include: { lines: true, customer: true },
  });
}

export async function deliverSalesOrder(
  tenantId: TenantId,
  id: string,
  data: { lines?: Array<{ salesOrderLineId: string; quantity: number }> },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const order = await getSalesOrder(tid, id);
  if (
    order.status !== SalesDocStatus.RESERVED &&
    order.status !== SalesDocStatus.CONFIRMED &&
    order.status !== SalesDocStatus.PARTIALLY_DELIVERED
  ) {
    throw new AppError("Order not ready for delivery", 400);
  }

  const deliverLines =
    data.lines?.length
      ? data.lines
      : order.lines.map((l) => ({
          salesOrderLineId: l.id,
          quantity: Number(l.quantity) - Number(l.quantityDelivered),
        }));

  const issueLines = [];
  for (const d of deliverLines) {
    const line = order.lines.find((l) => l.id === d.salesOrderLineId);
    if (!line) throw new AppError("Order line not found", 400);
    const remaining = Number(line.quantity) - Number(line.quantityDelivered);
    if (d.quantity <= 0 || d.quantity > remaining + 0.0001) {
      throw new AppError(`Invalid deliver qty for line ${line.id} (remaining ${remaining})`, 400);
    }
    issueLines.push({ productId: line.productId, quantity: d.quantity });
  }

  const issue = await invDocs.createStockIssue(
    tid,
    {
      salesOrderId: order.id,
      customerId: order.customerId,
      reservationId: order.reservationId,
      reason: `Delivery for ${order.code}`,
      lines: issueLines,
    },
    userId
  );
  await invDocs.postStockIssue(tid, issue.id, userId);

  for (const d of deliverLines) {
    const line = order.lines.find((l) => l.id === d.salesOrderLineId)!;
    await prisma.salesOrderLine.update({
      where: { id: line.id },
      data: {
        quantityDelivered: new Prisma.Decimal(
          (Number(line.quantityDelivered) + d.quantity).toFixed(4)
        ),
      },
    });
  }

  const refreshed = await getSalesOrder(tid, id);
  const allDelivered = refreshed.lines.every(
    (l) => Number(l.quantityDelivered) >= Number(l.quantity) - 0.0001
  );
  const anyDelivered = refreshed.lines.some((l) => Number(l.quantityDelivered) > 0);

  return prisma.salesOrder.update({
    where: { id },
    data: {
      deliveryStatus: allDelivered ? "DELIVERED" : anyDelivered ? "PARTIAL" : "PENDING",
      status: allDelivered
        ? SalesDocStatus.DELIVERED
        : SalesDocStatus.PARTIALLY_DELIVERED,
    },
    include: { lines: true, customer: true },
  });
}

// ---------- Invoices ----------

export async function createSalesInvoice(
  tenantId: TenantId,
  data: {
    customerId: string;
    salesOrderId?: string | null;
    invoiceDate?: string;
    dueDate?: string | null;
    notes?: string | null;
    lines?: LineIn[];
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  await assertCustomer(tid, data.customerId);

  let lines: LineIn[] = data.lines || [];
  if (data.salesOrderId) {
    const order = await getSalesOrder(tid, data.salesOrderId);
    if (order.customerId !== data.customerId) throw new AppError("Customer mismatch", 400);
    if (!lines.length) {
      lines = order.lines.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity) - Number(l.quantityInvoiced),
        unitPrice: Number(l.unitPrice),
        allowManualPrice: true,
        discountPercent: Number(l.discountPercent),
        taxPercent: Number(l.taxPercent),
      }));
    }
  }
  if (!lines.length) throw new AppError("At least one line required", 400);

  const { computed, totals } = await buildPricedLines(tid, data.customerId, null, lines);
  const customer = await assertCustomer(tid, data.customerId);
  const due =
    data.dueDate
      ? new Date(data.dueDate)
      : new Date(Date.now() + (customer.paymentTermsDays || 0) * 86400000);

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "INV", "INV");
    const inv = await tx.salesInvoice.create({
      data: {
        organizationId: tid,
        code,
        customerId: data.customerId,
        salesOrderId: data.salesOrderId,
        invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : new Date(),
        dueDate: due,
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
          })),
        },
      },
      include: { lines: { include: { product: true } }, customer: true },
    });

    if (data.salesOrderId) {
      const order = await tx.salesOrder.findUnique({
        where: { id: data.salesOrderId },
        include: { lines: true },
      });
      if (order) {
        for (const cl of computed) {
          const ol = order.lines.find((x) => x.productId === cl.productId);
          if (ol) {
            await tx.salesOrderLine.update({
              where: { id: ol.id },
              data: {
                quantityInvoiced: new Prisma.Decimal(
                  (Number(ol.quantityInvoiced) + Number(cl.quantity)).toFixed(4)
                ),
              },
            });
          }
        }
      }
    }

    return inv;
  });
}

export async function getSalesInvoice(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.salesInvoice.findUnique({
    where: { id },
    include: {
      lines: { include: { product: true } },
      customer: true,
      salesOrder: true,
      receiptAllocations: true,
    },
  });
  if (!row) throw new AppError("Sales invoice not found", 404);
  assertSameTenant(row.organizationId, tid);
  return withInvoiceDisplay(row);
}

function withInvoiceDisplay<T extends {
  status: SalesDocStatus;
  paymentStatus: SalesPaymentStatus;
  dueDate: Date | null;
  totalAmount: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
}>(row: T) {
  const remaining = Number(row.totalAmount) - Number(row.amountPaid);
  let paymentStatus = row.paymentStatus;
  if (
    row.status === SalesDocStatus.POSTED &&
    paymentStatus !== SalesPaymentStatus.PAID &&
    paymentStatus !== SalesPaymentStatus.VOID &&
    row.dueDate &&
    row.dueDate < new Date()
  ) {
    paymentStatus = SalesPaymentStatus.OVERDUE;
  }
  return {
    ...row,
    paymentStatus,
    remainingAmount: Number(remaining.toFixed(4)),
    displayStatus:
      row.status === SalesDocStatus.CANCELLED
        ? "CANCELLED"
        : row.status === SalesDocStatus.DRAFT
          ? "DRAFT"
          : paymentStatus === SalesPaymentStatus.PAID
            ? "PAID"
            : paymentStatus === SalesPaymentStatus.PARTIAL
              ? "PARTIALLY_PAID"
              : paymentStatus === SalesPaymentStatus.OVERDUE
                ? "OVERDUE"
                : "POSTED",
  };
}

export async function listSalesInvoices(tenantId: TenantId, status?: string) {
  const items = await prisma.salesInvoice.findMany({
    where: {
      organizationId: requireTenantId(tenantId),
      ...(status ? { status: status as SalesDocStatus } : {}),
    },
    include: { customer: true, lines: true },
    orderBy: { createdAt: "desc" },
  });
  return items.map(withInvoiceDisplay);
}

export async function postSalesInvoice(tenantId: TenantId, id: string, userId?: string) {
  const tid = requireTenantId(tenantId);
  return prisma.$transaction(async (tx) => {
    const inv = await tx.salesInvoice.findUnique({ where: { id } });
    if (!inv) throw new AppError("Sales invoice not found", 404);
    assertSameTenant(inv.organizationId, tid);
    if (inv.status === SalesDocStatus.POSTED) throw new AppError("Invoice already posted", 409);
    if (inv.status === SalesDocStatus.CANCELLED) throw new AppError("Invoice is cancelled", 400);

    await tx.customerLedgerEntry.create({
      data: {
        organizationId: tid,
        customerId: inv.customerId,
        type: CustomerLedgerType.SALE,
        amount: inv.totalAmount,
        direction: "DEBIT",
        reference: inv.code,
        referenceType: "SALES_INVOICE",
        referenceId: inv.id,
        createdByUserId: userId,
      },
    });

    const updated = await tx.salesInvoice.update({
      where: { id },
      data: {
        status: SalesDocStatus.POSTED,
        postedAt: new Date(),
        postedByUserId: userId,
      },
      include: { lines: { include: { product: true } }, customer: true },
    });

    if (inv.salesOrderId) {
      await tx.salesOrder.update({
        where: { id: inv.salesOrderId },
        data: { status: SalesDocStatus.INVOICED },
      });
    }

    await generateForSourceIfAccountingEnabled(tx, {
      organizationId: tid,
      eventType: AccountingEventType.SALES_INVOICE,
      sourceType: "SALES_INVOICE",
      sourceId: inv.id,
      sourceCode: inv.code,
      entryDate: inv.invoiceDate ?? new Date(),
      description: `Sales invoice ${inv.code}`,
      amount: Number(inv.totalAmount),
      userId,
    });

    return withInvoiceDisplay(updated);
  });
}

export async function cancelSalesInvoice(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const inv = await getSalesInvoice(tid, id);
  if (inv.status === SalesDocStatus.POSTED && Number(inv.amountPaid) > 0) {
    throw new AppError("Cannot cancel invoice with payments", 400);
  }
  if (inv.status === SalesDocStatus.POSTED) {
    throw new AppError("Posted invoices must be credited via sales return; cancel only drafts", 400);
  }
  return prisma.salesInvoice.update({
    where: { id },
    data: { status: SalesDocStatus.CANCELLED, cancelledAt: new Date() },
  });
}

/** Print-ready bilingual-capable invoice payload for frontend rendering. */
export async function getInvoicePrintPayload(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const inv = await getSalesInvoice(tid, id);
  const [org, config] = await Promise.all([
    prisma.organization.findUnique({ where: { id: tid } }),
    prisma.tenantSystemConfig.findUnique({ where: { organizationId: tid } }),
  ]);

  return {
    documentType: "SALES_INVOICE",
    localeHints: ["en", "ar"],
    company: {
      name: org?.name,
      code: org?.code,
      taxNumber: org?.taxNumber ?? config?.taxRegistrationNumber,
      commercialRegister: org?.commercialRegister,
      addressLine1: org?.addressLine1,
      addressLine2: org?.addressLine2,
      city: org?.city,
      country: org?.country,
      phone: org?.phonePrimary,
      email: org?.emailContact,
      logoUrl: org?.logoUrl,
      currency: config?.currency ?? org?.baseCurrency ?? "EGP",
    },
    invoice: {
      code: inv.code,
      status: inv.displayStatus,
      paymentStatus: inv.paymentStatus,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      notes: inv.notes,
      subtotal: Number(inv.subtotal),
      discountAmount: Number(inv.discountAmount),
      taxAmount: Number(inv.taxAmount),
      totalAmount: Number(inv.totalAmount),
      amountPaid: Number(inv.amountPaid),
      remainingAmount: inv.remainingAmount,
    },
    customer: {
      code: inv.customer.code,
      name: inv.customer.name,
      nameAr: inv.customer.nameAr,
      taxNumber: inv.customer.taxNumber,
      addressLine1: inv.customer.addressLine1,
      city: inv.customer.city,
      country: inv.customer.country,
      phone: inv.customer.phone,
      email: inv.customer.email,
    },
    lines: inv.lines.map((l, idx) => ({
      lineNo: idx + 1,
      sku: l.product.sku,
      name: l.product.name,
      nameAr: l.product.nameAr,
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discountAmount: Number(l.discountAmount),
      taxPercent: Number(l.taxPercent),
      taxAmount: Number(l.taxAmount),
      lineTotal: Number(l.lineTotal),
    })),
    printedAt: new Date().toISOString(),
  };
}

// ---------- Receipts ----------

export async function createCustomerReceipt(
  tenantId: TenantId,
  data: {
    customerId: string;
    amount: number;
    paymentMethod?: string | null;
    reference?: string | null;
    receiptDate?: string;
    notes?: string | null;
    allocations: Array<{ salesInvoiceId: string; amount: number }>;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  await assertCustomer(tid, data.customerId);
  if (data.amount <= 0) throw new AppError("Amount must be positive", 400);
  const allocSum = data.allocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(allocSum - data.amount) > 0.01) {
    throw new AppError("Allocation total must equal receipt amount", 400);
  }

  return prisma.$transaction(async (tx) => {
    for (const a of data.allocations) {
      const inv = await tx.salesInvoice.findUnique({ where: { id: a.salesInvoiceId } });
      if (!inv || inv.organizationId !== tid) throw new AppError("Invoice not found", 404);
      if (inv.customerId !== data.customerId) throw new AppError("Invoice customer mismatch", 400);
      if (inv.status !== SalesDocStatus.POSTED) throw new AppError("Invoice must be posted", 400);
      const due = Number(inv.totalAmount) - Number(inv.amountPaid);
      if (a.amount > due + 0.01) throw new AppError(`Allocation exceeds balance (${due})`, 400);
    }

    const code = await nextDocumentNumber(tx, tid, "RCPT", "RCPT");
    const receipt = await tx.customerReceipt.create({
      data: {
        organizationId: tid,
        code,
        customerId: data.customerId,
        amount: new Prisma.Decimal(data.amount),
        paymentMethod: data.paymentMethod,
        reference: data.reference,
        receiptDate: data.receiptDate ? new Date(data.receiptDate) : new Date(),
        notes: data.notes,
        status: "POSTED",
        postedAt: new Date(),
        postedByUserId: userId,
        createdByUserId: userId,
        allocations: {
          create: data.allocations.map((a) => ({
            organizationId: tid,
            salesInvoiceId: a.salesInvoiceId,
            amount: new Prisma.Decimal(a.amount),
          })),
        },
      },
      include: { allocations: true },
    });

    await tx.customerLedgerEntry.create({
      data: {
        organizationId: tid,
        customerId: data.customerId,
        type: CustomerLedgerType.PAYMENT,
        amount: new Prisma.Decimal(data.amount),
        direction: "CREDIT",
        reference: code,
        referenceType: "CUSTOMER_RECEIPT",
        referenceId: receipt.id,
        createdByUserId: userId,
      },
    });

    for (const a of data.allocations) {
      const inv = await tx.salesInvoice.findUnique({ where: { id: a.salesInvoiceId } });
      if (!inv) continue;
      const newPaid = Number(inv.amountPaid) + a.amount;
      const total = Number(inv.totalAmount);
      const paymentStatus =
        newPaid >= total - 0.01
          ? SalesPaymentStatus.PAID
          : newPaid > 0
            ? SalesPaymentStatus.PARTIAL
            : SalesPaymentStatus.UNPAID;
      await tx.salesInvoice.update({
        where: { id: inv.id },
        data: {
          amountPaid: new Prisma.Decimal(newPaid.toFixed(4)),
          paymentStatus,
        },
      });
    }

    return receipt;
  });
}

export async function listCustomerReceipts(tenantId: TenantId) {
  return prisma.customerReceipt.findMany({
    where: { organizationId: requireTenantId(tenantId) },
    include: { allocations: true, customer: true },
    orderBy: { createdAt: "desc" },
  });
}

// ---------- Sales Returns ----------

export async function createSalesReturn(
  tenantId: TenantId,
  data: {
    customerId: string;
    salesOrderId?: string | null;
    salesInvoiceId?: string | null;
    reason?: string | null;
    notes?: string | null;
    lines: Array<{
      productId: string;
      salesOrderLineId?: string | null;
      quantity: number;
      unitPrice: number;
      taxPercent?: number;
      notes?: string | null;
    }>;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  await assertCustomer(tid, data.customerId);
  if (!data.lines?.length) throw new AppError("At least one line required", 400);

  const computed = data.lines.map((l) => {
    const totals = computeLineTotals({
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxPercent: l.taxPercent ?? 0,
    });
    return { ...l, ...totals };
  });
  const totals = sumDocTotals(computed);

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "SRTN", "SRTN");
    return tx.salesReturn.create({
      data: {
        organizationId: tid,
        code,
        customerId: data.customerId,
        salesOrderId: data.salesOrderId,
        salesInvoiceId: data.salesInvoiceId,
        reason: data.reason,
        notes: data.notes,
        createdByUserId: userId,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        creditAmount: totals.totalAmount,
        lines: {
          create: computed.map((l) => ({
            organizationId: tid,
            productId: l.productId,
            salesOrderLineId: l.salesOrderLineId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxPercent: l.taxPercent,
            taxAmount: l.taxAmount,
            lineTotal: l.lineTotal,
            notes: l.notes,
          })),
        },
      },
      include: { lines: true },
    });
  });
}

export async function postSalesReturn(
  tenantId: TenantId,
  id: string,
  userId?: string,
  opts?: WorkflowOpts
) {
  const tid = requireTenantId(tenantId);
  const ret = await prisma.salesReturn.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!ret) throw new AppError("Sales return not found", 404);
  assertSameTenant(ret.organizationId, tid);
  if (ret.status === SalesDocStatus.POSTED) throw new AppError("Already posted", 409);

  if (!opts?.fromWorkflow) {
    const approval = await startApprovalIfConfigured(tid, {
      documentType: WorkflowDocumentType.SALES_RETURN,
      documentId: id,
      amount: Number(ret.totalAmount),
      submittedByUserId: userId,
    });
    if (approval) {
      return { ...ret, pendingApproval: true, approvalId: approval.id };
    }
  }

  const stockReturn = await invDocs.createStockReturn(
    tid,
    {
      customerId: ret.customerId,
      salesReturnId: ret.id,
      reason: ret.reason,
      lines: ret.lines.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
        unitCost: Number(l.unitPrice),
      })),
    },
    userId
  );
  await invDocs.postStockReturn(tid, stockReturn.id, userId);

  return prisma.$transaction(async (tx) => {
    await tx.customerLedgerEntry.create({
      data: {
        organizationId: tid,
        customerId: ret.customerId,
        type: CustomerLedgerType.CREDIT_NOTE,
        amount: ret.totalAmount,
        direction: "CREDIT",
        reference: ret.code,
        referenceType: "SALES_RETURN",
        referenceId: ret.id,
        note: ret.reason,
        createdByUserId: userId,
      },
    });

    const updated = await tx.salesReturn.update({
      where: { id },
      data: {
        status: SalesDocStatus.POSTED,
        stockReturnId: stockReturn.id,
        postedAt: new Date(),
        postedByUserId: userId,
      },
      include: { lines: true },
    });

    await generateForSourceIfAccountingEnabled(tx, {
      organizationId: tid,
      eventType: AccountingEventType.SALES_RETURN,
      sourceType: "SALES_RETURN",
      sourceId: ret.id,
      sourceCode: ret.code,
      entryDate: new Date(),
      description: `Sales return ${ret.code}`,
      amount: Number(ret.totalAmount),
      userId,
    });

    return updated;
  });
}

export async function listSalesReturns(tenantId: TenantId) {
  return prisma.salesReturn.findMany({
    where: { organizationId: requireTenantId(tenantId) },
    include: { lines: true, customer: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getSalesReturn(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.salesReturn.findUnique({
    where: { id },
    include: { lines: { include: { product: true } }, customer: true, salesInvoice: true },
  });
  if (!row) throw new AppError("Sales return not found", 404);
  assertSameTenant(row.organizationId, tid);
  return row;
}

export async function cancelSalesReturnWorkflow(
  tenantId: TenantId,
  id: string,
  reason?: string
) {
  const tid = requireTenantId(tenantId);
  await getSalesReturn(tid, id);
  return prisma.salesReturn.update({
    where: { id },
    data: {
      status: SalesDocStatus.CANCELLED,
      notes: reason ? `Workflow rejected: ${reason}` : "Workflow rejected",
    },
    include: { lines: true },
  });
}
