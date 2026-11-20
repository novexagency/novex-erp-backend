/**
 * Prevents accidental `prisma migrate deploy` against Neon when the checked-in
 * migration history may not match the live db-push schema evolution.
 *
 * Prefer: npx prisma db push (reviewed) OR a dedicated migration branch.
 * Override only with NOVEX_ALLOW_MIGRATE_DEPLOY=1 after human review.
 */
if (process.env.NOVEX_ALLOW_MIGRATE_DEPLOY === "1") {
  const { spawnSync } = require("node:child_process");
  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    shell: true,
  });
  process.exit(result.status ?? 1);
}

console.error("prisma migrate deploy is gated for this repository.");
console.error(
  "Schema has historically been applied with `npx prisma db push` against Neon."
);
console.error("To run migrate deploy after explicit review:");
console.error("  NOVEX_ALLOW_MIGRATE_DEPLOY=1 npm run prisma:deploy");
console.error("Otherwise apply reviewed changes with:");
console.error("  npx prisma db push");
process.exit(1);
