import "dotenv/config";
import { randomUUID } from "crypto";
import {
  DocVisibility,
  PrismaClient,
  WorkflowApproverMode,
  WorkflowDocumentType,
} from "@prisma/client";
import { createApp } from "../src/app.js";
import { AppError } from "../src/utils/AppError.js";
import { ensureDefaultTenantSaaS } from "../src/modules/tenant/tenant.service.js";
import * as lookups from "../src/modules/masterData/lookups.service.js";
import * as products from "../src/modules/masterData/products.service.js";
import * as purchasing from "../src/modules/procurement/purchasing.service.js";
import * as definitions from "../src/modules/workflow/definitions.service.js";
import * as engine from "../src/modules/workflow/engine.service.js";
import * as docs from "../src/modules/workflow/documents.service.js";
import * as notifications from "../src/modules/workflow/notifications.service.js";

const prisma = new PrismaClient();
const results: Array<{ name: string; ok: boolean }> = [];
function pass(name: string) {
  results.push({ name, ok: true });
  console.log(`[PASS] ${name}`);
}

async function cleanupOrg(id: string) {
  await prisma.notification.deleteMany({ where: { organizationId: id } });
  await prisma.approvalAction.deleteMany({ where: { organizationId: id } });
  await prisma.approvalInstance.deleteMany({ where: { organizationId: id } });
  await prisma.approvalDelegation.deleteMany({ where: { organizationId: id } });
  await prisma.workflowStep.deleteMany({ where: { organizationId: id } });
  await prisma.workflowDefinition.deleteMany({ where: { organizationId: id } });
  await prisma.docTagOnDocument.deleteMany({ where: { organizationId: id } });
  await prisma.documentLink.deleteMany({ where: { organizationId: id } });
  await prisma.documentAccess.deleteMany({ where: { organizationId: id } });
  await prisma.documentVersion.deleteMany({ where: { organizationId: id } });
  await prisma.repoDocument.deleteMany({ where: { organizationId: id } });
  await prisma.docTag.deleteMany({ where: { organizationId: id } });
  await prisma.docCategory.deleteMany({ where: { organizationId: id } });
  await prisma.purchaseRequestLine.deleteMany({ where: { organizationId: id } });
  await prisma.purchaseRequest.deleteMany({ where: { organizationId: id } });
  await prisma.productPriceHistory.deleteMany({ where: { organizationId: id } });
  await prisma.productBarcode.deleteMany({ where: { organizationId: id } });
  await prisma.productVariant.deleteMany({ where: { organizationId: id } });
  await prisma.product.deleteMany({ where: { organizationId: id } });
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
  console.log("=== Phase 16 Workflow / Documents / Notifications Tests ===\n");
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
  const allowedPhases = new Set(["16-workflow", "19-frontend-integration"]);
  if (!allowedPhases.has(String(health.phase))) {
    throw new Error(`Expected phase 16-workflow or later, got ${health.phase}`);
  }
  pass("App boots with workflow routes (phase 16)");

  const leftovers = await prisma.organization.findMany({
    where: { code: { in: ["WF_TENANT_A", "WF_TENANT_B"] } },
    select: { id: true },
  });
  for (const o of leftovers) await cleanupOrg(o.id);

  const tenantA = await prisma.organization.create({
    data: { code: "WF_TENANT_A", name: "Workflow A", defaultLocale: "en" },
  });
  const tenantB = await prisma.organization.create({
    data: { code: "WF_TENANT_B", name: "Workflow B", defaultLocale: "ar" },
  });
  await ensureDefaultTenantSaaS(tenantA.id);
  await ensureDefaultTenantSaaS(tenantB.id);

  const submitter = await prisma.user.create({
    data: {
      email: `wf-sub-${randomUUID().slice(0, 8)}@test.local`,
      passwordHash: "x",
      name: "Submitter",
    },
  });
  const approver1 = await prisma.user.create({
    data: {
      email: `wf-a1-${randomUUID().slice(0, 8)}@test.local`,
      passwordHash: "x",
      name: "Approver One",
    },
  });
  const approver2 = await prisma.user.create({
    data: {
      email: `wf-a2-${randomUUID().slice(0, 8)}@test.local`,
      passwordHash: "x",
      name: "Approver Two",
    },
  });
  const stranger = await prisma.user.create({
    data: {
      email: `wf-str-${randomUUID().slice(0, 8)}@test.local`,
      passwordHash: "x",
      name: "Stranger",
    },
  });

  const units = await lookups.listUnits(tenantA.id, { pageSize: 50 });
  const pcs = units.items.find((u) => u.code === "PCS");
  if (!pcs) throw new Error("PCS missing");
  const product = await products.createProduct(tenantA.id, {
    name: "WF Widget",
    sku: `WF-SKU-${randomUUID().slice(0, 6)}`,
    unitId: pcs.id,
    purchasePrice: 10,
    sellingPrice: 20,
  });
  pass("Tenant + users + product ready");

  // Multi-level PR workflow
  const def = await definitions.createDefinition(tenantA.id, {
    documentType: WorkflowDocumentType.PURCHASE_REQUEST,
    name: "PR dual approval",
    escalationHours: 1,
    steps: [
      {
        level: 1,
        name: "Manager",
        approverMode: WorkflowApproverMode.USER,
        userId: approver1.id,
      },
      {
        level: 2,
        name: "Director",
        approverMode: WorkflowApproverMode.USER,
        userId: approver2.id,
        canDelegate: true,
      },
    ],
  });
  if (def.steps.length !== 2) throw new Error("Expected 2 steps");
  pass("Workflow definition created");

  const pr = await purchasing.createPurchaseRequest(
    tenantA.id,
    { lines: [{ productId: product.id, quantity: 5 }] },
    submitter.id
  );
  const submitted = (await purchasing.submitPurchaseRequest(
    tenantA.id,
    pr.id,
    submitter.id
  )) as { pendingApproval?: boolean; approvalId?: string; status: string };
  if (!submitted.pendingApproval || !submitted.approvalId) {
    throw new Error("Expected pending approval after submit");
  }
  pass("PR submit starts approval instance");

  try {
    await purchasing.approvePurchaseRequest(tenantA.id, pr.id, submitter.id);
    throw new Error("Direct approve should be blocked");
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 409) throw e;
  }
  pass("Direct PR approve blocked while workflow active");

  const notifs = await notifications.listNotifications(tenantA.id, approver1.id);
  if (!notifs.some((n) => n.type === "APPROVAL_REQUEST")) {
    throw new Error("Approver1 missing APPROVAL_REQUEST notification");
  }
  pass("Approval request notification sent");

  await engine.approveInstance(tenantA.id, submitted.approvalId, approver1.id, "L1 ok");
  let inst = await engine.getApproval(tenantA.id, submitted.approvalId);
  if (inst.status !== "PENDING" || inst.currentLevel !== 2) {
    throw new Error(`Expected level 2 pending, got ${inst.status} L${inst.currentLevel}`);
  }
  pass("Level 1 approved → advances to level 2");

  await engine.delegateInstance(tenantA.id, submitted.approvalId, approver2.id, stranger.id);
  const inboxStranger = await engine.inbox(tenantA.id, stranger.id);
  if (!inboxStranger.some((i) => i.id === submitted.approvalId)) {
    throw new Error("Delegated user missing inbox item");
  }
  pass("Delegation puts item in delegate inbox");

  await engine.approveInstance(tenantA.id, submitted.approvalId, stranger.id, "L2 via delegate");
  inst = await engine.getApproval(tenantA.id, submitted.approvalId);
  if (inst.status !== "APPROVED") throw new Error("Instance should be APPROVED");
  const prFinal = await purchasing.getPurchaseRequest(tenantA.id, pr.id);
  if (prFinal.status !== "APPROVED") throw new Error("PR should be APPROVED via callback");
  pass("Multi-level approve + domain callback");

  // Amount-limit skip (second PR with high limit so both steps skip → auto domain approve)
  await definitions.updateDefinition(tenantA.id, def.id, { isActive: false });
  await definitions.createDefinition(tenantA.id, {
    documentType: WorkflowDocumentType.PURCHASE_REQUEST,
    name: "PR limit skip",
    steps: [
      {
        level: 1,
        name: "Only if > 1m",
        approverMode: WorkflowApproverMode.USER,
        userId: approver1.id,
        amountLimit: 1_000_000,
      },
    ],
  });
  const pr2 = await purchasing.createPurchaseRequest(
    tenantA.id,
    { lines: [{ productId: product.id, quantity: 1 }] },
    submitter.id
  );
  const sub2 = (await purchasing.submitPurchaseRequest(tenantA.id, pr2.id, submitter.id)) as {
    pendingApproval?: boolean;
  };
  // amount null on PR → treated as 0 → step skipped → auto approved
  if (sub2.pendingApproval) throw new Error("Expected auto-approve via amount skip");
  const pr2Final = await purchasing.getPurchaseRequest(tenantA.id, pr2.id);
  if (pr2Final.status !== "APPROVED") throw new Error("PR2 should auto-approve when steps skipped");
  pass("Amount-limit step skip auto-approves");

  // Reject path
  await definitions.createDefinition(tenantA.id, {
    documentType: WorkflowDocumentType.PURCHASE_REQUEST,
    name: "PR reject flow",
    steps: [
      {
        level: 1,
        name: "Only",
        approverMode: WorkflowApproverMode.USER,
        userId: approver1.id,
      },
    ],
  });
  const pr3 = await purchasing.createPurchaseRequest(
    tenantA.id,
    { lines: [{ productId: product.id, quantity: 2 }] },
    submitter.id
  );
  const sub3 = (await purchasing.submitPurchaseRequest(tenantA.id, pr3.id, submitter.id)) as {
    approvalId?: string;
  };
  if (!sub3.approvalId) throw new Error("Expected approval for reject test");
  try {
    await engine.rejectInstance(tenantA.id, sub3.approvalId, approver1.id, "");
    throw new Error("Empty rejection should fail");
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 400) throw e;
  }
  await engine.rejectInstance(tenantA.id, sub3.approvalId, approver1.id, "Not needed");
  const pr3Final = await purchasing.getPurchaseRequest(tenantA.id, pr3.id);
  if (pr3Final.status !== "REJECTED") throw new Error("PR3 should be REJECTED");
  const rejectNotif = await notifications.listNotifications(tenantA.id, submitter.id);
  if (!rejectNotif.some((n) => n.type === "APPROVAL_REJECTED")) {
    throw new Error("Submitter missing rejection notification");
  }
  pass("Reject requires reason + domain reject + notification");

  // Documents ACL
  const restricted = await docs.createDocument(
    tenantA.id,
    {
      title: "Secret contract",
      visibility: DocVisibility.RESTRICTED,
      access: [{ userId: approver1.id }],
      file: {
        publicId: "novex-erp/wf/secret",
        secureUrl: "https://res.cloudinary.com/demo/raw/upload/secret.pdf",
        fileName: "secret.pdf",
      },
    },
    submitter.id
  );
  await docs.addVersion(tenantA.id, restricted.id, submitter.id, {
    publicId: "novex-erp/wf/secret-v2",
    secureUrl: "https://res.cloudinary.com/demo/raw/upload/secret-v2.pdf",
    fileName: "secret-v2.pdf",
  });
  const dl = await docs.downloadDocument(tenantA.id, restricted.id, approver1.id);
  if (dl.version !== 2) throw new Error("Expected version 2 download");
  try {
    await docs.downloadDocument(tenantA.id, restricted.id, stranger.id);
    throw new Error("Stranger should not download");
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 404) throw e;
  }
  pass("Document version history + restricted download ACL");

  // Isolation
  const bDocs = await docs.listDocuments(tenantB.id, stranger.id);
  if (bDocs.some((d) => d.id === restricted.id)) throw new Error("Cross-tenant document leak");
  pass("Document tenant isolation");

  await notifications.markAllRead(tenantA.id, approver1.id);
  pass("Notifications mark-all-read");

  await cleanupOrg(tenantA.id);
  await cleanupOrg(tenantB.id);
  await prisma.user.deleteMany({
    where: { id: { in: [submitter.id, approver1.id, approver2.id, stranger.id] } },
  });
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
