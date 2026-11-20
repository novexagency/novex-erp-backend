/**
 * Foundation tests for frontend form wiring gaps:
 * - sales order PATCH (draft only) + cancel (release reservation)
 * - tenant user create + list
 * - product zero stock + primary barcode
 * - journal unbalanced difference message + posted edit blocked
 * - document file must belong to tenant folder
 */
import "dotenv/config";
import { JournalStatus, PrismaClient, SalesDocStatus } from "@prisma/client";
import { createApp } from "../src/app.js";
import { assertBalanced } from "../src/modules/accounting/posting.engine.js";
import * as journals from "../src/modules/accounting/journal.service.js";
import * as balances from "../src/modules/inventory/balances.service.js";
import * as invDocs from "../src/modules/inventory/documents.service.js";
import * as products from "../src/modules/masterData/products.service.js";
import * as lookups from "../src/modules/masterData/lookups.service.js";
import * as customers from "../src/modules/crm/customers.service.js";
import * as sales from "../src/modules/sales/sales.service.js";
import * as tenantUsers from "../src/modules/tenant/tenantUsers.service.js";
import * as docs from "../src/modules/workflow/documents.service.js";
import { ensureDefaultTenantSaaS } from "../src/modules/tenant/tenant.service.js";
import { env } from "../src/config/env.js";
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

async function cleanupOrg(id: string) {
  await prisma.documentVersion.deleteMany({ where: { organizationId: id } });
  await prisma.docTagOnDocument.deleteMany({ where: { organizationId: id } });
  await prisma.documentAccess.deleteMany({ where: { organizationId: id } });
  await prisma.repoDocument.deleteMany({ where: { organizationId: id } });
  await prisma.journalAuditLog.deleteMany({ where: { organizationId: id } });
  await prisma.journalLine.deleteMany({ where: { organizationId: id } });
  await prisma.journalEntry.deleteMany({ where: { organizationId: id } });
  await prisma.accountingPeriod.deleteMany({ where: { organizationId: id } });
  await prisma.fiscalYear.deleteMany({ where: { organizationId: id } });
  await prisma.glAccount.deleteMany({ where: { organizationId: id } });
  await prisma.salesOrderLine.deleteMany({ where: { organizationId: id } });
  await prisma.salesOrder.deleteMany({ where: { organizationId: id } });
  await prisma.customerLedgerEntry.deleteMany({ where: { organizationId: id } });
  await prisma.customer.deleteMany({ where: { organizationId: id } });
  await prisma.stockReservationLine.deleteMany({ where: { organizationId: id } });
  await prisma.stockReservation.deleteMany({ where: { organizationId: id } });
  await prisma.inventoryMovement.deleteMany({ where: { organizationId: id } });
  await prisma.inventoryLot.deleteMany({ where: { organizationId: id } });
  await prisma.openingStockLine.deleteMany({ where: { organizationId: id } });
  await prisma.openingStock.deleteMany({ where: { organizationId: id } });
  await prisma.stockBalance.deleteMany({ where: { organizationId: id } });
  await prisma.productBarcode.deleteMany({ where: { organizationId: id } });
  await prisma.productPriceHistory.deleteMany({ where: { organizationId: id } });
  await prisma.product.deleteMany({ where: { organizationId: id } });
  await prisma.unitConversion.deleteMany({ where: { organizationId: id } });
  await prisma.unitOfMeasure.deleteMany({ where: { organizationId: id } });
  await prisma.memberRole.deleteMany({
    where: { member: { organizationId: id } },
  });
  await prisma.organizationMember.deleteMany({ where: { organizationId: id } });
  await prisma.rolePermission.deleteMany({ where: { role: { organizationId: id } } });
  await prisma.role.deleteMany({ where: { organizationId: id } });
  await prisma.warehouseLocation.deleteMany({ where: { organizationId: id } });
  await prisma.warehouse.deleteMany({ where: { organizationId: id } });
  await prisma.tenantSystemConfig.deleteMany({ where: { organizationId: id } });
  await prisma.documentSequence.deleteMany({ where: { organizationId: id } });
  await prisma.tenantModule.deleteMany({ where: { organizationId: id } });
  await prisma.tenantEntitlement.deleteMany({ where: { organizationId: id } });
  await prisma.tenantSubscription.deleteMany({ where: { organizationId: id } });
  await prisma.organization.delete({ where: { id } }).catch(() => undefined);
}

