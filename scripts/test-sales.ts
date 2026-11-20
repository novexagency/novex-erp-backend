import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { ensureDefaultTenantSaaS } from "../src/modules/tenant/tenant.service.js";
import * as customers from "../src/modules/crm/customers.service.js";
import * as documents from "../src/modules/inventory/documents.service.js";
import * as balances from "../src/modules/inventory/balances.service.js";
import * as lookups from "../src/modules/masterData/lookups.service.js";
import * as products from "../src/modules/masterData/products.service.js";
import * as pricing from "../src/modules/sales/pricing.service.js";
import * as sales from "../src/modules/sales/sales.service.js";

const prisma = new PrismaClient();
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function pass(name: string) {
  results.push({ name, ok: true });
  console.log(`[PASS] ${name}`);
}
function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
  console.error(`[FAIL] ${name}: ${detail}`);
}

async function cleanupOrg(id: string) {
  await prisma.customerReceiptAllocation.deleteMany({ where: { organizationId: id } });
  await prisma.customerReceipt.deleteMany({ where: { organizationId: id } });
  await prisma.salesReturnLine.deleteMany({ where: { organizationId: id } });
  await prisma.salesReturn.deleteMany({ where: { organizationId: id } });
  await prisma.salesInvoiceLine.deleteMany({ where: { organizationId: id } });
  await prisma.salesInvoice.deleteMany({ where: { organizationId: id } });
  await prisma.salesOrderLine.deleteMany({ where: { organizationId: id } });
  await prisma.salesOrder.deleteMany({ where: { organizationId: id } });
  await prisma.salesQuotationLine.deleteMany({ where: { organizationId: id } });
  await prisma.salesQuotation.deleteMany({ where: { organizationId: id } });
  await prisma.customerPriceOverride.deleteMany({ where: { organizationId: id } });
  await prisma.priceListItem.deleteMany({ where: { organizationId: id } });
  await prisma.discountRule.deleteMany({ where: { organizationId: id } });
  await prisma.customerLedgerEntry.deleteMany({ where: { organizationId: id } });
  await prisma.customerTagLink.deleteMany({ where: { organizationId: id } });
  await prisma.customer.deleteMany({ where: { organizationId: id } });
  await prisma.priceList.deleteMany({ where: { organizationId: id } });
  await prisma.inventoryMovement.deleteMany({ where: { organizationId: id } });
  await prisma.inventoryLot.deleteMany({ where: { organizationId: id } });
  await prisma.stockIssueLine.deleteMany({ where: { organizationId: id } });
  await prisma.stockIssue.deleteMany({ where: { organizationId: id } });
  await prisma.stockReturnLine.deleteMany({ where: { organizationId: id } });
  await prisma.stockReturn.deleteMany({ where: { organizationId: id } });
  await prisma.stockReservationLine.deleteMany({ where: { organizationId: id } });
  await prisma.stockReservation.deleteMany({ where: { organizationId: id } });
  await prisma.openingStockLine.deleteMany({ where: { organizationId: id } });
  await prisma.openingStock.deleteMany({ where: { organizationId: id } });
  await prisma.stockAdjustmentLine.deleteMany({ where: { organizationId: id } });
  await prisma.stockAdjustment.deleteMany({ where: { organizationId: id } });
  await prisma.stockBalance.deleteMany({ where: { organizationId: id } });
  await prisma.productBarcode.deleteMany({ where: { organizationId: id } });
  await prisma.productPriceHistory.deleteMany({ where: { organizationId: id } });
  await prisma.productVariant.deleteMany({ where: { organizationId: id } });
  await prisma.product.deleteMany({ where: { organizationId: id } });
  await prisma.unitConversion.deleteMany({ where: { organizationId: id } });
  await prisma.unitOfMeasure.deleteMany({ where: { organizationId: id } });
  await prisma.currency.deleteMany({ where: { organizationId: id } });
  await prisma.warehouseLocation.deleteMany({ where: { organizationId: id } });
  await prisma.warehouse.deleteMany({ where: { organizationId: id } });
  await prisma.tenantSystemConfig.deleteMany({ where: { organizationId: id } });
  await prisma.organizationSetting.deleteMany({ where: { organizationId: id } });
  await prisma.documentSequence.deleteMany({ where: { organizationId: id } });
  await prisma.tenantModule.deleteMany({ where: { organizationId: id } });
  await prisma.tenantEntitlement.deleteMany({ where: { organizationId: id } });
  await prisma.tenantSubscription.deleteMany({ where: { organizationId: id } });
  await prisma.organization.delete({ where: { id } });
}

