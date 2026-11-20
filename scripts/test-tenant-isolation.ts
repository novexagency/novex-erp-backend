import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, MemberStatus } from "@prisma/client";
import { createApp } from "../src/app.js";
import * as tenantService from "../src/modules/tenant/tenant.service.js";
import { assertSameTenant, tenantWhere } from "../src/lib/tenantDb.js";
import { AppError } from "../src/utils/AppError.js";

const prisma = new PrismaClient();

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];

function pass(name: string) {
  results.push({ name, ok: true });
  console.log(`[PASS] ${name}`);
}

function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
  console.error(`[FAIL] ${name}: ${detail}`);
}

async function main() {
  console.log("=== Phase 01 Tenant Isolation Tests ===\n");

  const app = createApp();
  if (!app) throw new Error("app failed");
  pass("Express app initializes with tenant/platform routes");

  const passwordHash = await bcrypt.hash("Isolation1!", 12);

  const tenantA = await prisma.organization.upsert({
    where: { code: "ISO_TENANT_A" },
    update: { name: "Isolation Tenant A", isActive: true },
    create: {
      name: "Isolation Tenant A",
      code: "ISO_TENANT_A",
      defaultLocale: "en",
      timezone: "Africa/Cairo",
    },
  });

  const tenantB = await prisma.organization.upsert({
    where: { code: "ISO_TENANT_B" },
    update: { name: "Isolation Tenant B", isActive: true },
    create: {
      name: "Isolation Tenant B",
      code: "ISO_TENANT_B",
      defaultLocale: "ar",
      timezone: "Africa/Cairo",
    },
  });

  const userA = await prisma.user.upsert({
    where: { email: "iso.user.a@novex.test" },
    update: { passwordHash, isActive: true, isSuperAdmin: false },
    create: {
      email: "iso.user.a@novex.test",
      name: "Isolation User A",
      passwordHash,
      isSuperAdmin: false,
    },
  });

  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: tenantA.id,
        userId: userA.id,
      },
    },
    update: { status: MemberStatus.ACTIVE },
    create: {
      organizationId: tenantA.id,
      userId: userA.id,
      status: MemberStatus.ACTIVE,
      jobTitle: "Tenant A Operator",
    },
  });

  await tenantService.ensureDefaultTenantSaaS(tenantA.id);
  await tenantService.ensureDefaultTenantSaaS(tenantB.id);

  const canA = await tenantService.userHasTenantAccess(userA.id, tenantA.id, false);
  const canB = await tenantService.userHasTenantAccess(userA.id, tenantB.id, false);

  if (canA) pass("User A has access to tenant A");
  else fail("User A has access to tenant A", "expected true");

  if (!canB) pass("User A denied access to tenant B (cross-tenant blocked)");
  else fail("User A denied access to tenant B", "expected false");

  try {
    await tenantService.buildTenantContext(userA.id, tenantB.id, false);
    fail("buildTenantContext rejects foreign tenant", "did not throw");
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 403) {
      pass("buildTenantContext rejects foreign tenant with 403");
    } else {
      fail("buildTenantContext rejects foreign tenant", String(err));
    }
  }

  try {
    await tenantService.resolveActiveTenantId({
      userId: userA.id,
      isSuperAdmin: false,
      requestedTenantId: tenantB.id,
    });
    fail("resolveActiveTenantId ignores untrusted foreign tenant id", "did not throw");
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 403) {
      pass("resolveActiveTenantId ignores untrusted foreign tenant id");
    } else {
      fail("resolveActiveTenantId ignores untrusted foreign tenant id", String(err));
    }
  }

  const resolved = await tenantService.resolveActiveTenantId({
    userId: userA.id,
    isSuperAdmin: false,
    requestedTenantId: null,
  });
  if (resolved === tenantA.id) pass("Default tenant resolves to membership tenant A");
  else fail("Default tenant resolves to membership tenant A", `got ${resolved}`);

  const where = tenantWhere(tenantA.id);
  if (where.organizationId === tenantA.id) pass("tenantWhere scopes by organizationId");
  else fail("tenantWhere scopes by organizationId", JSON.stringify(where));

  try {
    assertSameTenant(tenantB.id, tenantA.id, "Setting");
    fail("assertSameTenant blocks cross-tenant record", "did not throw");
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 404) {
      pass("assertSameTenant blocks cross-tenant record");
    } else {
      fail("assertSameTenant blocks cross-tenant record", String(err));
    }
  }

  const ctx = await tenantService.buildTenantContext(userA.id, tenantA.id, false);
  if (ctx.defaultLocale === "en" || ctx.defaultLocale === "ar") {
    pass("Tenant context exposes bilingual defaultLocale");
  } else {
    fail("Tenant context exposes bilingual defaultLocale", String(ctx.defaultLocale));
  }

  const warehouseSetting = await prisma.organizationSetting.findUnique({
    where: {
      organizationId_key: {
        organizationId: tenantA.id,
        key: "inventory.warehouseMode",
      },
    },
  });
  if (warehouseSetting?.value === "single") {
    pass("Tenant warehouse mode seeded as single");
  } else {
    fail("Tenant warehouse mode seeded as single", String(warehouseSetting?.value));
  }

  const staffCount = await prisma.platformStaff.count();
  pass(`Platform staff table exists (count=${staffCount}) — separated from tenant users`);

  const modules = await prisma.tenantModule.count({ where: { organizationId: tenantA.id } });
  if (modules >= 1) pass(`Tenant modules seeded (${modules})`);
  else fail("Tenant modules seeded", "none found");

  // Cleanup isolation fixtures (keep NOVEX_HQ intact)
  await prisma.tenantActivity.deleteMany({
    where: { organizationId: { in: [tenantA.id, tenantB.id] } },
  });
  await prisma.tenantModule.deleteMany({
    where: { organizationId: { in: [tenantA.id, tenantB.id] } },
  });
  await prisma.tenantEntitlement.deleteMany({
    where: { organizationId: { in: [tenantA.id, tenantB.id] } },
  });
  await prisma.tenantSubscription.deleteMany({
    where: { organizationId: { in: [tenantA.id, tenantB.id] } },
  });
  await prisma.organizationSetting.deleteMany({
    where: { organizationId: { in: [tenantA.id, tenantB.id] } },
  });
  await prisma.organizationMember.deleteMany({
    where: { organizationId: { in: [tenantA.id, tenantB.id] } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: [tenantA.id, tenantB.id] } },
  });
  await prisma.user.delete({ where: { id: userA.id } }).catch(() => undefined);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Done: ${results.length - failed.length} passed, ${failed.length} failed ===`);
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
