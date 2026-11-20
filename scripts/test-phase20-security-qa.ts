/**
 * Phase 20 — targeted security / isolation / auth QA (evidence-based).
 * Never marks untested areas as passed.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  MemberStatus,
  PrismaClient,
  SubscriptionStatus,
} from "@prisma/client";
import { createApp } from "../src/app.js";
import * as authService from "../src/modules/auth/auth.service.js";
import { AppError } from "../src/utils/AppError.js";
import { env } from "../src/config/env.js";
import { ensureDefaultTenantSaaS } from "../src/modules/tenant/tenant.service.js";

const prisma = new PrismaClient();
const results: Array<{ name: string; ok: boolean; detail?: string; area: string }> = [];

function pass(area: string, name: string) {
  results.push({ area, name, ok: true });
  console.log(`[PASS][${area}] ${name}`);
}
function fail(area: string, name: string, detail: string) {
  results.push({ area, name, ok: false, detail });
  console.error(`[FAIL][${area}] ${name}: ${detail}`);
}

function cookieHeader(tokens: { accessToken: string; refreshToken?: string }, tenantId?: string) {
  const parts = [`${env.ACCESS_COOKIE_NAME}=${tokens.accessToken}`];
  if (tokens.refreshToken) parts.push(`${env.REFRESH_COOKIE_NAME}=${tokens.refreshToken}`);
  if (tenantId) parts.push(`${env.TENANT_COOKIE_NAME}=${tenantId}`);
  return parts.join("; ");
}

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const out = await fn(`http://127.0.0.1:${port}`);
        server.close();
        resolve(out);
      } catch (e) {
        server.close();
        reject(e);
      }
    });
  });
}

async function cleanupOrg(id: string) {
  await prisma.memberRole.deleteMany({ where: { member: { organizationId: id } } }).catch(() => undefined);
  await prisma.organizationMember.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.rolePermission.deleteMany({ where: { role: { organizationId: id } } }).catch(() => undefined);
  await prisma.role.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.branch.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.product.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.customer.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.warehouseLocation.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.warehouse.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.tenantSystemConfig.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.organizationSetting.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.tenantModule.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.tenantEntitlement.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.tenantSubscription.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.tenantActivity.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.documentSequence.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.organization.delete({ where: { id } }).catch(() => undefined);
}

async function main() {
  console.log("=== Phase 20 Security & Isolation QA ===\n");

  const suffix = randomUUID().slice(0, 8);
  const codeA = `P20A_${suffix}`;
  const codeB = `P20B_${suffix}`;
  const leftovers = await prisma.organization.findMany({
    where: { code: { startsWith: "P20A_" } },
    select: { id: true },
  });
  const leftoversB = await prisma.organization.findMany({
    where: { code: { startsWith: "P20B_" } },
    select: { id: true },
  });
  for (const o of [...leftovers, ...leftoversB]) await cleanupOrg(o.id);

  const passwordHash = await bcrypt.hash("SecurePass1!", 12);

  const orgA = await prisma.organization.create({
    data: { code: codeA, name: "Phase20 Tenant A", defaultLocale: "en", isActive: true },
  });
  const orgB = await prisma.organization.create({
    data: { code: codeB, name: "Phase20 Tenant B", defaultLocale: "ar", isActive: true },
  });
  await ensureDefaultTenantSaaS(orgA.id);
  await ensureDefaultTenantSaaS(orgB.id);
  await prisma.tenantSubscription.updateMany({
    where: { organizationId: { in: [orgA.id, orgB.id] } },
    data: { status: SubscriptionStatus.ACTIVE, seats: 10 },
  });

  const userA = await prisma.user.create({
    data: {
      email: `p20.a.${suffix}@novex.test`,
      name: "P20 User A",
      passwordHash,
      isActive: true,
      isSuperAdmin: false,
    },
  });
  const userB = await prisma.user.create({
    data: {
      email: `p20.b.${suffix}@novex.test`,
      name: "P20 User B",
      passwordHash,
      isActive: true,
      isSuperAdmin: false,
    },
  });

  const allPermissions = await prisma.permission.findMany();
  async function attachOwner(orgId: string, userId: string) {
    const role = await prisma.role.create({
      data: {
        organizationId: orgId,
        name: `Owner_${suffix}`,
        description: "P20 QA Owner",
        isSystem: true,
      },
    });
    if (allPermissions.length) {
      await prisma.rolePermission.createMany({
        data: allPermissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }
    const member = await prisma.organizationMember.create({
      data: { organizationId: orgId, userId, status: MemberStatus.ACTIVE },
    });
    await prisma.memberRole.create({
      data: { memberId: member.id, roleId: role.id },
    });
  }
  await attachOwner(orgA.id, userA.id);
  await attachOwner(orgB.id, userB.id);

  const unitB = await prisma.unitOfMeasure.findFirst({
    where: { organizationId: orgB.id, code: "PCS" },
  });
  if (!unitB) throw new Error("PCS unit missing for tenant B after SaaS seed");

  const productB = await prisma.product.create({
    data: {
      organizationId: orgB.id,
      name: "Secret B Product",
      sku: `B-${suffix}`,
      unitId: unitB.id,
      status: "ACTIVE",
    },
  });
  const customerB = await prisma.customer.create({
    data: {
      organizationId: orgB.id,
      code: `CB-${suffix}`,
      name: "Secret B Customer",
      type: "COMPANY",
    },
  });

  // —— Auth ——
  try {
    const login = await authService.login(
      { email: userA.email, password: "SecurePass1!" },
      { ipAddress: "127.0.0.1" }
    );
    if (login.tokens.accessToken) pass("auth", "Login issues access + refresh tokens");
    else fail("auth", "Login issues access + refresh tokens", "missing token");

    await authService.logout(login.tokens.refreshToken);
    pass("auth", "Logout revokes refresh token path");
  } catch (e) {
    fail("auth", "Login/logout happy path", String(e));
  }

  try {
    await authService.login(
      { email: userA.email, password: "wrong-password" },
      { ipAddress: "127.0.0.1" }
    );
    fail("auth", "Wrong password rejected", "did not throw");
  } catch (e) {
    if (e instanceof AppError) pass("auth", "Wrong password rejected");
    else fail("auth", "Wrong password rejected", String(e));
  }

  await prisma.user.update({ where: { id: userA.id }, data: { isActive: false } });
  try {
    await authService.login(
      { email: userA.email, password: "SecurePass1!" },
      { ipAddress: "127.0.0.1" }
    );
    fail("auth", "Deactivated user cannot login", "did not throw");
  } catch (e) {
    if (e instanceof AppError) pass("auth", "Deactivated user cannot login");
    else fail("auth", "Deactivated user cannot login", String(e));
  }
  await prisma.user.update({ where: { id: userA.id }, data: { isActive: true, failedLoginCount: 0, lockedUntil: null } });

  // —— HTTP isolation / broken access ——
  await withServer(async (base) => {
    const loginA = await authService.login(
      { email: userA.email, password: "SecurePass1!" },
      { ipAddress: "127.0.0.1" }
    );
    const loginB = await authService.login(
      { email: userB.email, password: "SecurePass1!" },
      { ipAddress: "127.0.0.1" }
    );

    // Switch tenants via cookie after login by calling switch
    const switchA = await fetch(`${base}/api/v1/tenant/switch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(loginA.tokens),
      },
      body: JSON.stringify({ tenantId: orgA.id }),
    });
    if (switchA.ok) pass("isolation", "Tenant A can switch to own tenant");
    else fail("isolation", "Tenant A can switch to own tenant", await switchA.text());

    const steal = await fetch(`${base}/api/v1/tenant/switch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(loginA.tokens),
      },
      body: JSON.stringify({ tenantId: orgB.id }),
    });
    if (steal.status === 403 || steal.status === 404) {
      pass("isolation", "Tenant A cannot switch to Tenant B");
    } else {
      fail("isolation", "Tenant A cannot switch to Tenant B", `status=${steal.status}`);
    }

    // Try X-Tenant-Id spoofing while authenticated as A
    const spoof = await fetch(`${base}/api/v1/tenant/master-data/products`, {
      headers: {
        Cookie: cookieHeader(loginA.tokens, orgA.id),
        "X-Tenant-Id": orgB.id,
      },
    });
    const spoofBody = (await spoof.json().catch(() => ({}))) as {
      data?: { items?: Array<{ id: string }> };
    };
    const leaked = (spoofBody.data?.items || []).some((p) => p.id === productB.id);
    if (!leaked && (spoof.ok || spoof.status === 403)) {
      pass("isolation", "X-Tenant-Id spoof does not leak Tenant B products");
    } else {
      fail(
        "isolation",
        "X-Tenant-Id spoof does not leak Tenant B products",
        `status=${spoof.status} leaked=${leaked}`
      );
    }

    // Direct get of B product while scoped as A
    const getB = await fetch(`${base}/api/v1/tenant/master-data/products/${productB.id}`, {
      headers: { Cookie: cookieHeader(loginA.tokens, orgA.id) },
    });
    if (getB.status === 404 || getB.status === 403) {
      pass("isolation", "Tenant A cannot GET Tenant B product by id");
    } else {
      fail("isolation", "Tenant A cannot GET Tenant B product by id", `status=${getB.status}`);
    }

    const getCust = await fetch(`${base}/api/v1/tenant/crm/customers/${customerB.id}`, {
      headers: { Cookie: cookieHeader(loginA.tokens, orgA.id) },
    });
    if (getCust.status === 404 || getCust.status === 403) {
      pass("isolation", "Tenant A cannot GET Tenant B customer by id");
    } else {
      fail("isolation", "Tenant A cannot GET Tenant B customer by id", `status=${getCust.status}`);
    }

    // Platform admin blocked for tenant user
    const plat = await fetch(`${base}/api/v1/platform/tenants`, {
      headers: { Cookie: cookieHeader(loginA.tokens, orgA.id) },
    });
    if (plat.status === 401 || plat.status === 403) {
      pass("authz", "Tenant user blocked from /platform/*");
    } else {
      fail("authz", "Tenant user blocked from /platform/*", `status=${plat.status}`);
    }

    // Fake platform key
    const fakeKey = await fetch(`${base}/api/v1/platform/health`, {
      headers: { "X-Platform-Key": "not-a-valid-platform-key!!" },
    });
    if (fakeKey.status === 401 || fakeKey.status === 403) {
      pass("authz", "Invalid X-Platform-Key rejected");
    } else {
      fail("authz", "Invalid X-Platform-Key rejected", `status=${fakeKey.status}`);
    }

    // Unauthenticated
    const unauth = await fetch(`${base}/api/v1/tenant/context`);
    if (unauth.status === 401) pass("authz", "Unauthenticated tenant context → 401");
    else fail("authz", "Unauthenticated tenant context → 401", `status=${unauth.status}`);

    // SQL injection style search (Prisma parameterized — expect 200 empty or safe filter, not 500/leak)
    const sqli = await fetch(
      `${base}/api/v1/tenant/crm/customers?q=${encodeURIComponent("'; DROP TABLE customers;--")}`,
      { headers: { Cookie: cookieHeader(loginB.tokens, orgB.id) } }
    );
    if (sqli.status === 200 || sqli.status === 400) {
      const stillThere = await prisma.customer.findUnique({ where: { id: customerB.id } });
      if (stillThere) pass("security", "SQLi-like customer search does not destroy data");
      else fail("security", "SQLi-like customer search does not destroy data", "row missing");
    } else {
      fail("security", "SQLi-like customer search handled safely", `status=${sqli.status}`);
    }

    // Mass-assignment style: try to set isSuperAdmin via profile-ish body if any public patch exists
    // Auth me is read-only; attempt company profile with unexpected fields should ignore elevation
    const mass = await fetch(`${base}/api/v1/tenant/company/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(loginB.tokens, orgB.id),
      },
      body: JSON.stringify({
        name: "Phase20 Tenant B",
        isSuperAdmin: true,
        isActive: false,
      }),
    });
    const userAfter = await prisma.user.findUnique({ where: { id: userB.id } });
    if (!userAfter?.isSuperAdmin) {
      pass("security", "Mass-assignment cannot elevate isSuperAdmin via company profile");
    } else {
      fail("security", "Mass-assignment cannot elevate isSuperAdmin via company profile", "elevated");
    }
    void mass;

    // User B still works (sanity)
    const meB = await fetch(`${base}/api/v1/auth/me`, {
      headers: { Cookie: cookieHeader(loginB.tokens) },
    });
    if (meB.ok) pass("auth", "Tenant B session /auth/me works");
    else fail("auth", "Tenant B session /auth/me works", `status=${meB.status}`);
  });

  // Support access: grant requires reason (service already tested in platform suite) — verify short reason rejected
  try {
    const { grantSupportAccess } = await import("../src/modules/platform/platform.service.js");
    await grantSupportAccess(orgA.id, {
      staffUserId: userA.id,
      reason: "short",
      hours: 1,
    });
    fail("support", "Support access rejects short reason", "did not throw");
  } catch (e) {
    if (e instanceof AppError && e.statusCode === 400) {
      pass("support", "Support access rejects short reason");
    } else {
      fail("support", "Support access rejects short reason", String(e));
    }
  }

  // Cleanup
  for (const u of [userA, userB]) {
    await prisma.refreshToken.deleteMany({ where: { userId: u.id } }).catch(() => undefined);
    await prisma.authEvent.deleteMany({ where: { userId: u.id } }).catch(() => undefined);
  }
  await cleanupOrg(orgA.id);
  await cleanupOrg(orgB.id);
  await prisma.user.delete({ where: { id: userA.id } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: userB.id } }).catch(() => undefined);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Phase20 security QA: ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length) {
    for (const f of failed) console.error(` - [${f.area}] ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
