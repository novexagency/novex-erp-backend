import "dotenv/config";
import { randomUUID } from "crypto";
import { PrismaClient, SubscriptionStatus } from "@prisma/client";
import { createApp } from "../src/app.js";
import { AppError } from "../src/utils/AppError.js";
import * as authService from "../src/modules/auth/auth.service.js";
import { assertWithinUserSeatLimit } from "../src/modules/platform/entitlements.service.js";
import { provisionTenant, getTenantDetail } from "../src/modules/platform/provision.service.js";
import * as platform from "../src/modules/platform/platform.service.js";
import { env } from "../src/config/env.js";

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
  await prisma.platformSupportAccessLog.deleteMany({ where: { organizationId: id } });
  await prisma.platformSupportAccess.deleteMany({ where: { organizationId: id } });
  await prisma.memberRole.deleteMany({
    where: { member: { organizationId: id } },
  });
  await prisma.organizationMember.deleteMany({ where: { organizationId: id } });
  await prisma.rolePermission.deleteMany({
    where: { role: { organizationId: id } },
  });
  await prisma.role.deleteMany({ where: { organizationId: id } });
  await prisma.branch.deleteMany({ where: { organizationId: id } });
  await prisma.warehouseLocation.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.warehouse.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.tenantSystemConfig.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.tenantActivity.deleteMany({ where: { organizationId: id } });
  await prisma.organizationSetting.deleteMany({ where: { organizationId: id } });
  await prisma.tenantModule.deleteMany({ where: { organizationId: id } });
  await prisma.tenantEntitlement.deleteMany({ where: { organizationId: id } });
  await prisma.tenantSubscription.deleteMany({ where: { organizationId: id } });
  await prisma.documentSequence.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.organization.delete({ where: { id } }).catch(() => undefined);
}

