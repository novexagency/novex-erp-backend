import { CustomerLedgerType, Prisma, PosSaleStatus, PosSaleType } from "@prisma/client";
import { nextDocumentNumber } from "../../lib/documentNumber.js";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { computeLineTotals, sumDocTotals } from "../procurement/lineMath.js";
import * as invDocs from "../inventory/documents.service.js";
import { resolveUnitPrice } from "../sales/pricing.service.js";
import { lookupByBarcode } from "../inventory/balances.service.js";
import { getOpenSession } from "./sessions.service.js";

const MAX_UNAUTHORIZED_DISCOUNT_PERCENT = 5;

type CartLine = {
  productId?: string;
  barcode?: string;
  quantity: number;
  unitPrice?: number;
  allowManualPrice?: boolean;
  discountPercent?: number;
  discountAmount?: number;
  taxPercent?: number;
};

type PaymentIn = {
  methodCode: string;
  methodName?: string | null;
  amount: number;
  reference?: string | null;
};

async function resolveProduct(
  tid: string,
  line: CartLine
): Promise<{ productId: string; barcode: string | null }> {
  if (line.barcode) {
    const found = await lookupByBarcode(tid, line.barcode);
    if (!found) throw new AppError(`Barcode not found: ${line.barcode}`, 404);
    return { productId: found.product.id, barcode: line.barcode };
  }
  if (!line.productId) throw new AppError("productId or barcode required", 400);
  const p = await prisma.product.findFirst({
    where: { id: line.productId, organizationId: tid },
  });
  if (!p) throw new AppError("Product not found", 404);
  return { productId: p.id, barcode: null };
}

export async function searchProducts(tenantId: TenantId, q: string) {
  const tid = requireTenantId(tenantId);
  if (!q || q.trim().length < 1) return [];
  const term = q.trim();
  return prisma.product.findMany({
    where: {
      organizationId: tid,
      status: "ACTIVE",
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { nameAr: { contains: term, mode: "insensitive" } },
        { sku: { contains: term, mode: "insensitive" } },
        { barcodes: { some: { barcode: { contains: term, mode: "insensitive" } } } },
      ],
    },
    take: 20,
    include: {
      barcodes: { where: { isPrimary: true }, take: 1 },
      stockBalances: { take: 1 },
    },
    orderBy: { name: "asc" },
  });
}

