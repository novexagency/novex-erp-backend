import "dotenv/config";
import { PrismaClient, BranchType, MemberStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { allPermissionDefs } from "../src/modules/rbac/permissions.catalog.js";

const prisma = new PrismaClient();

const CORE_PERMISSIONS = allPermissionDefs();

const DEFAULT_ROLES = [
  // Core system roles (existing)
  { name: "Owner", description: "Tenant Owner — complete access across all organization modules and settings" },
  { name: "Administrator", description: "Company Administrator — full operational and configuration access" },
  { name: "Manager", description: "Operational management and approvals" },
  { name: "Staff", description: "Standard operational entry and reading" },
  { name: "Auditor", description: "Read-only access across all records" },
  // Suggested user categories (not hardcoded permission boundaries)
  { name: "Department Manager", description: "Suggested category — department-level management" },
  { name: "Accountant", description: "Suggested category — finance/accounting operations" },
  { name: "Sales Employee", description: "Suggested category — sales operations" },
  { name: "Purchasing Employee", description: "Suggested category — purchasing operations" },
  { name: "Warehouse Employee", description: "Suggested category — warehouse/inventory operations" },
  { name: "HR Employee", description: "Suggested category — HR operations" },
  { name: "General Employee", description: "Suggested category — general tenant employee" },
];

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || "admin@novex.com").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || "123456";
  const name = process.env.SEED_ADMIN_NAME || "Novex Admin";

  const passwordHash = await bcrypt.hash(password, 12);

  console.log(`Seeding global permissions (${CORE_PERMISSIONS.length})...`);
  await prisma.permission.createMany({
    data: CORE_PERMISSIONS,
    skipDuplicates: true,
  });

  console.log("Seeding superadmin user...");
  const adminUser = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      passwordHash,
      isSuperAdmin: true,
      isActive: true,
    },
    create: {
      email,
      name,
      passwordHash,
      isSuperAdmin: true,
      isActive: true,
    },
  });

  console.log("Seeding default organization (tenant)...");
  const defaultOrg = await prisma.organization.upsert({
    where: { code: "NOVEX_HQ" },
    update: {
      name: "Novex ERP HQ",
      defaultLocale: "en",
      timezone: "Africa/Cairo",
    },
    create: {
      name: "Novex ERP HQ",
      code: "NOVEX_HQ",
      baseCurrency: "EGP",
      defaultLocale: "en",
      timezone: "Africa/Cairo",
      isActive: true,
    },
  });

  console.log("Seeding default branch...");
  const mainBranch = await prisma.branch.upsert({
    where: {
      organizationId_code: {
        organizationId: defaultOrg.id,
        code: "HQ-01",
      },
    },
    update: { name: "Main Headquarters" },
    create: {
      organizationId: defaultOrg.id,
      name: "Main Headquarters",
      code: "HQ-01",
      type: BranchType.HEADQUARTERS,
      city: "Cairo",
      country: "Egypt",
    },
  });

  console.log("Seeding default departments...");
  const deptNames = ["Executive", "Operations", "Finance", "Human Resources"];
  for (const deptName of deptNames) {
    await prisma.department.upsert({
      where: {
        organizationId_name: {
          organizationId: defaultOrg.id,
          name: deptName,
        },
      },
      update: {},
      create: {
        organizationId: defaultOrg.id,
        name: deptName,
      },
    });
  }

  console.log("Seeding system roles & permissions...");
  const allPermissions = await prisma.permission.findMany();
  for (const r of DEFAULT_ROLES) {
    const role = await prisma.role.upsert({
      where: {
        organizationId_name: {
          organizationId: defaultOrg.id,
          name: r.name,
        },
      },
      update: { description: r.description },
      create: {
        organizationId: defaultOrg.id,
        name: r.name,
        description: r.description,
        isSystem: true,
      },
    });

    if (r.name === "Owner" || r.name === "Administrator") {
      await prisma.rolePermission.createMany({
        data: allPermissions.map((p) => ({
          roleId: role.id,
          permissionId: p.id,
        })),
        skipDuplicates: true,
      });
    }
  }

  console.log("Linking superadmin as Organization Owner...");
  const ownerRole = await prisma.role.findFirst({
    where: { organizationId: defaultOrg.id, name: "Owner" },
  });

  const member = await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: defaultOrg.id,
        userId: adminUser.id,
      },
    },
    update: { status: MemberStatus.ACTIVE },
    create: {
      organizationId: defaultOrg.id,
      userId: adminUser.id,
      jobTitle: "Chief Executive / Founder",
      status: MemberStatus.ACTIVE,
    },
  });

  if (ownerRole) {
    await prisma.memberRole.upsert({
      where: {
        memberId_roleId_branchId: {
          memberId: member.id,
          roleId: ownerRole.id,
          branchId: mainBranch.id,
        },
      },
      update: {},
      create: {
        memberId: member.id,
        roleId: ownerRole.id,
        branchId: mainBranch.id,
      },
    });
  }

  console.log("Seeding document sequences...");
  const currentYear = new Date().getFullYear();
  const sequences = [
    { module: "SALES_INVOICE", prefix: "INV" },
    { module: "PURCHASE_ORDER", prefix: "PO" },
    { module: "WORK_ORDER", prefix: "WO" },
    { module: "STOCK_TRANSFER", prefix: "TRF" },
  ];

  for (const seq of sequences) {
    await prisma.documentSequence.upsert({
      where: {
        organizationId_module_year: {
          organizationId: defaultOrg.id,
          module: seq.module,
          year: currentYear,
        },
      },
      update: {},
      create: {
        organizationId: defaultOrg.id,
        module: seq.module,
        prefix: seq.prefix,
        year: currentYear,
        currentNumber: 0,
        padding: 4,
      },
    });
  }

  console.log("Seeding tenant SaaS defaults (subscription/modules/settings)...");
  const { ensureDefaultTenantSaaS } = await import("../src/modules/tenant/tenant.service.js");
  await ensureDefaultTenantSaaS(defaultOrg.id);

  console.log("Refreshing Owner/Administrator role permissions to full catalog...");
  const { refreshSystemRolePermissions } = await import("../src/modules/rbac/rbac.service.js");
  await refreshSystemRolePermissions(defaultOrg.id);

  console.log("Seeding platform settings...");
  await prisma.platformSetting.upsert({
    where: { key: "i18n.supportedLocales" },
    update: { value: "en,ar" },
    create: { key: "i18n.supportedLocales", value: "en,ar", type: "string" },
  });
  await prisma.platformSetting.upsert({
    where: { key: "inventory.warehouseModeDefault" },
    update: { value: "single" },
    create: {
      key: "inventory.warehouseModeDefault",
      value: "single",
      type: "string",
    },
  });

  console.log("Seed completed successfully!");
}

main()
  .catch((err) => {
    console.error("Seed error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
