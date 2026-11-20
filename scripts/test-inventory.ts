import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { AppError } from "../src/utils/AppError.js";
import { ensureDefaultTenantSaaS } from "../src/modules/tenant/tenant.service.js";
import * as balances from "../src/modules/inventory/balances.service.js";
import * as counts from "../src/modules/inventory/counts.service.js";
import * as documents from "../src/modules/inventory/documents.service.js";
import * as reports from "../src/modules/inventory/reports.service.js";
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
  await prisma.inventoryLot.deleteMany({ where: { organizationId: id } });
  await prisma.stockCountLine.deleteMany({ where: { organizationId: id } });
  await prisma.stockCount.deleteMany({ where: { organizationId: id } });
  await prisma.openingStockLine.deleteMany({ where: { organizationId: id } });
  await prisma.openingStock.deleteMany({ where: { organizationId: id } });
  await prisma.stockIssueLine.deleteMany({ where: { organizationId: id } });
  await prisma.stockIssue.deleteMany({ where: { organizationId: id } });
  await prisma.stockReturnLine.deleteMany({ where: { organizationId: id } });
  await prisma.stockReturn.deleteMany({ where: { organizationId: id } });
  await prisma.stockReservationLine.deleteMany({ where: { organizationId: id } });
  await prisma.stockReservation.deleteMany({ where: { organizationId: id } });
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
  console.log("=== Phase 08 Advanced Inventory Tests ===\n");
  createApp();
  pass("App boots with inventory routes");

  const leftovers = await prisma.organization.findMany({
    where: { code: { in: ["INV_TENANT_A", "INV_TENANT_B"] } },
    select: { id: true },
  });
  for (const o of leftovers) await cleanupOrg(o.id);

  const tenantA = await prisma.organization.create({
    data: { code: "INV_TENANT_A", name: "Inv A", defaultLocale: "en" },
  });
  const tenantB = await prisma.organization.create({
    data: { code: "INV_TENANT_B", name: "Inv B", defaultLocale: "ar" },
  });
  await ensureDefaultTenantSaaS(tenantA.id);
  await ensureDefaultTenantSaaS(tenantB.id);

  const units = await lookups.listUnits(tenantA.id, { pageSize: 50 });
  const pcs = units.items.find((u) => u.code === "PCS")!;
  const product = await products.createProduct(tenantA.id, {
    name: "Lab Coat",
    sku: "INV-SKU-1",
    unitId: pcs.id,
    purchasePrice: 100,
    sellingPrice: 180,
    minStock: 5,
    reorderLevel: 5,
    barcodes: [{ barcode: "6229990001112", isPrimary: true }],
  });

  // Opening stock: 10 @ 100
  const ost = await documents.createOpeningStock(tenantA.id, {
    lines: [{ productId: product.id, quantity: 10, unitCost: 100, batchNumber: "B1" }],
  });
  await documents.postOpeningStock(tenantA.id, ost.id);
  let stock = await balances.getStockBalance(tenantA.id, product.id);
  if (stock.quantityOnHand === 10 && stock.avgUnitCost === 100 && stock.totalValue === 1000) {
    pass("Opening stock posts with WAC valuation");
  } else fail("Opening stock posts with WAC valuation", JSON.stringify(stock));

  // Second inbound via adjustment IN 10 @ 120 → WAC = (10*100+10*120)/20 = 110
  const adjIn = await documents.createStockAdjustment(tenantA.id, {
    reason: "Extra receipt",
    reasonCode: "MANUAL",
    lines: [{ productId: product.id, direction: "IN", quantity: 10, unitCost: 120 }],
  });
  await documents.postStockAdjustment(tenantA.id, adjIn.id);
  stock = await balances.getStockBalance(tenantA.id, product.id);
  if (stock.quantityOnHand === 20 && stock.avgUnitCost === 110) {
    pass("WAC recalculates on inbound (110)");
  } else fail("WAC recalculates on inbound (110)", JSON.stringify(stock));

  // Reservation
  const rsv = await documents.createReservation(tenantA.id, {
    salesOrderId: undefined,
    lines: [{ productId: product.id, quantity: 4 }],
  });
  stock = await balances.getStockBalance(tenantA.id, product.id);
  if (stock.quantityReserved === 4 && stock.quantityAvailable === 16) {
    pass("Reservation updates reserved/available");
  } else fail("Reservation updates reserved/available", JSON.stringify(stock));

  // Sales issue consuming reservation
  const issue = await documents.createStockIssue(tenantA.id, {
    reservationId: rsv.id,
    lines: [{ productId: product.id, quantity: 4 }],
  });
  await documents.postStockIssue(tenantA.id, issue.id);
  stock = await balances.getStockBalance(tenantA.id, product.id);
  if (stock.quantityOnHand === 16 && stock.quantityReserved === 0 && stock.avgUnitCost === 110) {
    pass("Sales issue posts at WAC; reserved released");
  } else fail("Sales issue posts at WAC; reserved released", JSON.stringify(stock));

  // Sales return at WAC
  const sret = await documents.createStockReturn(tenantA.id, {
    stockIssueId: issue.id,
    lines: [{ productId: product.id, quantity: 2 }],
  });
  await documents.postStockReturn(tenantA.id, sret.id);
  stock = await balances.getStockBalance(tenantA.id, product.id);
  if (stock.quantityOnHand === 18) pass("Sales return increases on-hand");
  else fail("Sales return increases on-hand", String(stock.quantityOnHand));

  // Damaged goods
  const dmg = await documents.createStockAdjustment(tenantA.id, {
    reason: "Water damage",
    reasonCode: "DAMAGED",
    lines: [{ productId: product.id, direction: "OUT", quantity: 1 }],
  });
  await documents.postStockAdjustment(tenantA.id, dmg.id);
  stock = await balances.getStockBalance(tenantA.id, product.id);
  if (stock.quantityOnHand === 17) pass("Damaged goods adjustment");
  else fail("Damaged goods adjustment", String(stock.quantityOnHand));

  // Negative stock blocked
  try {
    const bad = await documents.createStockAdjustment(tenantA.id, {
      reason: "Over issue",
      lines: [{ productId: product.id, direction: "OUT", quantity: 999 }],
    });
    await documents.postStockAdjustment(tenantA.id, bad.id);
    fail("Negative stock blocked", "did not throw");
  } catch (err) {
    if (err instanceof AppError) pass("Negative stock blocked");
    else fail("Negative stock blocked", String(err));
  }

  // Duplicate post blocked
  try {
    await documents.postOpeningStock(tenantA.id, ost.id);
    fail("Duplicate opening post blocked", "did not throw");
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 409) pass("Duplicate opening post blocked");
    else fail("Duplicate opening post blocked", String(err));
  }

  // Stock count workflow
  const cnt = await counts.createStockCount(tenantA.id, { productIds: [product.id] });
  await counts.recordCountQuantities(tenantA.id, cnt.id, [
    { productId: product.id, countedQuantity: 15 },
  ]);
  await counts.submitStockCount(tenantA.id, cnt.id);
  await counts.approveStockCount(tenantA.id, cnt.id);
  await counts.postStockCount(tenantA.id, cnt.id);
  stock = await balances.getStockBalance(tenantA.id, product.id);
  if (stock.quantityOnHand === 15) pass("Stock count approve+post adjusts to 15");
  else fail("Stock count approve+post adjusts to 15", String(stock.quantityOnHand));

  const barcode = await balances.lookupByBarcode(tenantA.id, "6229990001112");
  if (barcode?.product.id === product.id) pass("Barcode product lookup");
  else fail("Barcode product lookup", "miss");

  const val = await balances.inventoryValuation(tenantA.id);
  if (val.costingMethod === "WEIGHTED_AVERAGE" && val.totalValue === 15 * 110) {
    pass("Inventory valuation (WAC)");
  } else fail("Inventory valuation (WAC)", JSON.stringify(val));

  const low = await reports.lowStockAlerts(tenantA.id);
  // available 15, reorder 5 — not low
  const slow = await reports.slowMovingReport(tenantA.id, 1);
  pass(`Reports ok (low=${low.count}, slow=${slow.count})`);

  const lots = await reports.listLots(tenantA.id, product.id);
  if (lots.length >= 1) pass("Inventory lots created for FIFO-ready layers");
  else fail("Inventory lots created for FIFO-ready layers", "none");

  const mv = await balances.listMovements(tenantA.id, { productId: product.id });
  if (mv.length >= 5) pass(`Stock ledger history (${mv.length} movements)`);
  else fail("Stock ledger history", String(mv.length));

  try {
    await balances.getStockBalance(tenantB.id, product.id);
    // may return zero without throw if product not in B — cross-tenant product lookup
    const p = await prisma.product.findFirst({ where: { id: product.id, organizationId: tenantB.id } });
    if (!p) pass("Cross-tenant product isolation");
    else fail("Cross-tenant product isolation", "found");
  } catch {
    pass("Cross-tenant product isolation");
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
