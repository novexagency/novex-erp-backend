import "dotenv/config";
import { salesByPeriod } from "../src/modules/reports/sales-reports.service.js";
import { AppError } from "../src/utils/AppError.js";

async function main() {
  console.log("=== sales by-period bucket (unit-ish) ===\n");

  // Empty org id will fail DB — we only test validation paths with fake tenant if needed.
  // Bucket without from/to
  try {
    await salesByPeriod("00000000-0000-4000-8000-000000000099", undefined, undefined, "month");
    throw new Error("expected 400");
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 400) throw e;
    console.log("[PASS] bucket requires from/to");
  }

  try {
    await salesByPeriod(
      "00000000-0000-4000-8000-000000000099",
      "2020-01-01",
      "2026-12-31",
      "month"
    );
    throw new Error("expected 400 for too many months");
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 400) throw e;
    console.log("[PASS] month span > 36 → 400");
  }

  // Import build via re-export test of key count by calling with empty DB tenant after creating org
  const { PrismaClient } = await import("@prisma/client");
  const { ensureDefaultTenantSaaS } = await import("../src/modules/tenant/tenant.service.js");
  const prisma = new PrismaClient();
  const code = "SALES_BUCKET";
  for (const o of await prisma.organization.findMany({ where: { code }, select: { id: true } })) {
    await prisma.organization.delete({ where: { id: o.id } }).catch(() => undefined);
  }
  const org = await prisma.organization.create({
    data: { name: "Sales Bucket", code, baseCurrency: "EGP" },
  });
  await ensureDefaultTenantSaaS(org.id);

  const data = await salesByPeriod(org.id, "2026-01-01", "2026-12-31", "month");
  if (!("points" in data) || !Array.isArray(data.points)) throw new Error("no points");
  if (data.points.length !== 12) throw new Error(`expected 12 got ${data.points.length}`);
  if (data.points[0]?.period !== "2026-01") throw new Error("first period");
  if (data.points[11]?.period !== "2026-12") throw new Error("last period");
  if (!data.points.every((p) => p.totalSales === 0)) throw new Error("zeros expected");
  if (!Array.isArray(data.returns) || data.returns.length !== 12) throw new Error("returns series");
  // Aggregates still present
  if (typeof data.totalSales !== "number") throw new Error("totalSales missing");
  console.log("[PASS] 12 zero-filled months + returns series + totals");

  const noBucket = await salesByPeriod(org.id, "2026-01-01", "2026-12-31");
  if ("points" in noBucket && (noBucket as { points?: unknown }).points) {
    throw new Error("points should be absent without bucket");
  }
  console.log("[PASS] no bucket → legacy shape");

  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.$disconnect();
  console.log("\nAll passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
