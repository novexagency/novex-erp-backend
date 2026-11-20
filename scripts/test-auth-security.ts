import "dotenv/config";
import bcrypt from "bcryptjs";
import { MemberStatus, PrismaClient, SubscriptionStatus } from "@prisma/client";
import * as authService from "../src/modules/auth/auth.service.js";
import { AppError } from "../src/utils/AppError.js";
import { createApp } from "../src/app.js";

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
  console.log("=== Phase 02 Auth Security Tests ===\n");
  createApp();
  pass("App boots with extended auth routes");

  const passwordHash = await bcrypt.hash("SecurePass1!", 12);

  const tenant = await prisma.organization.upsert({
    where: { code: "AUTH_SEC_TENANT" },
    update: { isActive: true, name: "Auth Security Tenant" },
    create: {
      code: "AUTH_SEC_TENANT",
      name: "Auth Security Tenant",
      defaultLocale: "en",
    },
  });

  await prisma.tenantSubscription.deleteMany({ where: { organizationId: tenant.id } });
  await prisma.tenantSubscription.create({
    data: {
      organizationId: tenant.id,
      planCode: "standard",
      status: SubscriptionStatus.ACTIVE,
      seats: 5,
    },
  });

  const user = await prisma.user.upsert({
    where: { email: "auth.sec.user@novex.test" },
    update: {
      passwordHash,
      isActive: true,
      isSuperAdmin: false,
      failedLoginCount: 0,
      lockedUntil: null,
    },
    create: {
      email: "auth.sec.user@novex.test",
      name: "Auth Sec User",
      passwordHash,
      isSuperAdmin: false,
    },
  });

  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: { organizationId: tenant.id, userId: user.id },
    },
    update: { status: MemberStatus.ACTIVE },
    create: {
      organizationId: tenant.id,
      userId: user.id,
      status: MemberStatus.ACTIVE,
    },
  });

  // Failed login does not leak whether email exists
  try {
    await authService.login(
      { email: "auth.sec.user@novex.test", password: "wrong" },
      { ipAddress: "127.0.0.1" }
    );
    fail("Wrong password rejected", "did not throw");
  } catch (err) {
    if (err instanceof AppError && err.message === "Invalid email or password") {
      pass("Wrong password rejected with generic message");
    } else fail("Wrong password rejected with generic message", String(err));
  }

  const afterFail = await prisma.user.findUnique({ where: { id: user.id } });
  if ((afterFail?.failedLoginCount ?? 0) >= 1) pass("Failed login increments counter");
  else fail("Failed login increments counter", String(afterFail?.failedLoginCount));

  const failedEvent = await prisma.authEvent.findFirst({
    where: { userId: user.id, type: "LOGIN_FAILED" },
    orderBy: { createdAt: "desc" },
  });
  if (failedEvent) pass("Failed login recorded in auth history");
  else fail("Failed login recorded in auth history", "missing event");

  const login = await authService.login(
    { email: "auth.sec.user@novex.test", password: "SecurePass1!" },
    { ipAddress: "127.0.0.1", userAgent: "phase02-test" }
  );
  if (login.tokens.accessToken && login.user.memberships?.length) {
    pass("Successful login returns tokens + tenant memberships");
  } else fail("Successful login returns tokens + tenant memberships", "incomplete");

  const reset = await authService.changePassword(
    user.id,
    { currentPassword: "SecurePass1!", newPassword: "SecurePass2!" },
    { ipAddress: "127.0.0.1" }
  );
  void reset;
  pass("Password change succeeds");

  const sessionsAfterChange = await prisma.refreshToken.count({
    where: { userId: user.id, revokedAt: null },
  });
  if (sessionsAfterChange === 0) pass("Password change revokes all sessions");
  else fail("Password change revokes all sessions", `active=${sessionsAfterChange}`);

  const issued = await authService.issuePasswordResetToken({
    targetUserId: user.id,
    createdByUserId: user.id,
  });
  await authService.confirmPasswordReset({
    token: issued.resetToken,
    newPassword: "SecurePass3!",
  });
  pass("Admin/internal password reset confirm works");

  await authService.setUserActiveState({
    targetUserId: user.id,
    isActive: false,
    actorUserId: "00000000-0000-0000-0000-000000000099",
  });

  try {
    await authService.login({
      email: "auth.sec.user@novex.test",
      password: "SecurePass3!",
    });
    fail("Deactivated user cannot login", "did not throw");
  } catch (err) {
    if (err instanceof AppError) pass("Deactivated user cannot login");
    else fail("Deactivated user cannot login", String(err));
  }

  await authService.setUserActiveState({
    targetUserId: user.id,
    isActive: true,
    actorUserId: "00000000-0000-0000-0000-000000000099",
  });

  await prisma.tenantSubscription.updateMany({
    where: { organizationId: tenant.id },
    data: { status: SubscriptionStatus.SUSPENDED },
  });

  try {
    await authService.login({
      email: "auth.sec.user@novex.test",
      password: "SecurePass3!",
    });
    fail("Suspended subscription blocks tenant login", "did not throw");
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 403) {
      pass("Suspended subscription blocks tenant login");
    } else fail("Suspended subscription blocks tenant login", String(err));
  }

  // Restore for cleanup path
  await prisma.tenantSubscription.updateMany({
    where: { organizationId: tenant.id },
    data: { status: SubscriptionStatus.ACTIVE },
  });

  const relogin = await authService.login({
    email: "auth.sec.user@novex.test",
    password: "SecurePass3!",
  });
  await authService.revokeAllSessions(user.id);
  const active = await prisma.refreshToken.count({
    where: { userId: user.id, revokedAt: null },
  });
  if (active === 0) pass("Session revocation clears active refresh tokens");
  else fail("Session revocation clears active refresh tokens", `active=${active}`);
  void relogin;

  // Cleanup
  await prisma.authEvent.deleteMany({ where: { userId: user.id } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  await prisma.organizationMember.deleteMany({ where: { userId: user.id } });
  await prisma.tenantSubscription.deleteMany({ where: { organizationId: tenant.id } });
  await prisma.organization.delete({ where: { id: tenant.id } });
  await prisma.user.delete({ where: { id: user.id } });

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
