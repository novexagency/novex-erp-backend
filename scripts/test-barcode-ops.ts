import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { ensureDefaultTenantSaaS } from "../src/modules/tenant/tenant.service.js";
import * as products from "../src/modules/masterData/products.service.js";
import * as barcode from "../src/modules/inventory/barcode.service.js";
import { AppError } from "../src/utils/AppError.js";

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

async function cleanup(id: string) {
  await prisma.barcodeScan.deleteMany({ where: { organizationId: id } });
  await prisma.productBarcode.deleteMany({ where: { organizationId: id } });
  await prisma.stockBalance.deleteMany({ where: { organizationId: id } });
  await prisma.productPriceHistory.deleteMany({ where: { organizationId: id } });
  await prisma.product.deleteMany({ where: { organizationId: id } });
  await prisma.unitConversion.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.unitOfMeasure.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.warehouse.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.tenantSystemConfig.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.documentSequence.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.tenantModule.deleteMany({ where: { organizationId: id } });
  await prisma.tenantEntitlement.deleteMany({ where: { organizationId: id } });
  await prisma.tenantSubscription.deleteMany({ where: { organizationId: id } });
  await prisma.organization.delete({ where: { id } }).catch(() => undefined);
}

async function main() {
  console.log("=== Barcode ops tests ===\n");
  createApp();

  for (const o of await prisma.organization.findMany({
    where: { code: "BARCODE_OPS" },
    select: { id: true },
  })) {
    await cleanup(o.id);
  }

  const org = await prisma.organization.create({
    data: { name: "Barcode Ops", code: "BARCODE_OPS", baseCurrency: "EGP" },
  });
  await ensureDefaultTenantSaaS(org.id);
  const unit = await prisma.unitOfMeasure.findFirstOrThrow({
    where: { organizationId: org.id },
  });
  const product = await products.createProduct(org.id, {
    name: "Barcode Item",
    sku: `BC-SKU-${Date.now()}`,
    unitId: unit.id,
  });

  let code = "";
  try {
    const g1 = await barcode.generateBarcode(org.id, {
      productId: product.id,
      symbology: "CODE128",
      copies: 1,
    });
    code = g1.barcode;
    const g2 = await barcode.generateBarcode(org.id, {
      productId: product.id,
      symbology: "CODE128",
    });
    if (g2.barcode !== g1.barcode) throw new Error("should reuse primary");
    const g3 = await barcode.generateBarcode(org.id, {
      productId: product.id,
      forceNew: true,
    });
    if (g3.barcode === g1.barcode) throw new Error("forceNew should create another");
    pass("generate reuses primary unless forceNew");
  } catch (e) {
    fail("generate reuses primary unless forceNew", e instanceof Error ? e.message : String(e));
  }

  try {
    const pdf = await barcode.buildLabelsPdf(org.id, {
      items: [{ productId: product.id, barcode: code, copies: 2 }],
      layout: { columns: 2, widthMm: 50, heightMm: 30 },
    });
    if (!pdf?.length || pdf.subarray(0, 4).toString() !== "%PDF") {
      throw new Error("not a pdf");
    }
    let bad = false;
    try {
      await barcode.buildLabelsPdf(org.id, {
        items: [{ productId: product.id, barcode: "NOT-THIS-PRODUCT", copies: 1 }],
      });
    } catch (err) {
      bad = err instanceof AppError && err.statusCode === 400;
    }
    if (!bad) throw new Error("expected 400 for mismatched barcode");
    pass("labels pdf + mismatch 400");
  } catch (e) {
    fail("labels pdf + mismatch 400", e instanceof Error ? e.message : String(e));
  }

  try {
    await barcode.recordBarcodeScan(
      org.id,
      { barcode: code, source: "MANUAL", result: "FOUND", productId: product.id },
      "00000000-0000-4000-8000-000000000001"
    );
    await barcode.recordBarcodeScan(org.id, {
      barcode: "UNKNOWN-XYZ",
      source: "CAMERA",
      result: "NOT_FOUND",
      productId: null,
    });
    const list = await barcode.listBarcodeScans(org.id, { page: 1, pageSize: 20 });
    if (list.total < 2) throw new Error("expected scans");
    if (!list.items.some((i) => i.result === "FOUND" && i.productName)) {
      throw new Error("found row missing product name");
    }
    pass("scan log create + list");
  } catch (e) {
    fail("scan log create + list", e instanceof Error ? e.message : String(e));
  }

  await cleanup(org.id);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
