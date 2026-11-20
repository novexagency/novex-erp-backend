import "dotenv/config";
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { AppError } from "../src/utils/AppError.js";
import { ensureDefaultTenantSaaS } from "../src/modules/tenant/tenant.service.js";
import * as employees from "../src/modules/hr/employees.service.js";
import * as tasks from "../src/modules/operations/tasks.service.js";
import * as projects from "../src/modules/operations/projects.service.js";
import * as assets from "../src/modules/operations/assets.service.js";
import * as maintenance from "../src/modules/operations/maintenance.service.js";
import * as dashboard from "../src/modules/operations/dashboard.service.js";

const prisma = new PrismaClient();
const userId = randomUUID();
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function pass(name: string) {
  results.push({ name, ok: true });
  console.log(`[PASS] ${name}`);
}

async function cleanupOrg(id: string) {
  await prisma.opsMaintenanceRequest.deleteMany({ where: { organizationId: id } });
  await prisma.opsMaintenanceSchedule.deleteMany({ where: { organizationId: id } });
  await prisma.opsAssetEvent.deleteMany({ where: { organizationId: id } });
  await prisma.opsAssetDocument.deleteMany({ where: { organizationId: id } });
  await prisma.opsAsset.deleteMany({ where: { organizationId: id } });
  await prisma.opsAssetCategory.deleteMany({ where: { organizationId: id } });
  await prisma.opsTaskAssignee.deleteMany({ where: { organizationId: id } });
  await prisma.opsTaskComment.deleteMany({ where: { organizationId: id } });
  await prisma.opsTaskEvent.deleteMany({ where: { organizationId: id } });
  await prisma.opsTask.deleteMany({ where: { organizationId: id } });
  await prisma.opsMilestone.deleteMany({ where: { organizationId: id } });
  await prisma.opsProjectMember.deleteMany({ where: { organizationId: id } });
  await prisma.opsProject.deleteMany({ where: { organizationId: id } });
  await prisma.employeeCompensation.deleteMany({ where: { organizationId: id } });
  await prisma.employee.updateMany({
    where: { organizationId: id },
    data: { managerEmployeeId: null },
  });
  await prisma.employee.deleteMany({ where: { organizationId: id } });
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
  console.log("=== Phase 15 Operations Tests ===\n");
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
  if (!health.phase) {
    throw new Error(`Expected health phase, got ${health.phase}`);
  }
  pass("App boots with operations routes");

  const leftovers = await prisma.organization.findMany({
    where: { code: { in: ["OPS_TENANT_A", "OPS_TENANT_B"] } },
    select: { id: true },
  });
  for (const o of leftovers) await cleanupOrg(o.id);

  const tenantA = await prisma.organization.create({
    data: { code: "OPS_TENANT_A", name: "Ops A", defaultLocale: "en" },
  });
  const tenantB = await prisma.organization.create({
    data: { code: "OPS_TENANT_B", name: "Ops B", defaultLocale: "ar" },
  });
  await ensureDefaultTenantSaaS(tenantA.id);
  await ensureDefaultTenantSaaS(tenantB.id);

  const empA = (await employees.createEmployee(
    tenantA.id,
    { firstName: "Omar", lastName: "Ops", compensation: { baseSalary: 8000 } },
    userId,
    true
  )) as { id: string };
  const empB = (await employees.createEmployee(
    tenantB.id,
    { firstName: "Layla", lastName: "Other", compensation: { baseSalary: 7000 } },
    userId,
    true
  )) as { id: string };
  pass("Employees ready on both tenants");

  // —— Projects ——
  const project = await projects.createProject(
    tenantA.id,
    {
      name: "Warehouse Upgrade",
      status: "ACTIVE",
      managerEmployeeId: empA.id,
      budgetAmount: 50000,
      memberIds: [empA.id],
    },
    userId
  );
  if (!String(project.code).startsWith("PRJ-")) throw new Error("Bad project code");
  const milestone = await projects.createMilestone(tenantA.id, project.id, {
    code: "M1",
    name: "Phase 1",
    dueAt: new Date(Date.now() + 14 * 86400000).toISOString(),
  });
  await projects.addProjectMember(tenantA.id, project.id, empA.id, "Lead").catch((e) => {
    if (!(e instanceof AppError) || e.statusCode !== 409) throw e;
  });
  pass("Project + milestone created");

  // —— Tasks ——
  const overdueDue = new Date(Date.now() - 2 * 86400000).toISOString();
  const task = await tasks.createTask(
    tenantA.id,
    {
      title: "Install shelves",
      priority: "HIGH",
      projectId: project.id,
      milestoneId: milestone.id,
      assigneeIds: [empA.id],
      dueAt: overdueDue,
    },
    userId
  );
  if (!String(task.code).startsWith("TASK-")) throw new Error("Bad task code");
  await tasks.addComment(tenantA.id, task.id, "Need bolts", userId, empA.id);
  await tasks.updateTask(tenantA.id, task.id, { status: "IN_PROGRESS", progressPct: 40 }, userId);
  const overdueList = await tasks.listTasks(tenantA.id, { overdue: true });
  if (!overdueList.some((t) => t.id === task.id)) throw new Error("Overdue task missing");
  pass("Task workflow + overdue filter");

  // Cross-tenant isolation
  try {
    await tasks.getTask(tenantB.id, task.id);
    throw new Error("Should not read cross-tenant task");
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 404) throw e;
  }
  try {
    await tasks.createTask(tenantA.id, { title: "Bad", assigneeIds: [empB.id] }, userId);
    throw new Error("Should reject foreign assignee");
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 404) throw e;
  }
  pass("Tenant isolation on tasks");

  // —— Assets ——
  const cat = await assets.createCategory(tenantA.id, {
    code: "EQ",
    name: "Equipment",
    nameAr: "معدات",
  });
  const asset = await assets.createAsset(
    tenantA.id,
    {
      name: "Forklift-01",
      categoryId: cat.id,
      purchaseCost: 120000,
      assignedEmployeeId: empA.id,
    },
    userId
  );
  if (!String(asset.code).startsWith("AST-")) throw new Error("Bad asset code");
  await assets.addAssetDocument(tenantA.id, asset.id, {
    title: "Manual",
    publicId: "novex-erp/ops/manual",
    secureUrl: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
  });
  pass("Asset + category + document");

  // —— Maintenance ——
  const mnt = await maintenance.createMaintenanceRequest(
    tenantA.id,
    {
      assetId: asset.id,
      type: "CORRECTIVE",
      title: "Hydraulic leak",
      costAmount: 1500,
    },
    userId
  );
  if (!String(mnt.code).startsWith("MNT-")) throw new Error("Bad maintenance code");
  const assetAfter = await assets.getAsset(tenantA.id, asset.id);
  if (assetAfter.status !== "IN_REPAIR") throw new Error("Asset should be IN_REPAIR");
  await maintenance.updateMaintenanceStatus(
    tenantA.id,
    mnt.id,
    { status: "COMPLETED", costAmount: 1800 },
    userId
  );
  const assetDone = await assets.getAsset(tenantA.id, asset.id);
  if (assetDone.status !== "ACTIVE") throw new Error("Asset should return ACTIVE");

  const due = new Date("2026-12-01T00:00:00.000Z");
  const schedule = await maintenance.createPreventiveSchedule(tenantA.id, {
    assetId: asset.id,
    title: "صيانة دورية",
    intervalDays: 30,
    nextDueAt: due.toISOString(),
  });
  const beforeNext = new Date(schedule.nextDueAt).getTime();
  const completedOcc = await maintenance.completeScheduleOccurrence(
    tenantA.id,
    schedule.id,
    userId
  );
  if (completedOcc.type !== "PREVENTIVE" || completedOcc.status !== "COMPLETED") {
    throw new Error("Preventive occurrence not completed");
  }
  const refreshed = await prisma.opsMaintenanceSchedule.findUniqueOrThrow({
    where: { id: schedule.id },
  });
  const expectedNext = beforeNext + 30 * 86400000;
  if (Math.abs(new Date(refreshed.nextDueAt).getTime() - expectedNext) > 1000) {
    throw new Error(`nextDueAt not advanced by intervalDays: ${refreshed.nextDueAt}`);
  }
  try {
    await maintenance.createMaintenanceRequest(
      tenantA.id,
      { assetId: (await assets.createAsset(tenantB.id, { name: "Foreign" }, userId)).id, title: "x" },
      userId
    );
    throw new Error("Should reject foreign asset");
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 404) throw e;
  }
  pass("Maintenance corrective + preventive schedule");

  // —— Project report + dashboard ——
  await projects.updateProject(tenantA.id, project.id, { actualCost: 12000, progressPct: 35 });
  const report = await projects.projectReport(tenantA.id, project.id);
  if (report.budget.budgetAmount !== 50000) throw new Error("Budget mismatch");
  if (report.tasks.total < 1) throw new Error("Report tasks missing");
  if (!report.tasks.byStatus || typeof report.tasks.byStatus.IN_PROGRESS !== "number") {
    throw new Error("Report missing tasks.byStatus");
  }

  const dash = await dashboard.operationsDashboard(tenantA.id);
  if (dash.overdueTasks.count < 1) throw new Error("Dashboard overdue empty");
  if (dash.projectProgress.count < 1) throw new Error("Dashboard projects empty");
  if ((dash.assetStatus.ACTIVE ?? 0) < 1) throw new Error("Dashboard assets empty");
  pass("Project report + operations dashboard");

  // Isolation: B cannot see A's assets
  const bAssets = await assets.listAssets(tenantB.id);
  if (bAssets.some((a) => a.id === asset.id)) throw new Error("Cross-tenant asset leak");
  pass("Asset tenant isolation");

  await cleanupOrg(tenantA.id);
  await cleanupOrg(tenantB.id);
  pass("Cleanup");

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
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
