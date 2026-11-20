import "dotenv/config";
import { randomUUID } from "crypto";
import {
  AccountingEventType,
  AccountingPeriodStatus,
  JournalStatus,
  PrismaClient,
} from "@prisma/client";
import { createApp } from "../src/app.js";
import { AppError } from "../src/utils/AppError.js";
import { ensureDefaultTenantSaaS } from "../src/modules/tenant/tenant.service.js";
import * as coa from "../src/modules/accounting/coa.service.js";
import * as journals from "../src/modules/accounting/journal.service.js";
import * as periods from "../src/modules/accounting/periods.service.js";
import * as reports from "../src/modules/accounting/reports.service.js";
import * as rules from "../src/modules/accounting/rules.service.js";
import { assertBalanced } from "../src/modules/accounting/posting.engine.js";
import * as customers from "../src/modules/crm/customers.service.js";
import * as lookups from "../src/modules/masterData/lookups.service.js";
import * as products from "../src/modules/masterData/products.service.js";
import * as sales from "../src/modules/sales/sales.service.js";
import * as treasuryAccounts from "../src/modules/finance/accounts.service.js";
import * as expenses from "../src/modules/finance/expenses.service.js";

const prisma = new PrismaClient();
const userId = randomUUID();
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
  await prisma.journalAuditLog.deleteMany({ where: { organizationId: id } });
  await prisma.journalLine.deleteMany({ where: { organizationId: id } });
  // Clear reversal links before delete
  await prisma.journalEntry.updateMany({
    where: { organizationId: id },
    data: { reversesJournalId: null },
  });
  await prisma.journalEntry.deleteMany({ where: { organizationId: id } });
  await prisma.accountingPostingRule.deleteMany({ where: { organizationId: id } });
  await prisma.accountingPeriod.deleteMany({ where: { organizationId: id } });
  await prisma.fiscalYear.deleteMany({ where: { organizationId: id } });
  await prisma.glAccount.deleteMany({ where: { organizationId: id } });
  await prisma.expenseAttachment.deleteMany({ where: { organizationId: id } });
  await prisma.expense.deleteMany({ where: { organizationId: id } });
  await prisma.treasuryMovement.deleteMany({ where: { organizationId: id } });
  await prisma.cashbox.deleteMany({ where: { organizationId: id } });
  await prisma.costCenter.deleteMany({ where: { organizationId: id } });
  await prisma.customerLedgerEntry.deleteMany({ where: { organizationId: id } });
  await prisma.salesInvoiceLine.deleteMany({ where: { organizationId: id } });
  await prisma.salesInvoice.deleteMany({ where: { organizationId: id } });
  await prisma.customer.deleteMany({ where: { organizationId: id } });
  await prisma.productBarcode.deleteMany({ where: { organizationId: id } });
  await prisma.productPriceHistory.deleteMany({ where: { organizationId: id } });
  await prisma.productVariant.deleteMany({ where: { organizationId: id } });
  await prisma.product.deleteMany({ where: { organizationId: id } });
  await prisma.unitConversion.deleteMany({ where: { organizationId: id } });
  await prisma.unitOfMeasure.deleteMany({ where: { organizationId: id } });
  await prisma.expenseCategory.deleteMany({ where: { organizationId: id } });
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
  console.log("=== Phase 12 General Ledger & Accounting Tests ===\n");
  createApp();
  pass("App boots with accounting routes");

  const leftovers = await prisma.organization.findMany({
    where: { code: { in: ["ACC_TENANT_A", "ACC_TENANT_B"] } },
    select: { id: true },
  });
  for (const o of leftovers) await cleanupOrg(o.id);

  const tenantA = await prisma.organization.create({
    data: { code: "ACC_TENANT_A", name: "Accounting A", defaultLocale: "en" },
  });
  const tenantB = await prisma.organization.create({
    data: { code: "ACC_TENANT_B", name: "Accounting B", defaultLocale: "ar" },
  });
  await ensureDefaultTenantSaaS(tenantA.id);
  await ensureDefaultTenantSaaS(tenantB.id);

  // —— Seed COA + periods + rules ——
  await coa.seedDefaults(tenantA.id);
  const glAccounts = await coa.listAccounts(tenantA.id);
  if (glAccounts.length < 10) throw new Error("Expected default COA");
  pass("Default COA + fiscal periods seeded");

  const ruleList = await rules.listPostingRules(tenantA.id);
  const salesRule = ruleList.find((r) => r.eventType === AccountingEventType.SALES_INVOICE);
  const expenseRule = ruleList.find((r) => r.eventType === AccountingEventType.EXPENSE);
  if (!salesRule?.autoPost) throw new Error("SALES_INVOICE should default autoPost=true");
  if (expenseRule?.autoPost) throw new Error("EXPENSE should default autoPost=false");
  pass("Per-type defaults: sales autoPost=true, expense autoPost=false");

  // —— Unbalanced journal rejected ——
  try {
    assertBalanced([
      { accountId: glAccounts[0].id, debit: 100, credit: 0 },
      { accountId: glAccounts[1].id, debit: 0, credit: 50 },
    ]);
    throw new Error("Should reject unbalanced");
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    pass("Unbalanced journal rejected");
  }

  // —— Sales invoice → posted journal (autoPost) ——
  const units = await lookups.listUnits(tenantA.id, { pageSize: 50 });
  const pcs = units.items.find((u) => u.code === "PCS");
  if (!pcs) throw new Error("PCS unit missing — ensureDefaultTenantSaaS should seed units");
  const product = await products.createProduct(tenantA.id, {
    name: "Acc Widget",
    sku: "ACC-SKU-1",
    unitId: pcs.id,
    purchasePrice: 40,
    sellingPrice: 100,
  });
  const customer = await customers.createCustomer(tenantA.id, {
    code: "ACC-C1",
    name: "GL Customer",
  });
  const invoice = await sales.createSalesInvoice(
    tenantA.id,
    {
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: 2, unitPrice: 100, allowManualPrice: true }],
    },
    userId
  );
  await sales.postSalesInvoice(tenantA.id, invoice.id, userId);

  const autoJe = await prisma.journalEntry.findUnique({
    where: {
      organizationId_sourceType_sourceId: {
        organizationId: tenantA.id,
        sourceType: "SALES_INVOICE",
        sourceId: invoice.id,
      },
    },
    include: { lines: true, auditLogs: true },
  });
  if (!autoJe) throw new Error("Missing auto journal for sales invoice");
  if (autoJe.status !== JournalStatus.POSTED) throw new Error(`Expected POSTED got ${autoJe.status}`);
  if (!autoJe.autoPosted) throw new Error("Expected autoPosted flag");
  if (autoJe.auditLogs.length < 2) throw new Error("Expected audit trail");
  pass("Sales invoice auto-posts balanced journal in same flow");

  // —— Duplicate source blocked ——
  try {
    await prisma.$transaction(async (tx) => {
      const { generateForSource } = await import("../src/modules/accounting/posting.engine.js");
      await generateForSource(tx, {
        organizationId: tenantA.id,
        eventType: AccountingEventType.SALES_INVOICE,
        sourceType: "SALES_INVOICE",
        sourceId: invoice.id,
        sourceCode: invoice.code,
        amount: Number(invoice.totalAmount),
        userId,
      });
    });
    throw new Error("Duplicate should fail");
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 409) throw e;
    pass("Duplicate journal for same source blocked");
  }

  // —— Expense → DRAFT journal (autoPost=false) ——
  const cash = await treasuryAccounts.createCashbox(
    tenantA.id,
    { code: "ACC-CASH", name: "Acc Cash", openingBalance: 5000 },
    userId
  );
  const cat = await lookups.createExpenseCategory(tenantA.id, { name: "Rent", code: "RENT" });
  const expense = await expenses.createExpense(
    tenantA.id,
    {
      categoryId: cat.id,
      title: "Office rent",
      amount: 500,
      cashboxId: cash.id,
      requiresApproval: false,
    },
    userId
  );
  await expenses.postExpense(tenantA.id, expense.id, userId);

  const draftJe = await prisma.journalEntry.findUnique({
    where: {
      organizationId_sourceType_sourceId: {
        organizationId: tenantA.id,
        sourceType: "EXPENSE",
        sourceId: expense.id,
      },
    },
  });
  if (!draftJe) throw new Error("Missing expense journal");
  if (draftJe.status !== JournalStatus.DRAFT) {
    throw new Error(`Expected DRAFT got ${draftJe.status}`);
  }
  pass("Expense creates DRAFT journal when autoPost=false");

  await journals.postJournal(tenantA.id, draftJe.id, userId);
  const postedExp = await prisma.journalEntry.findUniqueOrThrow({ where: { id: draftJe.id } });
  if (postedExp.status !== JournalStatus.POSTED) throw new Error("Manual post failed");
  pass("Accountant can manually post draft expense journal");

  // —— Toggle rule per type ——
  await rules.updatePostingRule(
    tenantA.id,
    AccountingEventType.EXPENSE,
    { autoPost: true },
    userId
  );
  const updatedRule = await rules.listPostingRules(tenantA.id);
  if (!updatedRule.find((r) => r.eventType === "EXPENSE")?.autoPost) {
    throw new Error("Rule autoPost update failed");
  }
  pass("Posting rule autoPost configurable per event type");

  // —— Period lock blocks posting ——
  const periodList = await periods.listPeriods(tenantA.id);
  const now = new Date();
  const current = periodList.find(
    (p) =>
      p.status === AccountingPeriodStatus.OPEN &&
      new Date(p.startDate) <= now &&
      new Date(p.endDate) >= now
  );
  if (!current) throw new Error("No open period covering today");
  await periods.lockPeriod(tenantA.id, current.id, userId);

  const ar = glAccounts.find((a) => a.systemRole === "AR")!;
  const rev = glAccounts.find((a) => a.systemRole === "REVENUE")!;
  try {
    await journals.createManualJournal(
      tenantA.id,
      {
        lines: [
          { accountId: ar.id, debit: 10, credit: 0 },
          { accountId: rev.id, debit: 0, credit: 10 },
        ],
        description: "Should fail — locked period",
      },
      userId
    );
    throw new Error("Locked period should block");
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    pass("Locked period blocks journal create/post");
  }

  try {
    await periods.reopenPeriod(tenantA.id, current.id, "test reopen", userId, false);
    throw new Error("Unauthorized reopen should fail");
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 403) throw e;
    pass("Unauthorized period reopen blocked");
  }
  await periods.reopenPeriod(tenantA.id, current.id, "authorized test reopen", userId, true);
  pass("Authorized period reopen works");

  // —— Reversal ——
  const { reversal } = await journals.reverseJournal(
    tenantA.id,
    autoJe.id,
    "correct sales posting",
    userId,
    true
  );
  const orig = await prisma.journalEntry.findUniqueOrThrow({ where: { id: autoJe.id } });
  if (orig.status !== JournalStatus.REVERSED) throw new Error("Original not marked REVERSED");
  if (reversal.status !== JournalStatus.POSTED) throw new Error("Reversal not posted");
  pass("Posted journal reversed via new reversing entry");

  // —— Reports ——
  const tb = await reports.trialBalance(tenantA.id);
  if (!tb.balanced) throw new Error("Trial balance not balanced");
  pass("Trial balance balanced");

  const is = await reports.incomeStatement(tenantA.id);
  if (typeof is.netIncome !== "number") throw new Error("Income statement missing netIncome");
  pass("Income statement generated");

  const bs = await reports.balanceSheet(tenantA.id);
  if (typeof bs.totalAssets !== "number") throw new Error("Balance sheet incomplete");
  pass("Balance sheet generated");

  // —— Tenant isolation ——
  const foreign = await coa.listAccounts(tenantB.id);
  if (foreign.length !== 0) throw new Error("Tenant B should have empty COA");
  try {
    await journals.getJournal(tenantB.id, autoJe.id);
    throw new Error("Cross-tenant journal access");
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 404) throw e;
    pass("Tenant isolation on journals");
  }

  await cleanupOrg(tenantA.id);
  await cleanupOrg(tenantB.id);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
