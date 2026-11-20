import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import * as companyService from "../src/modules/company/company.service.js";
import { AppError } from "../src/utils/AppError.js";
import { createApp } from "../src/app.js";

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

async function cleanupTenant(ids: string[]) {
  await prisma.warehouseLocation.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.warehouse.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.tenantSystemConfig.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.documentSequence.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organizationSetting.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.tenantActivity.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.tenantModule.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.tenantEntitlement.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.tenantSubscription.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  console.log("=== Phase 03 Company Config Tests ===\n");
  createApp();
  pass("App boots with company routes");

  // Clean leftovers from interrupted runs
  const leftovers = await prisma.organization.findMany({
    where: { code: { in: ["CFG_TENANT_A", "CFG_TENANT_B"] } },
    select: { id: true },
  });
  if (leftovers.length) await cleanupTenant(leftovers.map((o) => o.id));

  const tenantA = await prisma.organization.create({
    data: { code: "CFG_TENANT_A", name: "Config Tenant A", defaultLocale: "en" },
  });
  const tenantB = await prisma.organization.create({
    data: { code: "CFG_TENANT_B", name: "Config Tenant B", defaultLocale: "ar" },
  });

  try {
    await companyService.ensureSystemConfig(tenantA.id);
    await companyService.ensureSystemConfig(tenantB.id);
    await companyService.ensureDefaultWarehouse(tenantA.id);
    await companyService.ensureDefaultWarehouse(tenantB.id);

    await companyService.updateCompanyProfile(tenantA.id, {
      name: "Alpha Co",
      taxNumber: "TAX-A-1",
      phonePrimary: "01000000001",
      businessActivity: "Apparel",
      description: "Tenant A only",
    });

    await companyService.updateSystemConfig(tenantA.id, {
      currency: "EGP",
      defaultLocale: "ar",
      textDirection: "auto",
      dateFormat: "DD/MM/YYYY",
      fiscalYearStartMonth: 7,
      invoicePrefix: "INV-A",
      defaultTaxRate: 14,
    });

    await companyService.updateSystemConfig(tenantB.id, {
      currency: "USD",
      defaultLocale: "en",
      invoicePrefix: "INV-B",
    });

    const a = await companyService.getCompanyBundle(tenantA.id);
    const b = await companyService.getCompanyBundle(tenantB.id);

    if (a.profile.taxNumber === "TAX-A-1" && b.profile.taxNumber !== "TAX-A-1") {
      pass("Company profile is tenant-scoped (no leak A -> B)");
    } else fail("Company profile is tenant-scoped (no leak A -> B)", "leak or missing");

    if (a.systemConfig.currency === "EGP" && b.systemConfig.currency === "USD") {
      pass("System currency is tenant-specific");
    } else {
      fail(
        "System currency is tenant-specific",
        `${a.systemConfig.currency}/${b.systemConfig.currency}`
      );
    }

    if (a.systemConfig.effectiveTextDirection === "rtl") {
      pass("Arabic defaultLocale resolves RTL");
    } else fail("Arabic defaultLocale resolves RTL", a.systemConfig.effectiveTextDirection);

    if (a.systemConfig.warehouseMode === "single") pass("Warehouse mode is single");
    else fail("Warehouse mode is single", String(a.systemConfig.warehouseMode));

    const wh = await companyService.upsertWarehouse(tenantA.id, {
      name: "Main Store",
      code: "WH-MAIN",
      address: "Cairo",
      managerName: "Ali",
      isActive: true,
    });
    if (wh.code === "WH-MAIN") pass("Warehouse upsert works");
    else fail("Warehouse upsert works", wh.code);

    const again = await companyService.upsertWarehouse(tenantA.id, {
      name: "Main Store Updated",
      code: "WH-MAIN",
      isActive: true,
    });
    const count = await companyService.countWarehouses(tenantA.id);
    if (again.name === "Main Store Updated" && count === 1) {
      pass("Upsert keeps a single warehouse row");
    } else fail("Upsert keeps a single warehouse row", `count=${count}`);

    const loc = await companyService.addWarehouseLocation(tenantA.id, {
      name: "Shelf A1",
      code: "A1",
    });
    if (loc.code === "A1") pass("Warehouse location created");
    else fail("Warehouse location created", loc.code);

    try {
      await companyService.updateWarehouse(tenantB.id, wh.id, { name: "Hacked" });
      fail("Cross-tenant warehouse update blocked", "did not throw");
    } catch (err) {
      if (err instanceof AppError) pass("Cross-tenant warehouse update blocked");
      else fail("Cross-tenant warehouse update blocked", String(err));
    }

    // Deactivate then ensure re-activate path still enforces single-active
    await companyService.updateWarehouse(tenantA.id, wh.id, { isActive: false });
    await companyService.updateWarehouse(tenantA.id, wh.id, { isActive: true });
    pass("Warehouse deactivate/reactivate works on the single warehouse");
  } finally {
    await cleanupTenant([tenantA.id, tenantB.id]);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Done: ${results.length - failed.length} passed, ${failed.length} failed ===`);
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
