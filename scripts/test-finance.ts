import "dotenv/config";
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { AppError } from "../src/utils/AppError.js";
import { ensureDefaultTenantSaaS } from "../src/modules/tenant/tenant.service.js";
import * as customers from "../src/modules/crm/customers.service.js";
import * as suppliers from "../src/modules/procurement/suppliers.service.js";
import * as lookups from "../src/modules/masterData/lookups.service.js";
import * as accounts from "../src/modules/finance/accounts.service.js";
import * as expenses from "../src/modules/finance/expenses.service.js";
import * as statements from "../src/modules/finance/statements.service.js";
import * as vouchers from "../src/modules/finance/vouchers.service.js";

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
  await prisma.treasuryMovement.deleteMany({ where: { organizationId: id } });
  await prisma.treasuryTransfer.deleteMany({ where: { organizationId: id } });
  await prisma.finReceiptAllocation.deleteMany({ where: { organizationId: id } });
  await prisma.finReceipt.deleteMany({ where: { organizationId: id } });
  await prisma.finPaymentAllocation.deleteMany({ where: { organizationId: id } });
  await prisma.finPayment.deleteMany({ where: { organizationId: id } });
  await prisma.expenseAttachment.deleteMany({ where: { organizationId: id } });
  await prisma.expense.deleteMany({ where: { organizationId: id } });
  await prisma.recurringExpense.deleteMany({ where: { organizationId: id } });
  await prisma.costCenter.deleteMany({ where: { organizationId: id } });
  await prisma.cashbox.deleteMany({ where: { organizationId: id } });
  await prisma.bankAccount.deleteMany({ where: { organizationId: id } });
  await prisma.customerLedgerEntry.deleteMany({ where: { organizationId: id } });
  await prisma.supplierLedgerEntry.deleteMany({ where: { organizationId: id } });
  await prisma.customer.deleteMany({ where: { organizationId: id } });
  await prisma.supplier.deleteMany({ where: { organizationId: id } });
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
  console.log("=== Phase 11 Financial Management (Treasury) Tests ===\n");
  createApp();
  pass("App boots with finance routes");

  const leftovers = await prisma.organization.findMany({
    where: { code: { in: ["FIN_TENANT_A", "FIN_TENANT_B"] } },
    select: { id: true },
  });
  for (const o of leftovers) await cleanupOrg(o.id);

  const tenantA = await prisma.organization.create({
    data: { code: "FIN_TENANT_A", name: "Finance A", defaultLocale: "en" },
  });
  const tenantB = await prisma.organization.create({
    data: { code: "FIN_TENANT_B", name: "Finance B", defaultLocale: "ar" },
  });
  await ensureDefaultTenantSaaS(tenantA.id);
  await ensureDefaultTenantSaaS(tenantB.id);

  // —— Cashbox / bank ——
  const cash = await accounts.createCashbox(
    tenantA.id,
    { code: "MAIN", name: "Main Cash", openingBalance: 1000 },
    userId
  );
  if (Number(cash.currentBalance) !== 1000) throw new Error(`Expected cash 1000 got ${cash.currentBalance}`);
  pass("Cashbox created with opening balance");

  const bank = await accounts.createBankAccount(
    tenantA.id,
    { code: "CIB1", name: "CIB Current", bankName: "CIB", openingBalance: 5000 },
    userId
  );
  if (Number(bank.currentBalance) !== 5000) throw new Error(`Expected bank 5000 got ${bank.currentBalance}`);
  pass("Bank account created with opening balance");

  // —— Manual movement ——
  await accounts.postManualMovement(
    tenantA.id,
    { cashboxId: cash.id, direction: "IN", amount: 200, note: "Petty top-up", clientRequestId: "man-1" },
    userId
  );
  const cashAfter = await prisma.cashbox.findUniqueOrThrow({ where: { id: cash.id } });
  if (Number(cashAfter.currentBalance) !== 1200) throw new Error("Manual IN failed");
  pass("Manual cash IN updates balance");

  // —— Transfer cash → bank ——
  const transfer = await accounts.createTransfer(
    tenantA.id,
    {
      amount: 300,
      fromCashboxId: cash.id,
      toBankAccountId: bank.id,
      clientRequestId: "trf-1",
    },
    userId
  );
  await accounts.postTransfer(tenantA.id, transfer.id, userId);
  const cash2 = await prisma.cashbox.findUniqueOrThrow({ where: { id: cash.id } });
  const bank2 = await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } });
  if (Number(cash2.currentBalance) !== 900) throw new Error(`Cash after transfer ${cash2.currentBalance}`);
  if (Number(bank2.currentBalance) !== 5300) throw new Error(`Bank after transfer ${bank2.currentBalance}`);
  pass("Transfer cash→bank posts both legs");

  // —— Insufficient balance blocked ——
  try {
    await accounts.postManualMovement(
      tenantA.id,
      { cashboxId: cash.id, direction: "OUT", amount: 99999 },
      userId
    );
    throw new Error("Should have blocked overdraft");
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 400) throw e;
    pass("Overdraft blocked");
  }

  // —— Customer receipt ——
  const customer = await customers.createCustomer(tenantA.id, {
    code: "FIN-C1",
    name: "Treasury Customer",
  });
  const receipt = await vouchers.createFinReceipt(
    tenantA.id,
    {
      customerId: customer.id,
      amount: 450,
      cashboxId: cash.id,
      isAdvance: true,
      clientRequestId: "rcpt-1",
    },
    userId
  );
  await vouchers.postFinReceipt(tenantA.id, receipt.id, userId);
  const cash3 = await prisma.cashbox.findUniqueOrThrow({ where: { id: cash.id } });
  if (Number(cash3.currentBalance) !== 1350) throw new Error(`Cash after receipt ${cash3.currentBalance}`);
  const ledger = await prisma.customerLedgerEntry.findMany({
    where: { organizationId: tenantA.id, customerId: customer.id },
  });
  if (ledger.length < 1) throw new Error("Customer ledger missing receipt");
  pass("Customer receipt posts to treasury + customer ledger");

  // —— Idempotent receipt ——
  const dup = await vouchers.createFinReceipt(
    tenantA.id,
    {
      customerId: customer.id,
      amount: 450,
      cashboxId: cash.id,
      clientRequestId: "rcpt-1",
    },
    userId
  );
  if (dup.id !== receipt.id) throw new Error("Idempotency failed");
  pass("Receipt clientRequestId idempotent");

  // —— Supplier payment ——
  const supplier = await suppliers.createSupplier(tenantA.id, {
    code: "FIN-S1",
    name: "Treasury Supplier",
  });
  const payment = await vouchers.createFinPayment(
    tenantA.id,
    {
      paymentType: "SUPPLIER",
      supplierId: supplier.id,
      amount: 250,
      bankAccountId: bank.id,
      clientRequestId: "pay-1",
    },
    userId
  );
  await vouchers.postFinPayment(tenantA.id, payment.id, userId);
  const bank3 = await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } });
  if (Number(bank3.currentBalance) !== 5050) throw new Error(`Bank after payment ${bank3.currentBalance}`);
  pass("Supplier payment posts to bank + supplier ledger");

  // —— Expense ——
  const cat = await lookups.createExpenseCategory(tenantA.id, {
    name: "Utilities",
    code: "UTIL",
  });
  const cc = await expenses.createCostCenter(tenantA.id, { code: "OPS", name: "Operations" });
  const expense = await expenses.createExpense(
    tenantA.id,
    {
      categoryId: cat.id,
      costCenterId: cc.id,
      title: "Electricity bill",
      amount: 150,
      cashboxId: cash.id,
      requiresApproval: true,
      clientRequestId: "exp-1",
    },
    userId
  );
  try {
    await expenses.postExpense(tenantA.id, expense.id, userId);
    throw new Error("Should require approval");
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 400) throw e;
    pass("Expense blocked until approved");
  }
  await expenses.approveExpense(tenantA.id, expense.id, userId);
  await expenses.postExpense(tenantA.id, expense.id, userId);
  const cash4 = await prisma.cashbox.findUniqueOrThrow({ where: { id: cash.id } });
  if (Number(cash4.currentBalance) !== 1200) throw new Error(`Cash after expense ${cash4.currentBalance}`);
  pass("Approved expense posts OUT from cashbox");

  // —— Cancel receipt with reverse ——
  try {
    await vouchers.cancelFinReceipt(tenantA.id, receipt.id, "mistake", userId, false);
    throw new Error("Cancel without auth should fail");
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 403) throw e;
    pass("Unauthorized cancel blocked");
  }
  await vouchers.cancelFinReceipt(tenantA.id, receipt.id, "authorized reverse", userId, true);
  const cash5 = await prisma.cashbox.findUniqueOrThrow({ where: { id: cash.id } });
  if (Number(cash5.currentBalance) !== 750) throw new Error(`Cash after cancel receipt ${cash5.currentBalance}`);
  pass("Authorized receipt cancel reverses treasury");

  // —— Statements & integrity ——
  const stmt = await statements.cashboxStatement(tenantA.id, cash.id);
  if (stmt.movements.length < 3) throw new Error("Statement missing movements");
  pass("Cashbox statement returns movements");

  const integrity = await statements.verifyTreasuryIntegrity(tenantA.id, { cashboxId: cash.id });
  if (!integrity.intact) throw new Error(`Integrity broken: ${JSON.stringify(integrity)}`);
  pass("Treasury integrity intact");

  const dash = await statements.treasuryDashboard(tenantA.id);
  if (dash.cashboxes.length < 1 || dash.banks.length < 1) throw new Error("Dashboard incomplete");
  pass("Treasury dashboard aggregates balances");

  const flow = await statements.cashFlowSummary(tenantA.id);
  if (flow.inflow <= 0) throw new Error("Cash flow missing inflows");
  pass("Cash flow summary computed");

  // —— Tenant isolation ——
  const foreign = await accounts.listCashboxes(tenantB.id);
  if (foreign.length !== 0) throw new Error("Tenant B sees A cashboxes");
  try {
    await statements.cashboxStatement(tenantB.id, cash.id);
    throw new Error("Cross-tenant statement should fail");
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 404) throw e;
    pass("Tenant isolation on cashbox statement");
  }

  // cleanup
  await cleanupOrg(tenantA.id);
  await cleanupOrg(tenantB.id);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length) {
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