async function main() {
  console.log("=== Phase 18 Platform Control Tests ===\n");

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
  if (health.phase !== "19-frontend-integration" && health.phase !== "18-platform-control") {
    throw new Error(`Expected health phase 19-frontend-integration, got ${health.phase}`);
  }
  pass("App boots with platform control APIs");

  const code = `P18_${randomUUID().slice(0, 8).toUpperCase()}`;
  const leftovers = await prisma.organization.findMany({
    where: { code: { startsWith: "P18_" } },
    select: { id: true },
  });
  for (const o of leftovers) await cleanupOrg(o.id);

  const adminEmail = `p18.admin.${randomUUID().slice(0, 6)}@novex.test`;
  const tenant = await provisionTenant({
    name: "Phase 18 Control Tenant",
    code,
    planCode: "standard",
    subscriptionStatus: SubscriptionStatus.TRIAL,
    seats: 2,
    trialDays: 7,
    externalRef: `admin-client-${randomUUID().slice(0, 8)}`,
    modules: [
      { moduleCode: "SALES", enabled: true },
      { moduleCode: "HR", enabled: false },
    ],
    entitlements: [{ code: "users.max", enabled: true, limits: { max: 2 } }],
    admin: {
      email: adminEmail,
      password: "SecurePass1!",
      name: "P18 Tenant Admin",
    },
  });

  if (tenant.id && tenant.subscription?.seats === 2) {
    pass("Provision tenant with seats + trial");
  } else {
    fail("Provision tenant with seats + trial", JSON.stringify(tenant.subscription));
  }

  if (tenant.modules.find((m) => m.moduleCode === "HR" && m.enabled === false)) {
    pass("Module overrides applied on provision");
  } else {
    fail("Module overrides applied on provision", JSON.stringify(tenant.modules));
  }

  const ext = await prisma.organizationSetting.findUnique({
    where: {
      organizationId_key: {
        organizationId: tenant.id,
        key: "platform.externalRef",
      },
    },
  });
  if (ext?.value) pass("External admin-client ref stored on organization");
  else fail("External admin-client ref stored on organization", "missing");

  const updated = await platform.updateSubscription(tenant.id, {
    status: SubscriptionStatus.ACTIVE,
    seats: 2,
    renew: true,
  });
  if (updated.subscription?.status === "ACTIVE" && updated.subscription.renewedAt) {
    pass("Subscription renew + activate");
  } else {
    fail("Subscription renew + activate", JSON.stringify(updated.subscription));
  }

  await platform.setModules(tenant.id, [
    { moduleCode: "SALES", enabled: true },
    { moduleCode: "HR", enabled: true },
    { moduleCode: "REPORTS", enabled: true },
  ]);
  const afterMods = await getTenantDetail(tenant.id);
  if (afterMods.modules.find((m) => m.moduleCode === "HR" && m.enabled)) {
    pass("Modules can be re-enabled centrally");
  } else {
    fail("Modules can be re-enabled centrally", JSON.stringify(afterMods.modules));
  }

  await platform.setEntitlements(tenant.id, [
    { code: "users.max", enabled: true, limits: { max: 2 } },
    { code: "storage.uploads", enabled: true, limits: { max: 100 } },
  ]);
  pass("Entitlements upserted");

  // Seat limit: already 1 member (admin). Allow one more check before limit.
  try {
    await assertWithinUserSeatLimit(tenant.id);
    pass("Seat limit allows current member count");
  } catch (err) {
    fail("Seat limit allows current member count", String(err));
  }

  // Fill seats to max (2) then assert blocks
  const filler = await prisma.user.create({
    data: {
      email: `p18.filler.${randomUUID().slice(0, 6)}@novex.test`,
      name: "Filler",
      passwordHash: "x",
      isActive: true,
    },
  });
  await prisma.organizationMember.create({
    data: {
      organizationId: tenant.id,
      userId: filler.id,
      status: "ACTIVE",
    },
  });
  try {
    await assertWithinUserSeatLimit(tenant.id);
    fail("Seat limit blocks when full", "did not throw");
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 403) {
      pass("Seat limit blocks when full");
    } else {
      fail("Seat limit blocks when full", String(err));
    }
  }

  const staffUser = await prisma.user.findFirst({
    where: { isSuperAdmin: true },
  });
  if (!staffUser) throw new Error("No superadmin user for support-access test");

  const grant = await platform.grantSupportAccess(tenant.id, {
    staffUserId: staffUser.id,
    reason: "Phase 18 automated support access test",
    hours: 2,
    authorizedByUserId: staffUser.id,
  });
  if (grant.id && !grant.revokedAt) pass("Support access granted with reason");
  else fail("Support access granted with reason", grant.id);

  const revoked = await platform.revokeSupportAccess(grant.id, staffUser.id);
  if (revoked.revokedAt) pass("Support access revoked");
  else fail("Support access revoked", "revokedAt missing");

  const status = await platform.tenantStatus(tenant.id);
  if (status.usage?.users?.limit === 2 && status.applicationHealth) {
    pass("Tenant status exposes usage + health");
  } else {
    fail("Tenant status exposes usage + health", JSON.stringify(status.usage));
  }

  // HTTP: superadmin platform health + catalog
  const login = await authService.login(
    { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD },
    { ipAddress: "127.0.0.1" },
  );

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const base = `http://127.0.0.1:${port}`;
        const headers: Record<string, string> = {
          Cookie: `${env.ACCESS_COOKIE_NAME}=${login.tokens.accessToken}`,
          "Content-Type": "application/json",
        };

        const healthRes = await fetch(`${base}/api/v1/platform/health`, { headers });
        const healthBody = (await healthRes.json()) as {
          success?: boolean;
          data?: { phase?: string };
        };
        if (
          healthRes.ok &&
          (healthBody.data?.phase === "19-frontend-integration" ||
            healthBody.data?.phase === "18-platform-control")
        ) {
          pass("GET /platform/health (superadmin)");
        } else {
          fail("GET /platform/health (superadmin)", JSON.stringify(healthBody));
        }

        const catRes = await fetch(`${base}/api/v1/platform/modules/catalog`, { headers });
        const catBody = (await catRes.json()) as {
          success?: boolean;
          data?: { modules?: string[] };
        };
        if (catRes.ok && (catBody.data?.modules?.length ?? 0) >= 10) {
          pass("GET /platform/modules/catalog");
        } else {
          fail("GET /platform/modules/catalog", JSON.stringify(catBody));
        }

        const getRes = await fetch(`${base}/api/v1/platform/tenants/${tenant.id}`, {
          headers,
        });
        const getBody = (await getRes.json()) as {
          success?: boolean;
          data?: { tenant?: { id: string } };
        };
        if (getRes.ok && getBody.data?.tenant?.id === tenant.id) {
          pass("GET /platform/tenants/:id");
        } else {
          fail("GET /platform/tenants/:id", JSON.stringify(getBody));
        }

        if (env.PLATFORM_SERVICE_KEY) {
          const keyRes = await fetch(`${base}/api/v1/platform/health`, {
            headers: { "X-Platform-Key": env.PLATFORM_SERVICE_KEY },
          });
          const keyBody = (await keyRes.json()) as { success?: boolean };
          if (keyRes.ok && keyBody.success) {
            pass("X-Platform-Key service auth accepted");
          } else {
            fail("X-Platform-Key service auth accepted", JSON.stringify(keyBody));
          }
        } else {
          pass("X-Platform-Key skipped (PLATFORM_SERVICE_KEY unset)");
        }

        // Suspend via API → org inactive
        const sus = await fetch(
          `${base}/api/v1/platform/tenants/${tenant.id}/subscription`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ status: "SUSPENDED" }),
          },
        );
        const susBody = (await sus.json()) as {
          success?: boolean;
          data?: { tenant?: { isActive?: boolean; subscription?: { status?: string } } };
        };
        if (
          sus.ok &&
          susBody.data?.tenant?.subscription?.status === "SUSPENDED" &&
          susBody.data.tenant.isActive === false
        ) {
          pass("Suspend subscription mirrors org inactive");
        } else {
          fail("Suspend subscription mirrors org inactive", JSON.stringify(susBody));
        }

        server.close();
        resolve();
      } catch (e) {
        server.close();
        reject(e);
      }
    });
  });

  const catalog = platform.moduleCatalog();
  if (catalog.includes("WORKFLOW") && catalog.includes("REPORTS")) {
    pass("Module catalog includes Phase 16–17 codes");
  } else {
    fail("Module catalog includes Phase 16–17 codes", catalog.join(","));
  }

  // Cleanup fixture users + org
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: tenant.id },
    select: { userId: true },
  });
  await cleanupOrg(tenant.id);
  for (const m of members) {
    await prisma.refreshToken.deleteMany({ where: { userId: m.userId } }).catch(() => undefined);
    await prisma.authEvent.deleteMany({ where: { userId: m.userId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: m.userId } }).catch(() => undefined);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Results: ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length) {
    for (const f of failed) console.error(` - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
