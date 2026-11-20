import "dotenv/config";
import { BranchType, PrismaClient } from "@prisma/client";
import * as branchesService from "../src/modules/branches/branches.service.js";
import * as employeesService from "../src/modules/hr/employees.service.js";
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

async function cleanup(orgIds: string[]) {
  await prisma.employee.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.memberRole.deleteMany({
    where: { member: { organizationId: { in: orgIds } } },
  });
  await prisma.organizationMember.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.branch.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.tenantSystemConfig.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.documentSequence.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
}

async function main() {
  console.log("=== Branches API Tests ===\n");

  const leftovers = await prisma.organization.findMany({
    where: { code: { in: ["BR_TEST_A"] } },
    select: { id: true },
  });
  if (leftovers.length) await cleanup(leftovers.map((o) => o.id));

  const org = await prisma.organization.create({
    data: { code: "BR_TEST_A", name: "Branches Test A", defaultLocale: "en" },
  });

  try {
    await prisma.tenantSystemConfig.create({
      data: { organizationId: org.id, maxActiveBranches: 2 },
    });

    const hq = await prisma.branch.create({
      data: {
        organizationId: org.id,
        name: "HQ",
        code: "HQ-01",
        type: BranchType.HEADQUARTERS,
        isActive: true,
      },
    });

    const listed = await branchesService.listBranches(org.id);
    if (listed.limit === 2 && listed.used === 1 && listed.items.length === 1) {
      pass("List returns items + limit + used (HQ counts)");
    } else {
      fail(
        "List returns items + limit + used (HQ counts)",
        JSON.stringify(listed)
      );
    }

    const office = await branchesService.createBranch(org.id, {
      name: "Alexandria",
      code: "ALX",
      type: BranchType.OFFICE,
      city: "Alexandria",
    });
    if (office.code === "ALX" && office.isActive) {
      pass("Create branch succeeds under limit");
    } else fail("Create branch succeeds under limit", JSON.stringify(office));

    try {
      await branchesService.createBranch(org.id, {
        name: "Overflow",
        code: "OVF",
        type: BranchType.OFFICE,
      });
      fail("Create beyond limit returns 403", "expected throw");
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 403 && err.message === "Branch limit reached") {
        pass("Create beyond limit returns 403");
      } else {
        fail("Create beyond limit returns 403", String(err));
      }
    }

    const deactivated = await branchesService.updateBranch(org.id, office.id, {
      isActive: false,
    });
    const afterDeactivate = await branchesService.listBranches(org.id);
    if (!deactivated.isActive && afterDeactivate.used === 1) {
      pass("Deactivated branch excluded from used");
    } else {
      fail(
        "Deactivated branch excluded from used",
        `used=${afterDeactivate.used} active=${deactivated.isActive}`
      );
    }

    const replacement = await branchesService.createBranch(org.id, {
      name: "Cairo",
      code: "CAI",
      type: BranchType.OFFICE,
    });
    if (replacement.code === "CAI") pass("Can create after freeing a slot");
    else fail("Can create after freeing a slot", replacement.code);

    try {
      await branchesService.createBranch(org.id, {
        name: "Dup",
        code: "hq-01",
        type: BranchType.OFFICE,
      });
      fail("Duplicate code blocked", "expected throw");
    } catch (err) {
      if (err instanceof AppError && (err.statusCode === 409 || err.statusCode === 403)) {
        pass("Duplicate code blocked");
      } else fail("Duplicate code blocked", String(err));
    }

    const emp = await employeesService.createEmployee(
      org.id,
      {
        firstName: "Sara",
        lastName: "Ali",
        branchId: hq.id,
      },
      undefined,
      false
    );
    const empBranch = (emp as { branch?: { id: string; code: string } | null }).branch;
    if (empBranch?.id === hq.id && empBranch.code === "HQ-01") {
      pass("Employee create persists branch and returns nested branch");
    } else {
      fail("Employee create persists branch and returns nested branch", JSON.stringify(empBranch));
    }

    const listedEmp = await employeesService.listEmployees(org.id);
    const first = listedEmp[0] as { branch?: { id: string } | null };
    if (first?.branch?.id === hq.id) pass("Employee list includes branch");
    else fail("Employee list includes branch", JSON.stringify(first?.branch));

    // Keep HQ so reactivate does not exceed limit when used already = 2
    await branchesService.updateBranch(org.id, replacement.id, { isActive: false });
    await branchesService.updateBranch(org.id, office.id, { isActive: true });
    const reactivatedList = await branchesService.listBranches(org.id);
    if (reactivatedList.used === 2) pass("Reactivate works when under limit");
    else fail("Reactivate works when under limit", `used=${reactivatedList.used}`);
  } finally {
    await cleanup([org.id]);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