export async function checkout(
  tenantId: TenantId,
  data: {
    clientRequestId?: string | null;
    customerId?: string | null;
    allowCredit?: boolean;
    discountAuthorized?: boolean;
    notes?: string | null;
    lines: CartLine[];
    payments: PaymentIn[];
  },
  cashierUserId: string
) {
  const tid = requireTenantId(tenantId);
  if (!cashierUserId) throw new AppError("Cashier user required", 400);
  if (!data.lines?.length) throw new AppError("Cart is empty", 400);
  if (!data.payments?.length) throw new AppError("At least one payment required", 400);

  const session = await getOpenSession(tid, cashierUserId);
  if (!session) throw new AppError("No open cashier session — open a shift first", 400);

  if (data.clientRequestId) {
    const dup = await prisma.posSale.findUnique({
      where: {
        organizationId_clientRequestId: {
          organizationId: tid,
          clientRequestId: data.clientRequestId,
        },
      },
      include: { lines: true, payments: true },
    });
    if (dup) return { sale: dup, duplicate: true as const };
  }

  const creditPay = data.payments
    .filter((p) => p.methodCode.toUpperCase() === "CREDIT")
    .reduce((s, p) => s + p.amount, 0);
  if (creditPay > 0) {
    if (!data.allowCredit) throw new AppError("Credit sales not permitted for this checkout", 403);
    if (!data.customerId) throw new AppError("Customer required for credit sales", 400);
  }

  const built: Array<{
    productId: string;
    barcode: string | null;
    listPrice: Prisma.Decimal | null;
    manualPrice: boolean;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    discountPercent: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    taxPercent: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    lineSubtotal: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
  }> = [];
  for (const line of data.lines) {
    if (line.quantity <= 0) throw new AppError("Quantity must be positive", 400);
    const { productId, barcode } = await resolveProduct(tid, line);

    const discPct = Number(line.discountPercent ?? 0);
    if (discPct > MAX_UNAUTHORIZED_DISCOUNT_PERCENT && !data.discountAuthorized) {
      throw new AppError(
        `Discount ${discPct}% exceeds ${MAX_UNAUTHORIZED_DISCOUNT_PERCENT}% without authorization`,
        403
      );
    }

    let unitPrice: number;
    let listPrice: number | null = null;
    let manualPrice = false;
    if (data.customerId) {
      const priced = await resolveUnitPrice(tid, {
        customerId: data.customerId,
        productId,
        quantity: line.quantity,
        manualUnitPrice: line.allowManualPrice ? line.unitPrice ?? null : null,
        allowManualPrice: line.allowManualPrice,
      });
      unitPrice = line.allowManualPrice && line.unitPrice != null ? line.unitPrice : priced.unitPrice;
      listPrice = priced.listPrice;
      manualPrice = priced.manualPrice;
    } else {
      const product = await prisma.product.findUnique({ where: { id: productId } });
      unitPrice =
        line.allowManualPrice && line.unitPrice != null
          ? line.unitPrice
          : Number(product?.sellingPrice ?? 0);
      listPrice = Number(product?.sellingPrice ?? 0);
      manualPrice = Boolean(line.allowManualPrice && line.unitPrice != null);
    }

    const totals = computeLineTotals({
      quantity: line.quantity,
      unitPrice,
      discountPercent: discPct,
      discountAmount: line.discountAmount,
      taxPercent: line.taxPercent ?? 0,
    });
    built.push({
      productId,
      barcode,
      listPrice: listPrice != null ? new Prisma.Decimal(listPrice) : null,
      manualPrice,
      ...totals,
    });
  }

  const docTotals = sumDocTotals(built);
  const totalAmount = Number(docTotals.totalAmount);
  const paySum = data.payments.reduce((s, p) => s + p.amount, 0);
  if (paySum + 0.01 < totalAmount) {
    throw new AppError(`Payments (${paySum}) less than total (${totalAmount})`, 400);
  }

  const amountCredit = creditPay;
  const amountPaid = Math.min(paySum - amountCredit, totalAmount - amountCredit);
  const cashPaid = data.payments
    .filter((p) => p.methodCode.toUpperCase() === "CASH")
    .reduce((s, p) => s + p.amount, 0);
  const cardPaid = data.payments
    .filter((p) => ["CARD", "TRANSFER"].includes(p.methodCode.toUpperCase()))
    .reduce((s, p) => s + p.amount, 0);
  const changeGiven = Math.max(0, paySum - totalAmount);

  // Create sale + stock issue in sequence (stock uses its own transactions)
  const sale = await prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "POS", "POS");
    const created = await tx.posSale.create({
      data: {
        organizationId: tid,
        code,
        sessionId: session.id,
        customerId: data.customerId,
        clientRequestId: data.clientRequestId || null,
        allowCredit: Boolean(data.allowCredit),
        discountAuthorized: Boolean(data.discountAuthorized),
        notes: data.notes,
        cashierUserId,
        ...docTotals,
        amountPaid: new Prisma.Decimal(amountPaid.toFixed(4)),
        amountCredit: new Prisma.Decimal(amountCredit.toFixed(4)),
        changeGiven: new Prisma.Decimal(changeGiven.toFixed(4)),
        lines: {
          create: built.map((l) => ({
            organizationId: tid,
            productId: l.productId,
            barcode: l.barcode,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            listPrice: l.listPrice,
            discountPercent: l.discountPercent,
            discountAmount: l.discountAmount,
            taxPercent: l.taxPercent,
            taxAmount: l.taxAmount,
            lineSubtotal: l.lineSubtotal,
            lineTotal: l.lineTotal,
          })),
        },
        payments: {
          create: data.payments.map((p) => ({
            organizationId: tid,
            methodCode: p.methodCode.toUpperCase(),
            methodName: p.methodName,
            amount: new Prisma.Decimal(p.amount),
            reference: p.reference,
          })),
        },
        events: {
          create: [
            {
              organizationId: tid,
              action: "CREATED",
              userId: cashierUserId,
              note: data.discountAuthorized ? "Discount authorized" : null,
            },
            ...(data.discountAuthorized
              ? [
                  {
                    organizationId: tid,
                    action: "DISCOUNT_AUTH",
                    userId: cashierUserId,
                  },
                ]
              : []),
          ],
        },
      },
      include: { lines: { include: { product: true } }, payments: true, customer: true },
    });

    await tx.cashierSession.update({
      where: { id: session.id },
      data: {
        totalSales: { increment: totalAmount },
        totalCashSales: { increment: Math.min(cashPaid, totalAmount) },
        totalCardSales: { increment: cardPaid },
        totalCreditSales: { increment: amountCredit },
      },
    });

    if (amountCredit > 0 && data.customerId) {
      await tx.customerLedgerEntry.create({
        data: {
          organizationId: tid,
          customerId: data.customerId,
          type: CustomerLedgerType.SALE,
          amount: new Prisma.Decimal(amountCredit),
          direction: "DEBIT",
          reference: code,
          referenceType: "POS_SALE",
          referenceId: created.id,
          createdByUserId: cashierUserId,
        },
      });
    }

    return created;
  });

  const issue = await invDocs.createStockIssue(
    tid,
    {
      customerId: data.customerId,
      reason: `POS ${sale.code}`,
      lines: built.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
      })),
    },
    cashierUserId
  );
  await invDocs.postStockIssue(tid, issue.id, cashierUserId);

  const updated = await prisma.posSale.update({
    where: { id: sale.id },
    data: { stockIssueId: issue.id },
    include: { lines: { include: { product: true } }, payments: true, customer: true },
  });

  return { sale: updated, duplicate: false as const };
}

