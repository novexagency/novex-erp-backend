import { hashPassword, verifyPassword } from "../src/lib/password.js";
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
  refreshExpiryDate,
} from "../src/lib/tokens.js";
import { loginSchema } from "../src/modules/auth/auth.validation.js";
import { createApp } from "../src/app.js";

async function runOfflineVerification() {
  console.log("--- Starting Offline Verification Tests ---\n");
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Password Hashing
  try {
    const rawPass = "Secret123456";
    const hashed = await hashPassword(rawPass);
    const valid = await verifyPassword(rawPass, hashed);
    const invalid = await verifyPassword("WrongPassword", hashed);
    assert(valid === true, "Password verification succeeds for correct password");
    assert(invalid === false, "Password verification rejects incorrect password");
  } catch (err) {
    console.error(err);
    assert(false, "Password hashing threw an exception");
  }

  // 2. Token Signing & Verification
  try {
    const payload = {
      sub: "user-uuid-1234",
      email: "test@novex.com",
      isSuperAdmin: true,
    };
    const token = signAccessToken(payload);
    const decoded = verifyAccessToken(token);
    assert(decoded.sub === payload.sub, "JWT sub matches expected subject");
    assert(decoded.email === payload.email, "JWT email matches expected email");
    assert(decoded.isSuperAdmin === true, "JWT isSuperAdmin matches expected boolean");

    const refreshTok = generateRefreshToken();
    const tokenHash = hashToken(refreshTok);
    assert(typeof refreshTok === "string" && refreshTok.length > 20, "Refresh token generated correctly");
    assert(typeof tokenHash === "string" && tokenHash.length === 64, "SHA-256 token hash generated (64 hex chars)");

    const expiry = refreshExpiryDate();
    assert(expiry.getTime() > Date.now(), "Refresh token expiry date is in the future");
  } catch (err) {
    console.error(err);
    assert(false, "Token operations threw an exception");
  }

  // 3. Validation Schemas
  try {
    const validResult = loginSchema.safeParse({ email: "user@novex.com", password: "mypassword" });
    assert(validResult.success === true, "Valid login input passes Zod validation");

    const invalidEmail = loginSchema.safeParse({ email: "invalid-email", password: "mypassword" });
    assert(invalidEmail.success === false, "Invalid email fails Zod validation");

    const emptyPass = loginSchema.safeParse({ email: "user@novex.com", password: "" });
    assert(emptyPass.success === false, "Empty password fails Zod validation");
  } catch (err) {
    console.error(err);
    assert(false, "Zod schema validation threw an exception");
  }

  // 4. Express App Initialization & Routes
  try {
    const app = createApp();
    assert(typeof app.listen === "function", "Express application instance initialized properly via createApp()");
  } catch (err) {
    console.error(err);
    assert(false, "Express app initialization threw an exception");
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runOfflineVerification().catch((err) => {
  console.error(err);
  process.exit(1);
});
