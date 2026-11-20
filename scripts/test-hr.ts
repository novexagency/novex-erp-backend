import "dotenv/config";
import { randomUUID } from "crypto";
import { EmploymentStatus, PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { AppError } from "../src/utils/AppError.js";
import { ensureDefaultTenantSaaS } from "../src/modules/tenant/tenant.service.js";
import * as lookups from "../src/modules/masterData/lookups.service.js";
import * as employees from "../src/modules/hr/employees.service.js";
import * as teams from "../src/modules/hr/teams.service.js";
import * as documents from "../src/modules/hr/documents.service.js";
import * as requests from "../src/modules/hr/requests.service.js";

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
  await prisma.hrRequestApproval.deleteMany({ where: { organizationId: id } });
  await prisma.hrRequest.deleteMany({ where: { organizationId: id } });
  await prisma.employeeDocument.deleteMany({ where: { organizationId: id } });
  await prisma.teamMember.deleteMany({ where: { organizationId: id } });
  await prisma.team.deleteMany({ where: { organizationId: id } });
  await prisma.employeeCompensation.deleteMany({ where: { organizationId: id } });
  // Clear manager self-refs
  await prisma.employee.updateMany({
    where: { organizationId: id },
    data: { managerEmployeeId: null },
  });
  await prisma.employee.deleteMany({ where: { organizationId: id } });
  await prisma.jobTitle.deleteMany({ where: { organizationId: id } });
  await prisma.department.deleteMany({ where: { organizationId: id } });
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
  console.log("=== Phase 13 HR & Employee Management Tests ===\n");
  createApp();
  pass("App boots with HR routes");

  const leftovers = await prisma.organization.findMany({
    where: { code: { in: ["HR_TENANT_A", "HR_TENANT_B"] } },
    select: { id: true },
  });
  for (const o of leftovers) await cleanupOrg(o.id);

  const tenantA = await prisma.organization.create({
    data: { code: "HR_TENANT_A", name: "HR A", defaultLocale: "en" },
  });
  const tenantB = await prisma.organization.create({
    data: { code: "HR_TENANT_B", name: "HR B", defaultLocale: "ar" },
  });
  await ensureDefaultTenantSaaS(tenantA.id);
  await ensureDefaultTenantSaaS(tenantB.id);

  const dept = await lookups.createDepartment(tenantA.id, {
    name: "Operations",
    code: "OPS",
  });
  const title = await lookups.createJobTitle(tenantA.id, {
    name: "Supervisor",
    code: "SUP",
    departmentId: dept.id,
  });
  pass("Department + job title ready");

  // —— Create manager without salary permission path ——
  try {
    await employees.createEmployee(
      tenantA.id,
      {
        firstName: "Blocked",
        lastName: "Salary",
        compensation: { baseSalary: 1000 },
      },
      userId,
      false
    );
    throw new Error("Should block salary without permission");
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 403) throw e;
    pass("Compensation requires hr:salary");
  }

  const manager = await employees.createEmployee(
    tenantA.id,
    {
      firstName: "Sara",
      lastName: "Manager",
      nameAr: "سارة",
      email: "sara.hr@example.com",
      departmentId: dept.id,
      jobTitleId: title.id,
      employmentType: "FULL_TIME",
      emergencyContactName: "Ali",
      emergencyContactPhone: "01000000000",
      compensation: { baseSalary: 15000, currency: "EGP", payFrequency: "MONTHLY" },
    },
    userId,
    true
  );
  if (!(manager as { compensation?: unknown }).compensation) {
    throw new Error("Expected compensation when allowed");
  }
  if (!String((manager as { employeeNumber: string }).employeeNumber).startsWith("EMP-")) {
    throw new Error("Bad employee number");
  }
  pass("Employee created with number + compensation");

  const staff = await employees.createEmployee(
    tenantA.id,
    {
      firstName: "Omar",
      lastName: "Staff",
      departmentId: dept.id,
      managerEmployeeId: (manager as { id: string }).id,
      status: EmploymentStatus.PROBATION,
    },
    userId,
    false
  );
  const staffView = await employees.getEmployee(tenantA.id, (staff as { id: string }).id, false);
  if ("compensation" in staffView && staffView.compensation) {
    throw new Error("Salary leaked without permission");
  }
  pass("Salary stripped without hr:salary on get");

  // —— Teams ——
  const team = await teams.createTeam(tenantA.id, {
    code: "SHIFT-A",
    name: "Shift A",
    departmentId: dept.id,
  });
  await teams.addTeamMember(tenantA.id, team.id, {
    employeeId: (staff as { id: string }).id,
    roleLabel: "Member",
  });
  await teams.addTeamMember(tenantA.id, team.id, {
    employeeId: (manager as { id: string }).id,
    isLead: true,
    roleLabel: "Lead",
  });
  const teamList = await teams.listTeams(tenantA.id);
  if (teamList[0].members.length !== 2) throw new Error("Team members missing");
  pass("Teams and memberships");

  // —— Documents ——
  const doc = await documents.addDocument(
    tenantA.id,
    (staff as { id: string }).id,
    {
      docType: "CONTRACT",
      title: "Employment contract",
      publicId: "hr/contracts/test-1",
      secureUrl: "https://res.cloudinary.com/demo/raw/upload/v1/hr/contracts/test-1.pdf",
      expiresAt: new Date(Date.now() + 10 * 86400000).toISOString(),
      visibility: "HR_ONLY",
    },
    userId
  );
  const expiring = await documents.expiringDocuments(tenantA.id, 30);
  if (!expiring.find((d) => d.id === doc.id)) throw new Error("Expiring doc not listed");
  await documents.archiveDocument(tenantA.id, doc.id);
  pass("Employee documents + expiry + archive");

  // —— HR requests ——
  const req = await requests.createRequest(
    tenantA.id,
    {
      type: "LEAVE",
      title: "Annual leave",
      description: "3 days",
      requesterId: (staff as { id: string }).id,
      assigneeId: (manager as { id: string }).id,
    },
    userId
  );
  await requests.submitRequest(tenantA.id, req.id, userId);
  await requests.startReview(tenantA.id, req.id, userId);
  const decided = await requests.decideRequest(
    tenantA.id,
    req.id,
    "APPROVED",
    "OK",
    userId
  );
  if (decided.status !== "APPROVED") throw new Error("Approve failed");
  if (decided.approvals.length < 3) throw new Error("Approval history incomplete");
  pass("HR request submit → review → approve with history");

  // —— Org chart ——
  const chart = await employees.orgChart(tenantA.id);
  if (chart.employees.length < 2) throw new Error("Org chart incomplete");
  pass("Org chart lists active employees");

  // —— Tenant isolation ——
  const foreign = await employees.listEmployees(tenantB.id);
  if (foreign.length !== 0) throw new Error("Cross-tenant leak");
  try {
    await employees.getEmployee(tenantB.id, (manager as { id: string }).id);
    throw new Error("Cross-tenant get should fail");
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 404) throw e;
    pass("Tenant isolation on employees");
  }

  // Platform/NOVEX users are not employees by default
  const orphanUser = await prisma.user.create({
    data: {
      email: `novex-internal-${randomUUID().slice(0, 8)}@novex.internal`,
      passwordHash: "x",
      name: "Novex Internal",
      isSuperAdmin: false,
    },
  });
  const linked = await prisma.employee.findFirst({
    where: { userId: orphanUser.id },
  });
  if (linked) throw new Error("Platform user should not auto-create employee");
  await prisma.user.delete({ where: { id: orphanUser.id } });
  pass("NOVEX/platform users stay separate from tenant employees");

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