export async function cancelSale(
  tenantId: TenantId,
  saleId: string,
  reason: string,
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const sale = await prisma.posSale.findUnique({
    where: { id: saleId },
    include: { lines: true, payments: true },
  });
  if (!sale) throw new AppError("POS sale not found", 404);
  assertSameTenant(sale.organizationId, tid);
  if (sale.status !== PosSaleStatus.COMPLETED) throw new AppError("Sale cannot be cancelled", 400);
  if (sale.type !== PosSaleType.SALE) throw new AppError("Only sales can be cancelled", 400);

  // Restock via stock return
  const stockReturn = await invDocs.createStockReturn(
    tid,
    {
      customerId: sale.customerId,
      reason: reason || `Cancel ${sale.code}`,
      lines: sale.lines.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
        unitCost: Number(l.unitPrice),
      })),
    },
    userId
  );
  await invDocs.postStockReturn(tid, stockReturn.id, userId);

  return prisma.$transaction(async (tx) => {
    const cashPart = sale.payments
      .filter((p) => p.methodCode === "CASH")
      .reduce((s, p) => s + Number(p.amount), 0);
    const cardPart = sale.payments
      .filter((p) => ["CARD", "TRANSFER"].includes(p.methodCode))
      .reduce((s, p) => s + Number(p.amount), 0);

    // Reverse session sales counters (do not also bump totalRefunds — that is for refundSale)
    await tx.cashierSession.update({
      where: { id: sale.sessionId },
      data: {
        totalSales: { decrement: Number(sale.totalAmount) },
        totalCashSales: { decrement: Math.min(cashPart, Number(sale.totalAmount)) },
        totalCardSales: { decrement: cardPart },
        totalCreditSales: { decrement: Number(sale.amountCredit) },
      },
    });

    if (Number(sale.amountCredit) > 0 && sale.customerId) {
      await tx.customerLedgerEntry.create({
        data: {
          organizationId: tid,
          customerId: sale.customerId,
          type: CustomerLedgerType.CREDIT_NOTE,
          amount: sale.amountCredit,
          direction: "CREDIT",
          reference: sale.code,
          referenceType: "POS_CANCEL",
          referenceId: sale.id,
          note: reason,
          createdByUserId: userId,
        },
      });
    }

    await tx.posSaleEvent.create({
      data: {
        organizationId: tid,
        posSaleId: sale.id,
        action: "CANCELLED",
        note: reason,
        userId,
      },
    });

    return tx.posSale.update({
      where: { id: sale.id },
      data: {
        status: PosSaleStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledByUserId: userId,
        cancelReason: reason,
        stockReturnId: stockReturn.id,
      },
      include: { lines: true, payments: true, events: true },
    });
  });
}

