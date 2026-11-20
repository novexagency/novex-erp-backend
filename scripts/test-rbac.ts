import "dotenv/config";
import bcrypt from "bcryptjs";
import { MemberStatus, PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { allPermissionDefs } from "../src/modules/rbac/permissions.catalog.js";
import * as rbacService from "../src/modules/rbac/rbac.service.js";
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

async function main() {
  console.log("=== Phase 04 RBAC Tests ===\n");
  createApp();
  pass("App boots with RBAC routes");

  const count = await rbacService.syncPermissionCatalog();
  if (count >= allPermissionDefs().length) pass(`Permission catalog synced (${count})`);
  else fail("Permission catalog synced", String(count));

  const tenant = await prisma.organization.upsert({
    where: { code: "RBAC_TENANT" },
    update: { isActive: true },
    create: { code: "RBAC_TENANT", name: "RBAC Tenant", defaultLocale: "en" },
  });
  await ensureDefaultTenantSaaS(tenant.id);

  // Ensure system roles exist for this tenant
  for (const name of ["Owner", "Administrator", "Staff"]) {
    await prisma.role.upsert({
      where: {
        organizationId_name: { organizationId: tenant.id, name },
      },
      update: { isSystem: name !== "Staff" },
      create: {
        organizationId: tenant.id,
        name,
        description: name,
        isSystem: name !== "Staff",
      },
    });
  }
  await rbacService.refreshSystemRolePermissions(tenant.id);

  const passwordHash = await bcrypt.hash("RbacPass1!", 12);
  const admin = await prisma.user.upsert({
    where: { email: "rbac.admin@novex.test" },
    update: { passwordHash, isActive: true, isSuperAdmin: false },
    create: {
      email: "rbac.admin@novex.test",
      name: "RBAC Admin",
      passwordHash,
      isSuperAdmin: false,
    },
  });
  const limited = await prisma.user.upsert({
    where: { email: "rbac.limited@novex.test" },
    update: { passwordHash, isActive: true, isSuperAdmin: false },
    create: {
      email: "rbac.limited@novex.test",
      name: "RBAC Limited",
      passwordHash,
      isSuperAdmin: false,
    },
  });

  const adminMember = await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: { organizationId: tenant.id, userId: admin.id },
    },
    update: { status: MemberStatus.ACTIVE },
    create: {
      organizationId: tenant.id,
      userId: admin.id,
      status: MemberStatus.ACTIVE,
    },
  });
  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: { organizationId: tenant.id, userId: limited.id },
    },
    update: { status: MemberStatus.ACTIVE },
    create: {
      organizationId: tenant.id,
      userId: limited.id,
      status: MemberStatus.ACTIVE,
    },
  });

  const ownerRole = await prisma.role.findFirstOrThrow({
    where: { organizationId: tenant.id, name: "Owner" },
  });
  await prisma.memberRole.deleteMany({ where: { memberId: adminMember.id } });
  await prisma.memberRole.create({
    data: { memberId: adminMember.id, roleId: ownerRole.id },
  });

  const custom = await rbacService.createRole(
    tenant.id,
    {
      name: "Sales Clerk",
      description: "Custom sales role",
      permissionCodes: ["sales:view", "sales:create", "customers:view"],
    },
    { permissionCodes: ["users:manage"], isSuperAdmin: false }
  );
  if (custom.name === "Sales Clerk") pass("Create custom role");
  else fail("Create custom role", custom.name);

  await rbacService.assignRole(
    tenant.id,
    { userId: limited.id, roleId: custom.id },
    { permissionCodes: ["users:manage"], isSuperAdmin: false }
  );
  pass("Assign role to user");

  try {
    await rbacService.createRole(
      tenant.id,
      {
        name: "Escalator",
        permissionCodes: ["payroll:approve", "settings:delete"],
      },
      {
        permissionCodes: ["sales:view", "sales:create"],
        isSuperAdmin: false,
      }
    );
    fail("Privilege escalation blocked", "did not throw");
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 403) {
      pass("Privilege escalation blocked");
    } else fail("Privilege escalation blocked", String(err));
  }

  try {
    await rbacService.deleteRole(tenant.id, ownerRole.id);
    fail("System role delete blocked", "did not throw");
  } catch (err) {
    if (err instanceof AppError) pass("System role delete blocked");
    else fail("System role delete blocked", String(err));
  }

  try {
    await rbacService.deleteRole(tenant.id, custom.id);
    fail("Assigned role delete blocked", "did not throw");
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 409) {
      pass("Assigned role delete blocked until unassigned");
    } else fail("Assigned role delete blocked until unassigned", String(err));
  }

  await rbacService.unassignRole(tenant.id, {
    userId: limited.id,
    roleId: custom.id,
  });
  await rbacService.deleteRole(tenant.id, custom.id);
  pass("Delete role after unassign");

  // Tenant isolation: role from another tenant
  const other = await prisma.organization.create({
    data: { code: "RBAC_OTHER", name: "Other", defaultLocale: "en" },
  });
  const otherRole = await prisma.role.create({
    data: {
      organizationId: other.id,
      name: "Foreign",
      isSystem: false,
    },
  });
  try {
    await rbacService.getRole(tenant.id, otherRole.id);
    fail("Cross-tenant role access blocked", "did not throw");
  } catch (err) {
    if (err instanceof AppError) pass("Cross-tenant role access blocked");
    else fail("Cross-tenant role access blocked", String(err));
  }

  const roles = await rbacService.listRoles(tenant.id);
  if (roles.every((r) => r)) pass(`List tenant roles (${roles.length})`);
  else fail("List tenant roles", "empty");

  // Cleanup
  await prisma.memberRole.deleteMany({
    where: { member: { organizationId: { in: [tenant.id, other.id] } } },
  });
  await prisma.rolePermission.deleteMany({
    where: { role: { organizationId: { in: [tenant.id, other.id] } } },
  });
  await prisma.role.deleteMany({
    where: { organizationId: { in: [tenant.id, other.id] } },
  });
  await prisma.organizationMember.deleteMany({
    where: { organizationId: { in: [tenant.id, other.id] } },
  });
  await prisma.tenantModule.deleteMany({
    where: { organizationId: { in: [tenant.id, other.id] } },
  });
  await prisma.tenantEntitlement.deleteMany({
    where: { organizationId: { in: [tenant.id, other.id] } },
  });
  await prisma.tenantSubscription.deleteMany({
    where: { organizationId: { in: [tenant.id, other.id] } },
  });
  await prisma.organizationSetting.deleteMany({
    where: { organizationId: { in: [tenant.id, other.id] } },
  });
  await prisma.warehouseLocation.deleteMany({
    where: { organizationId: { in: [tenant.id, other.id] } },
  });
  await prisma.warehouse.deleteMany({
    where: { organizationId: { in: [tenant.id, other.id] } },
  });
  await prisma.tenantSystemConfig.deleteMany({
    where: { organizationId: { in: [tenant.id, other.id] } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: [tenant.id, other.id] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [admin.id, limited.id] } },
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Done: ${results.length - failed.length} passed, ${failed.length} failed ===`);
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
