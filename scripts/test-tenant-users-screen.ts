/**
 * Tenant users admin screen — list shape, create+reset, auth-events scope, sessions guard.
 */
import "dotenv/config";
import { AuthEventType, PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { ensureDefaultTenantSaaS } from "../src/modules/tenant/tenant.service.js";
import * as tenantUsers from "../src/modules/tenant/tenantUsers.service.js";
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
  await prisma.memberRole.deleteMany({ where: { member: { organizationId: id } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: id } });
  await prisma.rolePermission.deleteMany({ where: { role: { organizationId: id } } });
  await prisma.role.deleteMany({ where: { organizationId: id } });
  await prisma.authEvent.deleteMany({ where: { organizationId: id } });
  await prisma.tenantModule.deleteMany({ where: { organizationId: id } });
  await prisma.tenantEntitlement.deleteMany({ where: { organizationId: id } });
  await prisma.tenantSubscription.deleteMany({ where: { organizationId: id } });
  await prisma.warehouse.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.tenantSystemConfig.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.documentSequence.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.organization.delete({ where: { id } }).catch(() => undefined);
}

async function main() {
  console.log("=== Tenant users screen tests ===\n");
  createApp();

  for (const o of await prisma.organization.findMany({
    where: { code: { in: ["USERS_SCREEN_A", "USERS_SCREEN_B"] } },
    select: { id: true },
  })) {
    await cleanupOrg(o.id);
  }

  const orgA = await prisma.organization.create({
    data: { name: "Users A", code: "USERS_SCREEN_A", baseCurrency: "EGP" },
  });
  const orgB = await prisma.organization.create({
    data: { name: "Users B", code: "USERS_SCREEN_B", baseCurrency: "EGP" },
  });
  await ensureDefaultTenantSaaS(orgA.id);
  await ensureDefaultTenantSaaS(orgB.id);

  const roleA =
    (await prisma.role.findFirst({ where: { organizationId: orgA.id } })) ??
    (await prisma.role.create({ data: { organizationId: orgA.id, name: "Staff", isSystem: false } }));
  const roleB =
    (await prisma.role.findFirst({ where: { organizationId: orgB.id } })) ??
    (await prisma.role.create({ data: { organizationId: orgB.id, name: "Staff", isSystem: false } }));

  const actor = {
    id: "00000000-0000-4000-8000-000000000001",
    isSuperAdmin: true,
    permissionCodes: ["users:manage"],
  };

  const email = `screen.user.${Date.now()}@example.com`;

  // Create without password → reset token, no password in payload
  try {
    const created = await tenantUsers.createTenantUser(
      orgA.id,
      { name: "Screen User", email, roleIds: [roleA.id] },
      actor
    );
    if (!created.resetToken) throw new Error("expected resetToken");
    if ((created as { temporaryPassword?: string }).temporaryPassword) {
      throw new Error("must not return password");
    }
    if (created.item.email !== email) throw new Error("email mismatch");
    if (!Array.isArray(created.item.roles) || !created.item.roles[0]?.id) {
      throw new Error("roles shape");
    }
    pass("create without password issues resetToken");
  } catch (e) {
    fail("create without password issues resetToken", e instanceof Error ? e.message : String(e));
  }

  // Link same email into org B
  try {
    const linked = await tenantUsers.createTenantUser(
      orgB.id,
      { name: "Screen User", email, roleIds: [roleB.id], membershipStatus: "ACTIVE" },
      actor
    );
    if (!linked.item.id) throw new Error("no id");
    if (linked.createdUser) throw new Error("should not create duplicate user");
    const users = await prisma.user.findMany({ where: { email } });
    if (users.length !== 1) throw new Error(`expected 1 user got ${users.length}`);
    pass("link existing user to another org");
  } catch (e) {
    fail("link existing user to another org", e instanceof Error ? e.message : String(e));
  }

  // List shape + search
  try {
    const list = await tenantUsers.listTenantUsers(orgA.id, {
      search: "Screen",
      status: "ACTIVE",
      page: 1,
      pageSize: 10,
    });
    const row = list.items.find((i) => i.email === email);
    if (!row) throw new Error("not found");
    for (const key of [
      "id",
      "name",
      "email",
      "isActive",
      "membershipStatus",
      "roles",
      "lastLoginAt",
      "failedLoginCount",
      "lockedUntil",
    ]) {
      if (!(key in row)) throw new Error(`missing ${key}`);
    }
    pass("list users shape + search");
  } catch (e) {
    fail("list users shape + search", e instanceof Error ? e.message : String(e));
  }

  // Auth events scoped
  try {
    const outsider = `outsider.${Date.now()}@example.com`;
    await prisma.authEvent.create({
      data: {
        type: AuthEventType.LOGIN_FAILED,
        emailAttempt: outsider,
        ipAddress: "1.1.1.1",
      },
    });
    await prisma.authEvent.create({
      data: {
        type: AuthEventType.LOGIN_FAILED,
        emailAttempt: email,
        userId: null,
        ipAddress: "2.2.2.2",
      },
    });

    const events = await tenantUsers.listTenantAuthEvents(orgA.id, {
      type: "LOGIN_FAILED",
      page: 1,
      pageSize: 50,
    });
    if (events.items.some((e) => e.emailAttempt === outsider)) {
      throw new Error("outsider leak");
    }
    if (!events.items.some((e) => e.emailAttempt === email)) {
      throw new Error("member failed attempt missing");
    }
    pass("auth-events scoped to org members");
  } catch (e) {
    fail("auth-events scoped to org members", e instanceof Error ? e.message : String(e));
  }

  // Current session guard
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const session = await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: "hash-current-test",
        expiresAt: new Date(Date.now() + 86400000),
        ipAddress: "127.0.0.1",
        userAgent: "test",
      },
    });
    // Simulate: actor is same user, current refresh matches — need real hashToken
    const { hashToken } = await import("../src/lib/tokens.js");
    const raw = "current-refresh-raw";
    await prisma.refreshToken.update({
      where: { id: session.id },
      data: { tokenHash: hashToken(raw) },
    });

    let blocked = false;
    try {
      await tenantUsers.revokeUserSession(orgA.id, user.id, session.id, {
        id: user.id,
        currentRefreshToken: raw,
        allowCurrent: false,
      });
    } catch (err) {
      blocked = err instanceof AppError && err.statusCode === 400;
    }
    if (!blocked) throw new Error("expected block on current session");

    await tenantUsers.revokeUserSession(orgA.id, user.id, session.id, {
      id: user.id,
      currentRefreshToken: raw,
      allowCurrent: true,
    });
    pass("current session revoke requires allowCurrent");
  } catch (e) {
    fail("current session revoke requires allowCurrent", e instanceof Error ? e.message : String(e));
  }

  await cleanupOrg(orgA.id);
  await cleanupOrg(orgB.id);
  await prisma.refreshToken.deleteMany({
    where: { user: { email: { startsWith: "screen.user." } } },
  });
  await prisma.passwordResetToken.deleteMany({
    where: { user: { email: { startsWith: "screen.user." } } },
  });
  await prisma.authEvent.deleteMany({
    where: { emailAttempt: { startsWith: "screen.user." } },
  });
  await prisma.authEvent.deleteMany({
    where: { emailAttempt: { startsWith: "outsider." } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: "screen.user." } } });

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
