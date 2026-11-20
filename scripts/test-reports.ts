import "dotenv/config";
import { randomUUID } from "crypto";
import { PrismaClient, SalesDocStatus } from "@prisma/client";
import { createApp } from "../src/app.js";
import { ensureDefaultTenantSaaS } from "../src/modules/tenant/tenant.service.js";
import * as lookups from "../src/modules/masterData/lookups.service.js";
import * as products from "../src/modules/masterData/products.service.js";
import * as executive from "../src/modules/reports/executive.service.js";
import * as salesReports from "../src/modules/reports/sales-reports.service.js";
import * as financial from "../src/modules/reports/financial-reports.service.js";
import * as inventoryReports from "../src/modules/reports/inventory-reports.service.js";
import * as hrReports from "../src/modules/reports/hr-reports.service.js";
import { objectToTabular, renderExport, toCsv } from "../src/modules/reports/export.util.js";

const prisma = new PrismaClient();
const results: Array<{ name: string; ok: boolean }> = [];
function pass(name: string) {
  results.push({ name, ok: true });
  console.log(`[PASS] ${name}`);
}

async function cleanupOrg(id: string) {
  await prisma.salesInvoiceLine.deleteMany({ where: { organizationId: id } });
  await prisma.salesInvoice.deleteMany({ where: { organizationId: id } });
  await prisma.customerLedgerEntry.deleteMany({ where: { organizationId: id } });
  await prisma.customer.deleteMany({ where: { organizationId: id } });
  await prisma.stockBalance.deleteMany({ where: { organizationId: id } });
  await prisma.product.deleteMany({ where: { organizationId: id } });
  await prisma.expense.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.documentSequence.deleteMany({ where: { organizationId: id } });
  await prisma.warehouseLocation.deleteMany({ where: { organizationId: id } });
  await prisma.warehouse.deleteMany({ where: { organizationId: id } });
  await prisma.tenantSystemConfig.deleteMany({ where: { organizationId: id } });
  await prisma.organizationSetting.deleteMany({ where: { organizationId: id } });
  await prisma.tenantModule.deleteMany({ where: { organizationId: id } });
  await prisma.tenantEntitlement.deleteMany({ where: { organizationId: id } });
  await prisma.tenantSubscription.deleteMany({ where: { organizationId: id } });
  await prisma.organization.delete({ where: { id } });
}