async function main() {
  console.log("=== Forms foundation tests ===\n");
  createApp();

  for (const o of await prisma.organization.findMany({
    where: { code: "FORMS_FOUNDATION" },
    select: { id: true },
  })) {
    await cleanupOrg(o.id);
  }

  const org = await prisma.organization.create({
    data: { name: "Forms Foundation", code: "FORMS_FOUNDATION", baseCurrency: "EGP" },
  });
  await ensureDefaultTenantSaaS(org.id);
  const unit =
    (await prisma.unitOfMeasure.findFirst({ where: { organizationId: org.id } })) ??
    (await lookups.createUnit(org.id, { code: "PCS", name: "Piece", nameAr: "قطعة" }));
  const customer = await customers.createCustomer(org.id, {
    type: "COMPANY",
    name: "Cust A",
    code: "C-A",
  });
  const product = await products.createProduct(org.id, {
    name: "Item A",
    sku: "SKU-A",
    unitId: unit.id,
    sellingPrice: 100,
    barcodes: [{ barcode: "BC-FOUND-001", isPrimary: true }],
  });

  // Product → zero stock + barcode
  try {
    const stock = await balances.getStockBalance(org.id, product.id);
    if (Number(stock.quantityOnHand) !== 0) throw new Error(`expected 0 got ${stock.quantityOnHand}`);
    pass("product appears in stock with qty 0");
  } catch (e) {
    fail("product appears in stock with qty 0", e instanceof Error ? e.message : String(e));
  }
  try {
    const bc = await balances.lookupByBarcode(org.id, "BC-FOUND-001");
    if (!bc || bc.product?.id !== product.id) throw new Error("barcode product mismatch");
    pass("primary barcode resolves via inventory barcode lookup");
  } catch (e) {
    fail("primary barcode resolves via inventory barcode lookup", e instanceof Error ? e.message : String(e));
  }

  // Sales update + cancel
  try {
    const order = await sales.createSalesOrder(
      org.id,
      {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: 2, unitPrice: 50 }],
      },
      undefined
    );
    const updated = await sales.updateSalesOrder(org.id, order.id, {
      customerId: customer.id,
      notes: "updated draft",
      lines: [{ productId: product.id, quantity: 3, unitPrice: 55 }],
    });
    if (updated.status !== SalesDocStatus.DRAFT) throw new Error("status not draft");
    if (Number(updated.lines[0].quantity) !== 3) throw new Error("qty not updated");

    await sales.confirmSalesOrder(org.id, order.id);
    let blocked = false;
    try {
      await sales.updateSalesOrder(org.id, order.id, {
        customerId: customer.id,
        lines: [{ productId: product.id, quantity: 1, unitPrice: 10 }],
      });
    } catch (err) {
      blocked = err instanceof AppError && err.statusCode === 400;
    }
    if (!blocked) throw new Error("expected 400 on confirmed update");

    // fresh draft → reserve → cancel releases
    const o2 = await sales.createSalesOrder(org.id, {
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: 1, unitPrice: 40 }],
    });
    // need on-hand for reserve: opening stock
    const opening = await invDocs.createOpeningStock(
      org.id,
      { lines: [{ productId: product.id, quantity: 10, unitCost: 20 }] },
      undefined
    );
    await invDocs.postOpeningStock(org.id, opening.id, undefined);
    await sales.confirmSalesOrder(org.id, o2.id);
    await sales.reserveSalesOrder(org.id, o2.id);
    const cancelled = await sales.cancelSalesOrder(org.id, o2.id, { reason: "عميل ألغى" });
    if (cancelled.status !== SalesDocStatus.CANCELLED) throw new Error("not cancelled");
    if (cancelled.reservationStatus !== "RELEASED" && cancelled.reservationId) {
      const resv = await prisma.stockReservation.findUnique({ where: { id: cancelled.reservationId } });
      if (resv?.status !== "RELEASED" && resv?.status !== "CANCELLED") {
        throw new Error(`reservation not released: ${resv?.status}`);
      }
    }
    pass("sales order draft update + cancel with reservation release");
  } catch (e) {
    fail(
      "sales order draft update + cancel with reservation release",
      e instanceof Error ? e.message : String(e)
    );
  }

  // Journal imbalance message
  try {
    let msg = "";
    try {
      assertBalanced([
        { accountId: "00000000-0000-4000-8000-000000000001", debit: 100, credit: 0 },
        { accountId: "00000000-0000-4000-8000-000000000002", debit: 0, credit: 80 },
      ]);
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    }
    if (!msg.includes("difference") && !msg.includes("فرق") && !/20/.test(msg)) {
      throw new Error(`message missing difference: ${msg}`);
    }
    pass("journal imbalance reports difference");
  } catch (e) {
    fail("journal imbalance reports difference", e instanceof Error ? e.message : String(e));
  }

  try {
    const cash = await prisma.glAccount.create({
      data: {
        organizationId: org.id,
        code: "1000",
        name: "Cash",
        type: "ASSET",
        isPostable: true,
      },
    });
    const equity = await prisma.glAccount.create({
      data: {
        organizationId: org.id,
        code: "3000",
        name: "Equity",
        type: "EQUITY",
        isPostable: true,
      },
    });
    const fy = await prisma.fiscalYear.create({
      data: {
        organizationId: org.id,
        code: "FY-T",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
      },
    });
    await prisma.accountingPeriod.create({
      data: {
        organizationId: org.id,
        fiscalYearId: fy.id,
        code: "2026-11",
        name: "Nov",
        startDate: new Date("2026-11-01"),
        endDate: new Date("2026-11-30"),
        status: "OPEN",
      },
    });
    const j = await journals.createManualJournal(org.id, {
      entryDate: "2026-11-18",
      description: "test",
      lines: [
        { accountId: cash.id, debit: 50, credit: 0 },
        { accountId: equity.id, debit: 0, credit: 50 },
      ],
    });
    await prisma.journalEntry.update({
      where: { id: j.id },
      data: { status: JournalStatus.POSTED },
    });
    let blocked = false;
    try {
      await journals.updateDraftJournal(org.id, j.id, { description: "hack" });
    } catch (err) {
      blocked = err instanceof AppError && err.statusCode === 400;
    }
    if (!blocked) throw new Error("posted journal editable");
    pass("posted journal update blocked");
  } catch (e) {
    fail("posted journal update blocked", e instanceof Error ? e.message : String(e));
  }

  // Document tenant file ownership
  try {
    let rejected = false;
    try {
      await docs.createDocument(
        org.id,
        {
          title: "Bad file",
          file: {
            publicId: `${env.CLOUDINARY_FOLDER}/other-tenant/x`,
            secureUrl: "https://res.cloudinary.com/demo/raw/upload/v1/x",
            fileName: "x.pdf",
            bytes: 10,
          },
        },
        "00000000-0000-4000-8000-000000000099"
      );
    } catch (err) {
      rejected = err instanceof AppError && (err.statusCode === 400 || err.statusCode === 403);
    }
    if (!rejected) throw new Error("accepted foreign publicId");
    pass("document rejects foreign upload publicId");
  } catch (e) {
    fail("document rejects foreign upload publicId", e instanceof Error ? e.message : String(e));
  }

  // Tenant user create
  try {
    const role = await prisma.role.create({
      data: { organizationId: org.id, name: "Staff", isSystem: false },
    });
    const created = await tenantUsers.createTenantUser(
      org.id,
      {
        email: `forms.user.${Date.now()}@example.com`,
        name: "Forms User",
        roleIds: [role.id],
        password: "TempPass12",
        membershipStatus: "ACTIVE",
      },
      {
        id: "00000000-0000-4000-8000-000000000001",
        isSuperAdmin: true,
        permissionCodes: ["users:manage"],
      }
    );
    if (!created.item?.id) throw new Error("no user");
    if (created.resetToken) throw new Error("password was set — resetToken should be null");
    const listed = await tenantUsers.listTenantUsers(org.id, { page: 1, pageSize: 20 });
    if (!listed.items.some((u) => u.id === created.item.id)) {
      throw new Error("user not in list");
    }
    pass("tenant user create + list");
  } catch (e) {
    fail("tenant user create + list", e instanceof Error ? e.message : String(e));
  }

  await cleanupOrg(org.id);
  // cleanup created user emails outside org
  await prisma.user.deleteMany({ where: { email: { startsWith: "forms.user." } } });

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
