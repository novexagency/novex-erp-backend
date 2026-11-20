import { prisma } from "../src/lib/prisma.js";
import { login, refresh, me, logout } from "../src/modules/auth/auth.service.js";

async function runEndToEndVerification() {
  console.log("=== Neon Cloud PostgreSQL End-to-End Verification ===\n");
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      failed++;
    }
  }

  // 1. Direct Prisma query to Neon
  try {
    const orgCount = await prisma.organization.count();
    const userCount = await prisma.user.count();
    const branchCount = await prisma.branch.count();
    const permCount = await prisma.permission.count();
    const roleCount = await prisma.role.count();
    const seqCount = await prisma.documentSequence.count();

    console.log(`Neon Cloud Data Counts:`);
    console.log(`  - Organizations: ${orgCount}`);
    console.log(`  - Users: ${userCount}`);
    console.log(`  - Branches: ${branchCount}`);
    console.log(`  - Roles: ${roleCount}`);
    console.log(`  - Permissions: ${permCount}`);
    console.log(`  - Document Sequences: ${seqCount}\n`);

    assert(orgCount >= 1, "Organization exists in Neon database");
    assert(userCount >= 1, "Superadmin user exists in Neon database");
    assert(branchCount >= 1, "Headquarters branch exists in Neon database");
    assert(permCount >= 17, "Core ERP permissions catalog exists in Neon database");
    assert(seqCount >= 4, "Document numbering sequences initialized in Neon database");
  } catch (err) {
    console.error("Prisma query failed:", err);
    assert(false, "Prisma direct query to Neon");
  }

  // 2. Authentication: Login with seeded credentials
  let refreshToken = "";
  let userId = "";
  try {
    const loginResult = await login({
      email: "admin@novex.com",
      password: "123456",
    });

    userId = loginResult.user.id;
    refreshToken = loginResult.tokens.refreshToken;

    assert(loginResult.user.email === "admin@novex.com", "Auth Login returned correct email");
    assert(loginResult.user.isSuperAdmin === true, "Auth Login returned isSuperAdmin=true");
    assert(Boolean(loginResult.tokens.accessToken), "Auth Login generated accessToken");
    assert(Boolean(loginResult.tokens.refreshToken), "Auth Login generated refreshToken");

    const memberships = loginResult.user.memberships || [];
    assert(memberships.length > 0, "User has active organization membership");
    assert(memberships[0]?.organizationCode === "NOVEX_HQ", "Organization membership is NOVEX_HQ");
    assert(memberships[0]?.roles.includes("Owner"), "User role in organization is 'Owner'");
  } catch (err) {
    console.error("Login failed:", err);
    assert(false, "Auth login with seeded user");
  }

  // 3. User profile endpoint
  try {
    const profile = await me(userId);
    assert(profile.id === userId, "Auth me() retrieved correct user by ID");
    assert(profile.memberships?.[0]?.organizationCode === "NOVEX_HQ", "Auth me() includes organizations and roles");
  } catch (err) {
    console.error("Profile check failed:", err);
    assert(false, "Auth me()");
  }

  // 4. Token rotation (refresh)
  let newRefreshToken = "";
  try {
    const refreshResult = await refresh(refreshToken);
    newRefreshToken = refreshResult.tokens.refreshToken;
    assert(Boolean(refreshResult.tokens.accessToken), "Token refresh issued new access token");
    assert(Boolean(newRefreshToken), "Token refresh rotated refresh token");
    assert(newRefreshToken !== refreshToken, "New refresh token is distinct from old refresh token");
  } catch (err) {
    console.error("Token refresh failed:", err);
    assert(false, "Auth token rotation");
  }

  // 5. Logout (Revocation)
  try {
    await logout(newRefreshToken);
    let refreshAfterLogoutFailed = false;
    try {
      await refresh(newRefreshToken);
    } catch {
      refreshAfterLogoutFailed = true;
    }
    assert(refreshAfterLogoutFailed, "Revoked refresh token cannot be used again (logout verified)");
  } catch (err) {
    console.error("Logout check failed:", err);
    assert(false, "Auth logout revocation");
  }

  console.log(`\n=== Verification Complete: ${passed} Passed, ${failed} Failed ===`);
  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

runEndToEndVerification().catch((err) => {
  console.error("Verification error:", err);
  process.exit(1);
});
