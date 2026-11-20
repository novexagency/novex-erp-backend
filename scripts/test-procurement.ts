import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { AppError } from "../src/utils/AppError.js";
import { ensureDefaultTenantSaaS } from "../src/modules/tenant/tenant.service.js";
import * as inventory from "../src/modules/procurement/inventory.service.js";
import * as purchasing from "../src/modules/procurement/purchasing.service.js";
import * as suppliers from "../src/modules/procurement/suppliers.service.js";
import * as products from "../src/modules/masterData/products.service.js";
import * as lookups from "../src/modules/masterData/lookups.service.js";

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
  await prisma.inventoryMovement.deleteMany({ where: { organizationId: id } });
  await prisma.stockAdjustmentLine.deleteMany({ where: { organizationId: id } });
  await prisma.stockAdjustment.deleteMany({ where: { organizationId: id } });
  await prisma.stockBalance.deleteMany({ where: { organizationId: id } });
  await prisma.supplierPaymentAllocation.deleteMany({ where: { organizationId: id } });
  await prisma.supplierPayment.deleteMany({ where: { organizationId: id } });
  await prisma.purchaseInvoiceLine.deleteMany({ where: { organizationId: id } });
  await prisma.purchaseInvoice.deleteMany({ where: { organizationId: id } });
  await prisma.purchaseReturnLine.deleteMany({ where: { organizationId: id } });
  await prisma.purchaseReturn.deleteMany({ where: { organizationId: id } });
  await prisma.goodsReceiptLine.deleteMany({ where: { organizationId: id } });
  await prisma.goodsReceipt.deleteMany({ where: { organizationId: id } });
  await prisma.purchaseOrderAttachment.deleteMany({ where: { organizationId: id } });
  await prisma.purchaseOrderLine.deleteMany({ where: { organizationId: id } });
  await prisma.purchaseOrder.deleteMany({ where: { organizationId: id } });
  await prisma.purchaseRequestLine.deleteMany({ where: { organizationId: id } });
  await prisma.purchaseRequest.deleteMany({ where: { organizationId: id } });
  await prisma.supplierLedgerEntry.deleteMany({ where: { organizationId: id } });
  await prisma.supplier.deleteMany({ where: { organizationId: id } });
  await prisma.supplierCategory.deleteMany({ where: { organizationId: id } });
  await prisma.productPriceHistory.deleteMany({ where: { organizationId: id } });
  await prisma.productBarcode.deleteMany({ where: { organizationId: id } });
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
  console.log("=== Phase 07 Procurement & Inventory Tests ===\n");
  createApp();
  pass("App boots with procurement routes");

  const leftovers = await prisma.organization.findMany({
    where: { code: { in: ["PROC_TENANT_A", "PROC_TENANT_B"] } },
    select: { id: true },
  });
  for (const o of leftovers) await cleanupOrg(o.id);

  const tenantA = await prisma.organization.create({
    data: { code: "PROC_TENANT_A", name: "Proc A", defaultLocale: "en" },
  });
  const tenantB = await prisma.organization.create({
    data: { code: "PROC_TENANT_B", name: "Proc B", defaultLocale: "ar" },
  });
  await ensureDefaultTenantSaaS(tenantA.id);
  await ensureDefaultTenantSaaS(tenantB.id);

  const units = await lookups.listUnits(tenantA.id, { pageSize: 50 });
  const pcs = units.items.find((u) => u.code === "PCS");
  if (!pcs) throw new Error("PCS missing");

  const product = await products.createProduct(tenantA.id, {
    name: "Scrub Top Navy",
    sku: "PROC-SKU-1",
    unitId: pcs.id,
    purchasePrice: 80,
    sellingPrice: 150,
  });

  const category = await suppliers.createCategory(tenantA.id, {
    name: "Fabric Mills",
    code: "FAB",
  });
  const supplier = await suppliers.createSupplier(tenantA.id, {
    code: "SUP-001",
    name: "Delta Textiles",
    categoryId: category.id,
    paymentTermsDays: 30,
    openingBalance: 1000,
  });
  pass("Supplier profile + category + opening balance");

  const pr = await purchasing.createPurchaseRequest(tenantA.id, {
    notes: "Need stock",
    lines: [{ productId: product.id, quantity: 10 }],
  });
  await purchasing.submitPurchaseRequest(tenantA.id, pr.id);
  await purchasing.approvePurchaseRequest(tenantA.id, pr.id);
  pass("Purchase request submit + approve");

  const po = await purchasing.createPurchaseOrder(tenantA.id, {
    supplierId: supplier.id,
    purchaseRequestId: pr.id,
    expectedDeliveryDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    lines: [
      {
        productId: product.id,
        quantity: 10,
        unitPrice: 80,
        discountPercent: 5,
        taxPercent: 14,
      },
    ],
  });
  await purchasing.addPoAttachment(tenantA.id, po.id, {
    publicId: "test/po-attach",
    secureUrl: "https://res.cloudinary.com/demo/raw/upload/test.pdf",
    fileName: "quote.pdf",
  });
  await purchasing.issuePurchaseOrder(tenantA.id, po.id);
  pass("PO create / attach / issue");

  const stockBefore = await inventory.getStockBalance(tenantA.id, product.id);
  if (stockBefore.quantityOnHand !== 0) fail("Stock starts at 0", String(stockBefore.quantityOnHand));
  else pass("Stock starts at 0 before GRN post");

  // Partial receive 4 of 10
  const grn1 = await purchasing.createGoodsReceipt(tenantA.id, {
    purchaseOrderId: po.id,
    lines: [{ purchaseOrderLineId: po.lines[0].id, quantityReceived: 4, unitCost: 80 }],
  });
  // Draft GRN must NOT change stock
  const midStock = await inventory.getStockBalance(tenantA.id, product.id);
  if (midStock.quantityOnHand !== 0) fail("Draft GRN does not change stock", String(midStock.quantityOnHand));
  else pass("Draft GRN does not change stock");

  await purchasing.postGoodsReceipt(tenantA.id, grn1.id);
  const afterPartial = await inventory.getStockBalance(tenantA.id, product.id);
  if (afterPartial.quantityOnHand === 4) pass("Partial GRN post updates stock to 4");
  else fail("Partial GRN post updates stock to 4", String(afterPartial.quantityOnHand));

  const poAfter = await purchasing.getPurchaseOrder(tenantA.id, po.id);
  if (poAfter.status === "PARTIALLY_RECEIVED") pass("PO status PARTIALLY_RECEIVED");
  else fail("PO status PARTIALLY_RECEIVED", poAfter.status);

  // Over-receive blocked
  try {
    await purchasing.createGoodsReceipt(tenantA.id, {
      purchaseOrderId: po.id,
      lines: [{ purchaseOrderLineId: po.lines[0].id, quantityReceived: 100 }],
    });
    fail("Over-receive blocked without auth", "did not throw");
  } catch (err) {
    if (err instanceof AppError) pass("Over-receive blocked without auth");
    else fail("Over-receive blocked without auth", String(err));
  }

  // Receive remaining 6
  const grn2 = await purchasing.createGoodsReceipt(tenantA.id, {
    purchaseOrderId: po.id,
    lines: [{ purchaseOrderLineId: po.lines[0].id, quantityReceived: 6, unitCost: 80 }],
  });
  await purchasing.postGoodsReceipt(tenantA.id, grn2.id);
  const afterFull = await inventory.getStockBalance(tenantA.id, product.id);
  if (afterFull.quantityOnHand === 10) pass("Full receive stock = 10");
  else fail("Full receive stock = 10", String(afterFull.quantityOnHand));

  // Duplicate post blocked
  try {
    await purchasing.postGoodsReceipt(tenantA.id, grn2.id);
    fail("Duplicate GRN post blocked", "did not throw");
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 409) pass("Duplicate GRN post blocked");
    else fail("Duplicate GRN post blocked", String(err));
  }

  const movements = await inventory.listMovements(tenantA.id, {
    productId: product.id,
    referenceType: "GOODS_RECEIPT",
  });
  if (movements.length === 2 && Number(movements[0].previousBalance) >= 0) {
    pass("Inventory movements audit trail");
  } else fail("Inventory movements audit trail", String(movements.length));

  // Invoice + payment
  const inv = await purchasing.createPurchaseInvoice(tenantA.id, {
    supplierId: supplier.id,
    purchaseOrderId: po.id,
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
    lines: [
      {
        productId: product.id,
        quantity: 10,
        unitPrice: 80,
        discountPercent: 5,
        taxPercent: 14,
      },
    ],
  });
  await purchasing.postPurchaseInvoice(tenantA.id, inv.id);
  const pay = await purchasing.createSupplierPayment(tenantA.id, {
    supplierId: supplier.id,
    amount: Number(inv.totalAmount),
    allocations: [{ purchaseInvoiceId: inv.id, amount: Number(inv.totalAmount) }],
  });
  const invPaid = await purchasing.getPurchaseInvoice(tenantA.id, inv.id);
  if (invPaid.paymentStatus === "PAID" && pay.status === "POSTED") pass("Invoice post + supplier payment");
  else fail("Invoice post + supplier payment", invPaid.paymentStatus);

  // Purchase return (2 units)
  const ret = await purchasing.createPurchaseReturn(tenantA.id, {
    supplierId: supplier.id,
    purchaseOrderId: po.id,
    goodsReceiptId: grn2.id,
    reason: "Damaged",
    lines: [
      {
        productId: product.id,
        purchaseOrderLineId: po.lines[0].id,
        quantity: 2,
        unitCost: 80,
      },
    ],
  });
  await purchasing.postPurchaseReturn(tenantA.id, ret.id);
  const afterReturn = await inventory.getStockBalance(tenantA.id, product.id);
  if (afterReturn.quantityOnHand === 8) pass("Purchase return reverses stock (10→8)");
  else fail("Purchase return reverses stock (10→8)", String(afterReturn.quantityOnHand));

  // Authorized adjustment
  const adj = await inventory.createStockAdjustment(tenantA.id, {
    reason: "Cycle count correction",
    lines: [{ productId: product.id, direction: "IN", quantity: 1, unitCost: 80 }],
  });
  await inventory.postStockAdjustment(tenantA.id, adj.id);
  const afterAdj = await inventory.getStockBalance(tenantA.id, product.id);
  if (afterAdj.quantityOnHand === 9) pass("Authorized stock adjustment posts movement");
  else fail("Authorized stock adjustment posts movement", String(afterAdj.quantityOnHand));

  try {
    await suppliers.getSupplier(tenantB.id, supplier.id);
    fail("Cross-tenant supplier access blocked", "did not throw");
  } catch (err) {
    if (err instanceof AppError) pass("Cross-tenant supplier access blocked");
    else fail("Cross-tenant supplier access blocked", String(err));
  }

  for (const id of [tenantA.id, tenantB.id]) await cleanupOrg(id);

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
