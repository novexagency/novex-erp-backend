import { Prisma } from "@prisma/client";

export type LineInput = {
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  discountAmount?: number;
  taxPercent?: number;
};

export function computeLineTotals(input: LineInput) {
  const qty = Number(input.quantity);
  const unitPrice = Number(input.unitPrice);
  const gross = qty * unitPrice;
  const discountPercent = Number(input.discountPercent ?? 0);
  let discountAmount = Number(input.discountAmount ?? 0);
  if (discountPercent > 0 && !input.discountAmount) {
    discountAmount = (gross * discountPercent) / 100;
  }
  const lineSubtotal = Math.max(0, gross - discountAmount);
  const taxPercent = Number(input.taxPercent ?? 0);
  const taxAmount = (lineSubtotal * taxPercent) / 100;
  const lineTotal = lineSubtotal + taxAmount;
  return {
    quantity: new Prisma.Decimal(qty),
    unitPrice: new Prisma.Decimal(unitPrice),
    discountPercent: new Prisma.Decimal(discountPercent),
    discountAmount: new Prisma.Decimal(discountAmount.toFixed(4)),
    taxPercent: new Prisma.Decimal(taxPercent),
    taxAmount: new Prisma.Decimal(taxAmount.toFixed(4)),
    lineSubtotal: new Prisma.Decimal(lineSubtotal.toFixed(4)),
    lineTotal: new Prisma.Decimal(lineTotal.toFixed(4)),
  };
}

export function sumDocTotals(
  lines: Array<{ lineSubtotal: Prisma.Decimal; taxAmount: Prisma.Decimal; lineTotal: Prisma.Decimal; discountAmount: Prisma.Decimal }>
) {
  let subtotal = 0;
  let discountAmount = 0;
  let taxAmount = 0;
  let totalAmount = 0;
  for (const l of lines) {
    subtotal += Number(l.lineSubtotal);
    discountAmount += Number(l.discountAmount);
    taxAmount += Number(l.taxAmount);
    totalAmount += Number(l.lineTotal);
  }
  return {
    subtotal: new Prisma.Decimal(subtotal.toFixed(4)),
    discountAmount: new Prisma.Decimal(discountAmount.toFixed(4)),
    taxAmount: new Prisma.Decimal(taxAmount.toFixed(4)),
    totalAmount: new Prisma.Decimal(totalAmount.toFixed(4)),
  };
}