async function main() {
  console.log("=== Phase 17 Reports & BI Tests ===\n");
  const app = createApp();
  const health = await new Promise<{ phase?: string }>((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        const body = (await res.json()) as { phase?: string };
        server.close();
        resolve(body);
      } catch (e) {
        server.close();
        reject(e);
      }
    });
  });
  const allowedPhases = new Set(["17-reports", "19-frontend-integration"]);
  if (!allowedPhases.has(String(health.phase))) {
    throw new Error(`Expected 17-reports or later, got ${health.phase}`);
  }
  pass("App boots with reports routes (phase 17)");

  const leftovers = await prisma.organization.findMany({
    where: { code: { in: ["RPT_TENANT_A", "RPT_TENANT_B"] } },
    select: { id: true },
  });
  for (const o of leftovers) await cleanupOrg(o.id);

  const tenantA = await prisma.organization.create({
    data: { code: "RPT_TENANT_A", name: "Reports A", defaultLocale: "en" },
  });
  const tenantB = await prisma.organization.create({
    data: { code: "RPT_TENANT_B", name: "Reports B", defaultLocale: "ar" },
  });
  await ensureDefaultTenantSaaS(tenantA.id);
  await ensureDefaultTenantSaaS(tenantB.id);

  const units = await lookups.listUnits(tenantA.id, { pageSize: 50 });
  const pcs = units.items.find((u) => u.code === "PCS");
  if (!pcs) throw new Error("PCS missing");

  const product = await products.createProduct(tenantA.id, {
    name: "Report Widget",
    sku: `RPT-${randomUUID().slice(0, 6)}`,
    unitId: pcs.id,
    purchasePrice: 50,
    sellingPrice: 100,
    minStock: 5,
  });

  const customer = await prisma.customer.create({
    data: {
      organizationId: tenantA.id,
      code: `C-${randomUUID().slice(0, 6)}`,
      name: "Acme Buyer",
      type: "COMPANY",
    },
  });

  const wh = await prisma.warehouse.findFirst({ where: { organizationId: tenantA.id } });
  if (!wh) throw new Error("Warehouse missing");
  await prisma.stockBalance.create({
    data: {
      organizationId: tenantA.id,
      warehouseId: wh.id,
      productId: product.id,
      quantityOnHand: 2,
      avgUnitCost: 50,
      totalValue: 100,
    },
  });

  const invoice = await prisma.salesInvoice.create({
    data: {
      organizationId: tenantA.id,
      code: `INV-RPT-${randomUUID().slice(0, 6)}`,
      customerId: customer.id,
      status: SalesDocStatus.POSTED,
      invoiceDate: new Date(),
      postedAt: new Date(),
      subtotal: 200,
      totalAmount: 200,
      lines: {
        create: [
          {
            organizationId: tenantA.id,
            productId: product.id,
            quantity: 2,
            unitPrice: 100,
            lineSubtotal: 200,
            lineTotal: 200,
          },
        ],
      },
    },
  });
  await prisma.customerLedgerEntry.create({
    data: {
      organizationId: tenantA.id,
      customerId: customer.id,
          type: "SALE",
          amount: 200,
          direction: "DEBIT",
          referenceType: "SALES_INVOICE",
          referenceId: invoice.id,
    },
  });
  pass("Seed sales + stock + AR");

  const dash = await executive.executiveDashboard(tenantA.id);
  if (dash.kpis.totalSales < 200) throw new Error(`Expected sales >= 200, got ${dash.kpis.totalSales}`);
  if (!dash.definitions.totalSales.includes("not profit")) {
    throw new Error("KPI definition must clarify revenue ≠ profit");
  }
  if (dash.kpis.inventoryValue < 100) throw new Error("Inventory value missing");
  if (dash.kpis.customerOutstanding < 200) throw new Error("AR outstanding missing");
  pass("Executive dashboard uses live KPIs with definitions");

  const byProduct = await salesReports.salesByProduct(tenantA.id);
  if (!byProduct.rows.some((r) => r.productId === product.id && r.revenue >= 200)) {
    throw new Error("Sales by product missing invoice line");
  }
  if (byProduct.rows[0] && byProduct.rows[0].estimatedGrossMargin == null) {
    throw new Error("Expected margin estimate when WAC present");
  }
  pass("Sales by product + margin where costing supports");

  const low = await inventoryReports.lowStock(tenantA.id);
  if (low.count < 1) throw new Error("Expected low-stock alert for qty 2 < min 5");
  pass("Low-stock report from real balances");

  const ar = await financial.customerBalances(tenantA.id);
  if (ar.totalReceivable < 200) throw new Error("Customer balances wrong");
  pass("Customer balances from ledger");

  const emp = await hrReports.employeeStats(tenantA.id);
  if (typeof emp.totalEmployees !== "number") throw new Error("Employee stats broken");
  pass("HR employee stats");

  // Isolation
  const dashB = await executive.executiveDashboard(tenantB.id);
  if (dashB.kpis.totalSales !== 0) throw new Error("Tenant B should have zero sales");
  pass("Tenant isolation on dashboard");

  // Exports
  const tabular = objectToTabular("Sales_By_Product", byProduct);
  const csv = toCsv(tabular);
  if (!csv.includes("revenue") && !csv.includes("sku")) throw new Error("CSV missing headers");
  const xlsx = await renderExport("xlsx", tabular);
  if (!(xlsx.body instanceof Buffer) || xlsx.body.length < 100) throw new Error("XLSX empty");
  const pdf = await renderExport("pdf", tabular);
  if (!(pdf.body instanceof Buffer) || pdf.body.length < 100) throw new Error("PDF empty");
  pass("CSV / Excel / PDF export");

  const from = new Date(Date.now() - 7 * 86400000).toISOString();
  const to = new Date().toISOString();
  const cmp = await executive.comparePeriods(tenantA.id, from, to);
  if (!("growth" in cmp)) throw new Error("Compare missing growth");
  pass("Period comparison");

  await cleanupOrg(tenantA.id);
  await cleanupOrg(tenantB.id);
  pass("Cleanup");

  console.log(`\n=== ${results.length}/${results.length} passed ===`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