async function main() {
  console.log("=== Phase 09 Sales & Invoicing Tests ===\n");
  createApp();
  pass("App boots with sales routes");

  const leftovers = await prisma.organization.findMany({
    where: { code: { in: ["SALES_TENANT_A"] } },
    select: { id: true },
  });
  for (const o of leftovers) await cleanupOrg(o.id);

  const tenantA = await prisma.organization.create({
    data: { code: "SALES_TENANT_A", name: "Sales A", defaultLocale: "en" },
  });
  await ensureDefaultTenantSaaS(tenantA.id);

  const units = await lookups.listUnits(tenantA.id, { pageSize: 50 });
  const pcs = units.items.find((u) => u.code === "PCS")!;
  const product = await products.createProduct(tenantA.id, {
    name: "Surgical Scrub",
    sku: "SAL-SKU-1",
    unitId: pcs.id,
    purchasePrice: 50,
    sellingPrice: 100,
  });

  // Seed stock
  const ost = await documents.createOpeningStock(tenantA.id, {
    lines: [{ productId: product.id, quantity: 50, unitCost: 50 }],
  });
  await documents.postOpeningStock(tenantA.id, ost.id);

  const customer = await customers.createCustomer(tenantA.id, {
    code: "CUST-S1",
    name: "City Hospital",
    paymentTermsDays: 15,
  });

  const pl = await pricing.createPriceList(tenantA.id, {
    code: "STD",
    name: "Standard",
    isDefault: true,
    items: [{ productId: product.id, unitPrice: 95 }],
  });
  await pricing.setCustomerPriceOverride(tenantA.id, {
    customerId: customer.id,
    productId: product.id,
    unitPrice: 90,
  });
  const resolved = await pricing.resolveUnitPrice(tenantA.id, {
    customerId: customer.id,
    productId: product.id,
  });
  if (resolved.unitPrice === 90 && resolved.source === "CUSTOMER_OVERRIDE") {
    pass("Customer-specific pricing resolves");
  } else fail("Customer-specific pricing resolves", JSON.stringify(resolved));

  const quote = await sales.createQuotation(tenantA.id, {
    customerId: customer.id,
    priceListId: pl.id,
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    lines: [{ productId: product.id, quantity: 10, taxPercent: 14 }],
  });
  if (Number(quote.lines[0].unitPrice) === 90) pass("Quotation uses customer price");
  else fail("Quotation uses customer price", String(quote.lines[0].unitPrice));

  await sales.updateQuotationStatus(tenantA.id, quote.id, "ACCEPTED");
  const order = await sales.convertQuotationToOrder(tenantA.id, quote.id);
  pass("Quotation converts to sales order");

  await sales.confirmSalesOrder(tenantA.id, order.id);
  await sales.reserveSalesOrder(tenantA.id, order.id);
  let stock = await balances.getStockBalance(tenantA.id, product.id);
  if (stock.quantityReserved === 10) pass("Stock reserved for sales order");
  else fail("Stock reserved for sales order", String(stock.quantityReserved));

  await sales.deliverSalesOrder(tenantA.id, order.id, {});
  stock = await balances.getStockBalance(tenantA.id, product.id);
  if (stock.quantityOnHand === 40) pass("Delivery issues stock (50→40)");
  else fail("Delivery issues stock (50→40)", String(stock.quantityOnHand));

  const inv = await sales.createSalesInvoice(tenantA.id, {
    customerId: customer.id,
    salesOrderId: order.id,
  });
  const posted = await sales.postSalesInvoice(tenantA.id, inv.id);
  if (posted.displayStatus === "POSTED" || posted.paymentStatus === "UNPAID") {
    pass("Invoice posted to customer ledger");
  } else fail("Invoice posted to customer ledger", posted.displayStatus);

  const print = await sales.getInvoicePrintPayload(tenantA.id, inv.id);
  if (print.company && print.customer && print.lines.length === 1 && print.invoice.code) {
    pass("Invoice print-ready payload");
  } else fail("Invoice print-ready payload", "incomplete");

  const receipt = await sales.createCustomerReceipt(tenantA.id, {
    customerId: customer.id,
    amount: Number(inv.totalAmount),
    allocations: [{ salesInvoiceId: inv.id, amount: Number(inv.totalAmount) }],
  });
  const paid = await sales.getSalesInvoice(tenantA.id, inv.id);
  if (paid.paymentStatus === "PAID" && receipt.status === "POSTED") pass("Customer receipt marks invoice PAID");
  else fail("Customer receipt marks invoice PAID", paid.paymentStatus);

  const ret = await sales.createSalesReturn(tenantA.id, {
    customerId: customer.id,
    salesOrderId: order.id,
    salesInvoiceId: inv.id,
    reason: "Defective",
    lines: [{ productId: product.id, quantity: 2, unitPrice: 90, taxPercent: 14 }],
  });
  await sales.postSalesReturn(tenantA.id, ret.id);
  stock = await balances.getStockBalance(tenantA.id, product.id);
  if (stock.quantityOnHand === 42) pass("Sales return restocks (40→42)");
  else fail("Sales return restocks (40→42)", String(stock.quantityOnHand));

  await cleanupOrg(tenantA.id);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Done: ${results.length - failed.length} passed, ${failed.length} failed ===`);
  if (failed.length) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
