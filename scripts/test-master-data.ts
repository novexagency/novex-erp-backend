import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import * as categories from "../src/modules/masterData/categories.service.js";
import * as lookups from "../src/modules/masterData/lookups.service.js";
import * as products from "../src/modules/masterData/products.service.js";
import { AppError } from "../src/utils/AppError.js";
import { ensureDefaultTenantSaaS } from "../src/modules/tenant/tenant.service.js";

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

async function main() {
  console.log("=== Phase 05 Master Data Tests ===\n");
  createApp();
  pass("App boots with master-data routes");

  const leftovers = await prisma.organization.findMany({
    where: { code: { in: ["MD_TENANT_A", "MD_TENANT_B"] } },
    select: { id: true },
  });
  for (const o of leftovers) {
    await prisma.productPriceHistory.deleteMany({ where: { organizationId: o.id } });
    await prisma.productBarcode.deleteMany({ where: { organizationId: o.id } });
    await prisma.productVariant.deleteMany({ where: { organizationId: o.id } });
    await prisma.product.deleteMany({ where: { organizationId: o.id } });
    await prisma.productCategory.deleteMany({ where: { organizationId: o.id } });
    await prisma.unitConversion.deleteMany({ where: { organizationId: o.id } });
    await prisma.unitOfMeasure.deleteMany({ where: { organizationId: o.id } });
    await prisma.brand.deleteMany({ where: { organizationId: o.id } });
    await prisma.taxRate.deleteMany({ where: { organizationId: o.id } });
    await prisma.currency.deleteMany({ where: { organizationId: o.id } });
    await prisma.warehouseLocation.deleteMany({ where: { organizationId: o.id } });
    await prisma.warehouse.deleteMany({ where: { organizationId: o.id } });
    await prisma.tenantSystemConfig.deleteMany({ where: { organizationId: o.id } });
    await prisma.organizationSetting.deleteMany({ where: { organizationId: o.id } });
    await prisma.tenantModule.deleteMany({ where: { organizationId: o.id } });
    await prisma.tenantEntitlement.deleteMany({ where: { organizationId: o.id } });
    await prisma.tenantSubscription.deleteMany({ where: { organizationId: o.id } });
    await prisma.organization.delete({ where: { id: o.id } });
  }

  const tenantA = await prisma.organization.create({
    data: { code: "MD_TENANT_A", name: "MD A", defaultLocale: "en" },
  });
  const tenantB = await prisma.organization.create({
    data: { code: "MD_TENANT_B", name: "MD B", defaultLocale: "ar" },
  });
  await ensureDefaultTenantSaaS(tenantA.id);
  await ensureDefaultTenantSaaS(tenantB.id);

  const units = await lookups.listUnits(tenantA.id, { pageSize: 50 });
  if (units.items.length >= 7) pass("Default UOM seeded");
  else fail("Default UOM seeded", String(units.items.length));

  const root = await categories.createCategory(tenantA.id, {
    name: "Apparel",
    nameAr: "ملابس",
    code: "APR",
  });
  const child = await categories.createCategory(tenantA.id, {
    name: "Scrubs",
    parentId: root.id,
    code: "APR-SCR",
  });
  const tree = await categories.listCategories(tenantA.id, { tree: true });
  if ("tree" in tree && tree.tree.length >= 1) pass("Category hierarchy works");
  else fail("Category hierarchy works", "no tree");

  const pcs = units.items.find((u) => u.code === "PCS");
  if (!pcs) throw new Error("PCS missing");

  const product = await products.createProduct(tenantA.id, {
    name: "Royal Scrub Top",
    nameAr: "توب سكراب",
    sku: "RST-001",
    unitId: pcs.id,
    purchasePrice: 100,
    sellingPrice: 180,
    barcodes: [{ barcode: "6220001112223", isPrimary: true }],
  });
  if (product.sku === "RST-001") pass("Product create with barcode");
  else fail("Product create with barcode", product.sku);

  try {
    await products.createProduct(tenantA.id, {
      name: "Dup",
      sku: "RST-001",
      unitId: pcs.id,
    });
    fail("Duplicate SKU blocked", "did not throw");
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 409) pass("Duplicate SKU blocked");
    else fail("Duplicate SKU blocked", String(err));
  }

  await products.updateProduct(tenantA.id, product.id, { sellingPrice: 200 });
  const history = await products.listPriceHistory(tenantA.id, product.id);
  if (history.length >= 2) pass("Price history recorded");
  else fail("Price history recorded", String(history.length));

  await products.addVariant(tenantA.id, product.id, {
    name: "Size M",
    sku: "RST-001-M",
    attributes: { size: "M" },
  });
  pass("Product variant created");

  await products.archiveProduct(tenantA.id, product.id);
  const listed = await products.listProducts(tenantA.id, {});
  if (!listed.items.find((p) => p.id === product.id)) pass("Archive hides product from default list");
  else fail("Archive hides product from default list", "still visible");

  const exportData = await products.exportProducts(tenantA.id);
  pass(`Export prep returns rows (${exportData.count})`);

  const dry = await products.bulkImportProducts(
    tenantA.id,
    [{ sku: "IMP-1", name: "Imported", unitCode: "PCS", purchasePrice: 10, sellingPrice: 15 }],
    true
  );
  if (dry.accepted === 1) pass("Bulk import dry-run validates rows");
  else fail("Bulk import dry-run validates rows", JSON.stringify(dry));

  try {
    await products.getProduct(tenantB.id, product.id);
    fail("Cross-tenant product access blocked", "did not throw");
  } catch (err) {
    if (err instanceof AppError) pass("Cross-tenant product access blocked");
    else fail("Cross-tenant product access blocked", String(err));
  }

  await lookups.createBrand(tenantA.id, { name: "Novex Brand" });
  try {
    await lookups.createBrand(tenantA.id, { name: "Novex Brand" });
    fail("Duplicate brand blocked", "did not throw");
  } catch (err) {
    if (err instanceof AppError) pass("Duplicate brand blocked");
    else fail("Duplicate brand blocked", String(err));
  }

  const kg = units.items.find((u) => u.code === "KG")!;
  const g = units.items.find((u) => u.code === "G")!;
  const converted = await lookups.convertQty(tenantA.id, kg.id, g.id, 2);
  if (converted === 2000) pass("Unit conversion works (2kg -> 2000g)");
  else fail("Unit conversion works (2kg -> 2000g)", String(converted));

  // cleanup
  for (const id of [tenantA.id, tenantB.id]) {
    await prisma.productPriceHistory.deleteMany({ where: { organizationId: id } });
    await prisma.productBarcode.deleteMany({ where: { organizationId: id } });
    await prisma.productVariant.deleteMany({ where: { organizationId: id } });
    await prisma.product.deleteMany({ where: { organizationId: id } });
    await prisma.productCategory.deleteMany({ where: { organizationId: id } });
    await prisma.unitConversion.deleteMany({ where: { organizationId: id } });
    await prisma.unitOfMeasure.deleteMany({ where: { organizationId: id } });
    await prisma.brand.deleteMany({ where: { organizationId: id } });
    await prisma.taxRate.deleteMany({ where: { organizationId: id } });
    await prisma.paymentMethod.deleteMany({ where: { organizationId: id } });
    await prisma.expenseCategory.deleteMany({ where: { organizationId: id } });
    await prisma.currency.deleteMany({ where: { organizationId: id } });
    await prisma.jobTitle.deleteMany({ where: { organizationId: id } });
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
  void child;

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
