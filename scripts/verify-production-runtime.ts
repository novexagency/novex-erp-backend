/**
 * Boots compiled server with production safety flags and checks
 * /health/live, /health/ready, and unauthenticated API rejection.
 * Does not publish a public host.
 *
 * Run after `npm run build`: npm run verify:production
 */
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import "dotenv/config";

const port = 4011;
const base = `http://127.0.0.1:${port}`;

function redact(text: string): string {
  return text.replace(/postgresql:\/\/[^@\s]+@/g, "postgresql://[redacted]@");
}

async function waitForLive(child: ReturnType<typeof spawn>, getLogs: () => string) {
  const deadline = Date.now() + 120_000;
  let last = "";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early:\n${redact(getLogs()).slice(-1500)}`);
    }
    try {
      const res = await fetch(`${base}/health/live`);
      if (res.status === 200) return;
      last = `live status ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : "not listening";
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for /health/live: ${redact(last)}`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const child = spawn(process.execPath, ["dist/server.js"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      JWT_ACCESS_SECRET: randomBytes(32).toString("hex"),
      COOKIE_SECURE: "true",
      COOKIE_SAME_SITE: "none",
      CORS_ORIGIN: "https://novexerp.vercel.app",
      SEED_ADMIN_PASSWORD: "ProdDrillPass1!",
      PLATFORM_SERVICE_KEY: randomBytes(16).toString("hex"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  child.stdout?.on("data", (c: Buffer) => {
    logs += c.toString();
  });
  child.stderr?.on("data", (c: Buffer) => {
    logs += c.toString();
  });

  const stop = () => {
    if (!child.killed) child.kill("SIGTERM");
  };

  try {
    await waitForLive(child, () => logs);
    console.log("PASS liveness /health/live");

    const ready = await fetch(`${base}/health/ready`);
    const readyBody = (await ready.json()) as { success?: boolean };
    if (ready.status !== 200 || !readyBody.success) {
      throw new Error(`Readiness failed: ${ready.status}`);
    }
    console.log("PASS readiness /health/ready");

    const unauth = await fetch(`${base}/api/v1/tenant/context`);
    if (unauth.status !== 401) {
      throw new Error(`Expected 401 for unauthenticated tenant context, got ${unauth.status}`);
    }
    console.log("PASS unauthenticated API rejected");

    const health = await fetch(`${base}/health`);
    const healthBody = (await health.json()) as { phase?: string };
    if (healthBody.phase !== "21-production-ops") {
      throw new Error(`Unexpected phase stamp: ${healthBody.phase}`);
    }
    console.log("PASS health phase 21-production-ops");

    console.log("Production runtime verification PASSED");
  } finally {
    stop();
  }
}

main().catch((err) => {
  console.error(redact(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