export async function refundSale(
  tenantId: TenantId,
  saleId: string,
  data: {
    lines: Array<{ productId: string; quantity: number }>;
    reason?: string | null;
    refundMethodCode?: string;
  },
  cashierUserId: string
) {
  const tid = requireTenantId(tenantId);
  const original = await prisma.posSale.findUnique({
    where: { id: saleId },
    include: { lines: true },
  });
  if (!original) throw new AppError("POS sale not found", 404);
  assertSameTenant(original.organizationId, tid);
  if (original.status !== PosSaleStatus.COMPLETED && original.status !== PosSaleStatus.PARTIALLY_REFUNDED) {
    throw new AppError("Sale cannot be refunded", 400);
  }

  const session = await getOpenSession(tid, cashierUserId);
  if (!session) throw new AppError("No open cashier session", 400);

  const built: Array<{
    productId: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    discountPercent: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    taxPercent: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    lineSubtotal: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
  }> = [];
  for (const l of data.lines) {
    const src = original.lines.find((x) => x.productId === l.productId);
    if (!src) throw new AppError(`Product ${l.productId} not on original sale`, 400);
    if (l.quantity <= 0 || l.quantity > Number(src.quantity)) {
      throw new AppError("Invalid refund quantity", 400);
    }
    const totals = computeLineTotals({
      quantity: l.quantity,
      unitPrice: Number(src.unitPrice),
      discountPercent: Number(src.discountPercent),
      taxPercent: Number(src.taxPercent),
    });
    built.push({ productId: l.productId, ...totals });
  }
  const docTotals = sumDocTotals(built);
  const refundTotal = Number(docTotals.totalAmount);
  const method = (data.refundMethodCode || "CASH").toUpperCase();

  const stockReturn = await invDocs.createStockReturn(
    tid,
    {
      customerId: original.customerId,
      salesReturnId: null,
      reason: data.reason || `Refund ${original.code}`,
      lines: built.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
        unitCost: Number(l.unitPrice),
      })),
    },
    cashierUserId
  );
  await invDocs.postStockReturn(tid, stockReturn.id, cashierUserId);

  const refund = await prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "POSR", "POSR");
    const created = await tx.posSale.create({
      data: {
        organizationId: tid,
        code,
        sessionId: session.id,
        customerId: original.customerId,
        type: PosSaleType.REFUND,
        status: PosSaleStatus.COMPLETED,
        originalSaleId: original.id,
        stockReturnId: stockReturn.id,
        cashierUserId,
        notes: data.reason,
        ...docTotals,
        amountPaid: docTotals.totalAmount,
        lines: {
          create: built.map((l) => ({
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
        payments: {
          create: [
            {
              organizationId: tid,
              methodCode: method,
              amount: docTotals.totalAmount,
              reference: original.code,
            },
          ],
        },
        events: {
          create: {
            organizationId: tid,
            action: "REFUND",
            note: data.reason,
            userId: cashierUserId,
          },
        },
      },
      include: { lines: true, payments: true },
    });

    await tx.cashierSession.update({
      where: { id: session.id },
      data: {
        totalRefunds: { increment: refundTotal },
        ...(method === "CASH" ? {} : {}),
      },
    });

    await tx.posSale.update({
      where: { id: original.id },
      data: { status: PosSaleStatus.PARTIALLY_REFUNDED },
    });

    await tx.posSaleEvent.create({
      data: {
        organizationId: tid,
        posSaleId: original.id,
        action: "REFUND",
        note: `Refund ${code}`,
        userId: cashierUserId,
      },
    });

    return created;
  });

  return refund;
}

export async function getSale(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.posSale.findUnique({
    where: { id },
    include: {
      lines: { include: { product: true } },
      payments: true,
      events: { orderBy: { createdAt: "asc" } },
      customer: true,
      session: true,
    },
  });
  if (!row) throw new AppError("POS sale not found", 404);
  assertSameTenant(row.organizationId, tid);
  return row;
}

export async function listSales(tenantId: TenantId, sessionId?: string) {
  return prisma.posSale.findMany({
    where: {
      organizationId: requireTenantId(tenantId),
      ...(sessionId ? { sessionId } : {}),
    },
    include: { payments: true, customer: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function getReceiptPrint(tenantId: TenantId, saleId: string) {
  const tid = requireTenantId(tenantId);
  const sale = await getSale(tid, saleId);
  const [org, config, receiptCfg] = await Promise.all([
    prisma.organization.findUnique({ where: { id: tid } }),
    prisma.tenantSystemConfig.findUnique({ where: { organizationId: tid } }),
    prisma.posReceiptConfig.findFirst({
      where: { organizationId: tid, isDefault: true },
    }),
  ]);

  await prisma.posSaleEvent.create({
    data: {
      organizationId: tid,
      posSaleId: sale.id,
      action: "PRINT",
    },
  });

  return {
    documentType: "POS_RECEIPT",
    layout: {
      paperWidthMm: receiptCfg?.paperWidthMm ?? 80,
      showLogo: receiptCfg?.showLogo ?? true,
      showTaxNumber: receiptCfg?.showTaxNumber ?? true,
      showAddress: receiptCfg?.showAddress ?? true,
      headerText: receiptCfg?.headerText ?? null,
      headerTextAr: receiptCfg?.headerTextAr ?? null,
      footerText: receiptCfg?.footerText ?? "Thank you",
      footerTextAr: receiptCfg?.footerTextAr ?? "شكراً لتعاملكم معنا",
    },
    company: {
      name: org?.name,
      taxNumber: org?.taxNumber ?? config?.taxRegistrationNumber,
      addressLine1: org?.addressLine1,
      city: org?.city,
      phone: org?.phonePrimary,
      logoUrl: org?.logoUrl,
      currency: config?.currency ?? "EGP",
    },
    sale: {
      code: sale.code,
      type: sale.type,
      status: sale.status,
      createdAt: sale.createdAt,
      cashierUserId: sale.cashierUserId,
      sessionCode: sale.session.code,
      subtotal: Number(sale.subtotal),
      discountAmount: Number(sale.discountAmount),
      taxAmount: Number(sale.taxAmount),
      totalAmount: Number(sale.totalAmount),
      amountPaid: Number(sale.amountPaid),
      amountCredit: Number(sale.amountCredit),
      changeGiven: Number(sale.changeGiven),
    },
    customer: sale.customer
      ? { code: sale.customer.code, name: sale.customer.name, nameAr: sale.customer.nameAr }
      : null,
    lines: sale.lines.map((l, i) => ({
      lineNo: i + 1,
      sku: l.product.sku,
      name: l.product.name,
      nameAr: l.product.nameAr,
      barcode: l.barcode,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discountAmount: Number(l.discountAmount),
      taxAmount: Number(l.taxAmount),
      lineTotal: Number(l.lineTotal),
    })),
    payments: sale.payments.map((p) => ({
      methodCode: p.methodCode,
      methodName: p.methodName,
      amount: Number(p.amount),
      reference: p.reference,
    })),
    printedAt: new Date().toISOString(),
  };
}

export async function upsertReceiptConfig(
  tenantId: TenantId,
  data: {
    name?: string;
    showLogo?: boolean;
    showTaxNumber?: boolean;
    showAddress?: boolean;
    headerText?: string | null;
    headerTextAr?: string | null;
    footerText?: string | null;
    footerTextAr?: string | null;
    paperWidthMm?: number;
  }
) {
  const tid = requireTenantId(tenantId);
  const existing = await prisma.posReceiptConfig.findFirst({
    where: { organizationId: tid, isDefault: true },
  });
  if (existing) {
    return prisma.posReceiptConfig.update({ where: { id: existing.id }, data });
  }
  return prisma.posReceiptConfig.create({
    data: {
      organizationId: tid,
      name: data.name || "Default",
      isDefault: true,
      ...data,
    },
  });
}

export async function getReceiptConfig(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  let cfg = await prisma.posReceiptConfig.findFirst({
    where: { organizationId: tid, isDefault: true },
  });
  if (!cfg) {
    cfg = await prisma.posReceiptConfig.create({
      data: { organizationId: tid, name: "Default", isDefault: true },
    });
  }
  return cfg;
}
