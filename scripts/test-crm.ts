import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import * as activities from "../src/modules/crm/activities.service.js";
import * as customers from "../src/modules/crm/customers.service.js";
import * as financial from "../src/modules/crm/financial.service.js";
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

async function cleanupOrg(id: string) {
  await prisma.customerLedgerEntry.deleteMany({ where: { organizationId: id } });
  await prisma.customerNote.deleteMany({ where: { organizationId: id } });
  await prisma.customerInteraction.deleteMany({ where: { organizationId: id } });
  await prisma.customerFollowUp.deleteMany({ where: { organizationId: id } });
  await prisma.salesOpportunity.deleteMany({ where: { organizationId: id } });
  await prisma.customerTagLink.deleteMany({ where: { organizationId: id } });
  await prisma.customer.deleteMany({ where: { organizationId: id } });
  await prisma.customerCategory.deleteMany({ where: { organizationId: id } });
  await prisma.customerGroup.deleteMany({ where: { organizationId: id } });
  await prisma.customerTag.deleteMany({ where: { organizationId: id } });
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
  console.log("=== Phase 06 CRM & Customers Tests ===\n");
  createApp();
  pass("App boots with CRM routes");

  const leftovers = await prisma.organization.findMany({
    where: { code: { in: ["CRM_TENANT_A", "CRM_TENANT_B"] } },
    select: { id: true },
  });
  for (const o of leftovers) await cleanupOrg(o.id);

  const tenantA = await prisma.organization.create({
    data: { code: "CRM_TENANT_A", name: "CRM A", defaultLocale: "en" },
  });
  const tenantB = await prisma.organization.create({
    data: { code: "CRM_TENANT_B", name: "CRM B", defaultLocale: "ar" },
  });
  await ensureDefaultTenantSaaS(tenantA.id);
  await ensureDefaultTenantSaaS(tenantB.id);

  const category = await customers.createCategory(tenantA.id, {
    name: "Wholesale",
    nameAr: "جملة",
    code: "WHL",
  });
  const group = await customers.createGroup(tenantA.id, {
    name: "VIP",
    nameAr: "مميز",
    code: "VIP",
  });
  const tag = await customers.createTag(tenantA.id, { name: "Priority", color: "#2266aa" });
  pass("Category / group / tag created");

  const customer = await customers.createCustomer(tenantA.id, {
    type: "COMPANY",
    code: "C-001",
    name: "Cairo Clinic Supply",
    nameAr: "توريد عيادات القاهرة",
    email: "ops@cairoclinic.test",
    phone: "+201000000001",
    taxNumber: "TAX-9988",
    addressLine1: "Nasr City",
    city: "Cairo",
    categoryId: category.id,
    groupId: group.id,
    creditLimit: 50000,
    paymentTermsDays: 30,
    openingBalance: 1500,
    tagIds: [tag.id],
    internalNotes: "Key account",
  });
  if (customer.code === "C-001" && customer.tags.length === 1) pass("Customer created with opening balance + tags");
  else fail("Customer created with opening balance + tags", JSON.stringify(customer));

  try {
    await customers.createCustomer(tenantA.id, {
      code: "C-001",
      name: "Dup",
    });
    fail("Duplicate customer code blocked", "did not throw");
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 409) pass("Duplicate customer code blocked");
    else fail("Duplicate customer code blocked", String(err));
  }

  const listed = await customers.listCustomers(tenantA.id, {
    search: "Cairo",
    categoryId: category.id,
    status: "ACTIVE",
  });
  if (listed.items.length === 1) pass("Search + category/status filter");
  else fail("Search + category/status filter", String(listed.items.length));

  const byTag = await customers.listCustomers(tenantA.id, { tagId: tag.id, groupId: group.id });
  if (byTag.items.length === 1) pass("Filter by group + tag");
  else fail("Filter by group + tag", String(byTag.items.length));

  await financial.addLedgerEntry(tenantA.id, customer.id, {
    type: "SALE",
    amount: 2000,
    reference: "INV-TEST-1",
    referenceType: "SALES_INVOICE",
    referenceId: "inv-1",
  });
  await financial.addLedgerEntry(tenantA.id, customer.id, {
    type: "PAYMENT",
    amount: 500,
    reference: "RCPT-1",
  });

  const summary = await financial.getFinancialSummary(tenantA.id, customer.id);
  // opening 1500 + sale 2000 - payment 500 = 3000
  if (summary.accountBalance === 3000 && summary.totalSales === 2000 && summary.totalPaid === 500) {
    pass("Financial summary (balance / sales / paid)");
  } else {
    fail("Financial summary (balance / sales / paid)", JSON.stringify(summary));
  }
  if (summary.creditLimitUtilization === 0.06) pass("Credit limit utilization");
  else fail("Credit limit utilization", String(summary.creditLimitUtilization));
  if (summary.outstandingInvoices.length === 1) pass("Outstanding invoices foundation");
  else fail("Outstanding invoices foundation", String(summary.outstandingInvoices.length));
  if (summary.paymentHistory.length === 1) pass("Payment history");
  else fail("Payment history", String(summary.paymentHistory.length));

  const statement = await financial.getCustomerStatement(tenantA.id, customer.id);
  if (statement.closingBalance === 3000 && statement.lines.length >= 3) {
    pass("Customer statement foundation");
  } else {
    fail("Customer statement foundation", JSON.stringify(statement));
  }

  await activities.addNote(tenantA.id, customer.id, "Called about overdue balance");
  await activities.addInteraction(tenantA.id, customer.id, {
    channel: "MEETING",
    subject: "Site visit",
    body: "Discussed next order",
  });
  const followUp = await activities.addFollowUp(tenantA.id, customer.id, {
    title: "Send quotation",
    dueAt: new Date(Date.now() + 86400000).toISOString(),
  });
  await activities.updateFollowUp(tenantA.id, followUp.id, { status: "DONE" });
  const opp = await activities.addOpportunity(tenantA.id, customer.id, {
    title: "Q4 scrub kits",
    amount: 12000,
    stage: "PROPOSAL",
  });
  await activities.updateOpportunity(tenantA.id, opp.id, { stage: "WON" });
  pass("CRM notes / interactions / follow-ups / opportunities");

  const timeline = await activities.getTimeline(tenantA.id, customer.id);
  if (timeline.timeline.length >= 5) pass(`Activity timeline (${timeline.timeline.length} events)`);
  else fail("Activity timeline", String(timeline.timeline.length));

  await customers.archiveCustomer(tenantA.id, customer.id);
  const afterArchive = await customers.listCustomers(tenantA.id, {});
  if (!afterArchive.items.find((c) => c.id === customer.id)) pass("Archive hides customer from default list");
  else fail("Archive hides customer from default list", "still visible");

  try {
    await customers.getCustomer(tenantB.id, customer.id);
    fail("Cross-tenant customer access blocked", "did not throw");
  } catch (err) {
    if (err instanceof AppError) pass("Cross-tenant customer access blocked");
    else fail("Cross-tenant customer access blocked", String(err));
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
