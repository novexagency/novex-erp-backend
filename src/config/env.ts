import "dotenv/config";
import { z } from "zod";

function isHttpOriginList(value: string): boolean {
  const origins = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (origins.length === 0) return false;
  return origins.every((origin) => {
    try {
      const url = new URL(origin);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  });
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(7),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  ACCESS_COOKIE_NAME: z.string().default("novex_access"),
  REFRESH_COOKIE_NAME: z.string().default("novex_refresh"),
  TENANT_COOKIE_NAME: z.string().default("novex_tenant"),
  /** Comma-separated list of allowed browser origins (e.g. local + Vercel). */
  CORS_ORIGIN: z.string().min(1).refine(isHttpOriginList, {
    message: "CORS_ORIGIN must be a comma-separated list of http(s) origins",
  }),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@novex.com"),
  SEED_ADMIN_PASSWORD: z.string().min(6).default("123456"),
  SEED_ADMIN_NAME: z.string().default("Novex Admin"),
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  CLOUDINARY_FOLDER: z.string().default("novex-erp"),
  /** Shared secret for Central Control Panel → ERP platform API calls */
  PLATFORM_SERVICE_KEY: z.string().min(16).optional(),
  /** Optional absolute/relative directory for logical backups */
  BACKUP_DIR: z.string().optional(),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

function assertProductionSafety(data: z.infer<typeof envSchema>): void {
  if (data.NODE_ENV !== "production") return;

  const failures: string[] = [];
  const origins = data.CORS_ORIGIN.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!data.COOKIE_SECURE) failures.push("COOKIE_SECURE must be true");
  if (data.COOKIE_SAME_SITE === "none" && !data.COOKIE_SECURE) {
    failures.push("COOKIE_SAME_SITE=none requires COOKIE_SECURE=true");
  }
  if (origins.some((o) => o.startsWith("http://") && !o.includes("localhost"))) {
    failures.push("CORS_ORIGIN must use https for non-localhost production origins");
  }
  if (!data.DATABASE_URL.includes("sslmode=require")) {
    failures.push("DATABASE_URL must include sslmode=require");
  }
  if (data.JWT_ACCESS_SECRET.toLowerCase().includes("change-me")) {
    failures.push("JWT_ACCESS_SECRET must be a unique production secret");
  }
  if (data.SEED_ADMIN_PASSWORD === "123456") {
    failures.push("SEED_ADMIN_PASSWORD must not use the default development password");
  }
  if (
    data.PLATFORM_SERVICE_KEY &&
    data.PLATFORM_SERVICE_KEY.toLowerCase().includes("change-me")
  ) {
    failures.push("PLATFORM_SERVICE_KEY must not use the example placeholder");
  }

  if (failures.length === 0) return;
  console.error("Production configuration rejected:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

assertProductionSafety(parsed.data);

export const env = parsed.data;
export type Env = typeof env;
