import "dotenv/config";
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { AppError } from "../src/utils/AppError.js";
import { ensureDefaultTenantSaaS } from "../src/modules/tenant/tenant.service.js";
import * as customers from "../src/modules/crm/customers.service.js";
import * as documents from "../src/modules/inventory/documents.service.js";
import * as balances from "../src/modules/inventory/balances.service.js";
import * as lookups from "../src/modules/masterData/lookups.service.js";
import * as products from "../src/modules/masterData/products.service.js";
import * as checkout from "../src/modules/pos/checkout.service.js";
import * as sessions from "../src/modules/pos/sessions.service.js";

const prisma = new PrismaClient();
const cashierId = randomUUID();
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
  await prisma.posSaleEvent.deleteMany({ where: { organizationId: id } });
  await prisma.posPayment.deleteMany({ where: { organizationId: id } });
  await prisma.posSaleLine.deleteMany({ where: { organizationId: id } });
  await prisma.posSale.deleteMany({ where: { organizationId: id } });
  await prisma.cashMovement.deleteMany({ where: { organizationId: id } });
  await prisma.cashierSession.deleteMany({ where: { organizationId: id } });
  await prisma.posReceiptConfig.deleteMany({ where: { organizationId: id } });
  await prisma.customerLedgerEntry.deleteMany({ where: { organizationId: id } });
  await prisma.customer.deleteMany({ where: { organizationId: id } });
  await prisma.inventoryMovement.deleteMany({ where: { organizationId: id } });
  await prisma.inventoryLot.deleteMany({ where: { organizationId: id } });
  await prisma.stockIssueLine.deleteMany({ where: { organizationId: id } });
  await prisma.stockIssue.deleteMany({ where: { organizationId: id } });
  await prisma.stockReturnLine.deleteMany({ where: { organizationId: id } });
  await prisma.stockReturn.deleteMany({ where: { organizationId: id } });
  await prisma.openingStockLine.deleteMany({ where: { organizationId: id } });
  await prisma.openingStock.deleteMany({ where: { organizationId: id } });
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
  console.log("=== Phase 10 POS & Cashier Tests ===\n");
  createApp();
  pass("App boots with POS routes");

  const leftovers = await prisma.organization.findMany({
    where: { code: { in: ["POS_TENANT_A"] } },
    select: { id: true },
  });
  for (const o of leftovers) await cleanupOrg(o.id);

  const tenantA = await prisma.organization.create({
    data: { code: "POS_TENANT_A", name: "POS A", defaultLocale: "en" },
  });
  await ensureDefaultTenantSaaS(tenantA.id);

  const units = await lookups.listUnits(tenantA.id, { pageSize: 50 });
  const pcs = units.items.find((u) => u.code === "PCS")!;
  const product = await products.createProduct(tenantA.id, {
    name: "POS Mask",
    sku: "POS-SKU-1",
    unitId: pcs.id,
    purchasePrice: 10,
    sellingPrice: 25,
    barcodes: [{ barcode: "6221112223334", isPrimary: true }],
  });
  const ost = await documents.createOpeningStock(tenantA.id, {
    lines: [{ productId: product.id, quantity: 100, unitCost: 10 }],
  });
  await documents.postOpeningStock(tenantA.id, ost.id);

  const customer = await customers.createCustomer(tenantA.id, {
    code: "POS-C1",
    name: "Walk-in Credit Cust",
  });

  const session = await sessions.openSession(tenantA.id, { openingCash: 500 }, cashierId);
  pass("Open cashier session");

  await sessions.recordCashMovement(tenantA.id, session.id, {
    type: "CASH_IN",
    amount: 50,
    reason: "Float top-up",
  });

  const search = await checkout.searchProducts(tenantA.id, "Mask");
  if (search.length >= 1) pass("Fast product search");
  else fail("Fast product search", "none");

  const reqId = `req-${randomUUID()}`;
  const sale1 = await checkout.checkout(
    tenantA.id,
    {
      clientRequestId: reqId,
      lines: [{ barcode: "6221112223334", quantity: 2, taxPercent: 14 }],
      payments: [
        { methodCode: "CASH", amount: 40 },
        { methodCode: "CARD", amount: 20 },
      ],
    },
    cashierId
  );
  // total = 2*25=50, tax 14% on (50) if tax on subtotal after discount = 50*0.14=7, total 57
  // wait computeLineTotals: tax on lineSubtotal after discount. 50 + 7 = 57
  // payments 60 >= 57 OK
  if (!sale1.duplicate && sale1.sale.payments.length === 2) pass("Checkout with split payments");
  else fail("Checkout with split payments", "fail");

  const dup = await checkout.checkout(
    tenantA.id,
    {
      clientRequestId: reqId,
      lines: [{ productId: product.id, quantity: 2, taxPercent: 14 }],
      payments: [{ methodCode: "CASH", amount: 100 }],
    },
    cashierId
  );
  if (dup.duplicate && dup.sale.id === sale1.sale.id) pass("Duplicate checkout blocked (idempotent)");
  else fail("Duplicate checkout blocked (idempotent)", "not duplicate");

  try {
    await checkout.checkout(
      tenantA.id,
      {
        lines: [{ productId: product.id, quantity: 1, discountPercent: 20 }],
        payments: [{ methodCode: "CASH", amount: 100 }],
      },
      cashierId
    );
    fail("Unauthorized discount blocked", "did not throw");
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 403) pass("Unauthorized discount blocked");
    else fail("Unauthorized discount blocked", String(err));
  }

  await checkout.checkout(
    tenantA.id,
    {
      customerId: customer.id,
      allowCredit: true,
      lines: [{ productId: product.id, quantity: 1, taxPercent: 0 }],
      payments: [
        { methodCode: "CASH", amount: 10 },
        { methodCode: "CREDIT", amount: 15 },
      ],
    },
    cashierId
  );
  pass("Credit sale with customer");

  let stock = await balances.getStockBalance(tenantA.id, product.id);
  // sold 2 + 1 = 3 from 100
  if (stock.quantityOnHand === 97) pass("POS checkout issues stock");
  else fail("POS checkout issues stock", String(stock.quantityOnHand));

  const receipt = await checkout.getReceiptPrint(tenantA.id, sale1.sale.id);
  if (receipt.layout && receipt.lines.length >= 1 && receipt.sale.code) pass("Printable receipt payload");
  else fail("Printable receipt payload", "incomplete");

  await checkout.cancelSale(tenantA.id, sale1.sale.id, "Customer changed mind", cashierId);
  stock = await balances.getStockBalance(tenantA.id, product.id);
  if (stock.quantityOnHand === 99) pass("Cancelled sale restocks");
  else fail("Cancelled sale restocks", String(stock.quantityOnHand));

  // Close with difference → pending approval
  const closed = await sessions.closeSession(tenantA.id, session.id, {
    actualCash: 400,
    discrepancyReason: "Short",
  });
  if (closed.status === "PENDING_APPROVAL") pass("Cash discrepancy requires approval");
  else fail("Cash discrepancy requires approval", closed.status);

  await sessions.approveSessionClose(tenantA.id, session.id, cashierId, "Approved short");
  const approved = await sessions.getSession(tenantA.id, session.id);
  if (approved.status === "CLOSED") pass("Discrepancy approved and session closed");
  else fail("Discrepancy approved and session closed", approved.status);

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
