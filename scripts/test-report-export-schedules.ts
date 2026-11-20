import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { contentDisposition, objectToTabular, toPdf } from "../src/modules/reports/export.util.js";
import {
  createSchedule,
  resolveScheduleRange,
  runSchedule,
  deleteSchedule,
} from "../src/modules/reports/schedules.service.js";
import { ensureDefaultTenantSaaS } from "../src/modules/tenant/tenant.service.js";
import { isAllowedReportPath } from "../src/modules/reports/report-catalog.js";

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

async function cleanup(id: string) {
  await prisma.reportScheduleRun.deleteMany({ where: { organizationId: id } });
  await prisma.reportSchedule.deleteMany({ where: { organizationId: id } });
  await prisma.notification.deleteMany({ where: { organizationId: id } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: id } });
  await prisma.role.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.warehouse.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.tenantSystemConfig.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.documentSequence.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
  await prisma.tenantModule.deleteMany({ where: { organizationId: id } });
  await prisma.tenantEntitlement.deleteMany({ where: { organizationId: id } });
  await prisma.tenantSubscription.deleteMany({ where: { organizationId: id } });
  await prisma.organization.delete({ where: { id } }).catch(() => undefined);
}

async function main() {
  console.log("=== Report export + schedules ===\n");
  createApp();

  try {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      name: `منتج ${i + 1}`,
      qty: i + 1,
    }));
    const pdf = await toPdf(
      objectToTabular("تقرير_اختبار", { rows, from: "2026-01-01", to: "2026-01-31" })
    );
    if (pdf.subarray(0, 4).toString() !== "%PDF") throw new Error("not pdf");
    // 120 rows must not be truncated to 80 with a "more rows" note in older exporter
    const text = pdf.toString("latin1");
    if (text.includes("more rows")) throw new Error("still truncating");
    pass("pdf exports all rows with pagination");
  } catch (e) {
    fail("pdf exports all rows with pagination", e instanceof Error ? e.message : String(e));
  }

  try {
    const cd = contentDisposition("مبيعات_الشهر.xlsx");
    if (!cd.includes("filename*=")) throw new Error("missing RFC5987");
    pass("Content-Disposition supports Arabic filename");
  } catch (e) {
    fail("Content-Disposition supports Arabic filename", e instanceof Error ? e.message : String(e));
  }

  try {
    if (!isAllowedReportPath("/tenant/reports/sales/by-product")) throw new Error("missing path");
    if (isAllowedReportPath("/tenant/reports/../evil")) throw new Error("free path allowed");
    const r = resolveScheduleRange("PREVIOUS_MONTH", new Date("2026-11-18T12:00:00Z"));
    if (!r.from.includes("2026-10")) throw new Error(`bad range ${r.from}`);
    pass("catalog + previous month range");
  } catch (e) {
    fail("catalog + previous month range", e instanceof Error ? e.message : String(e));
  }

  for (const o of await prisma.organization.findMany({
    where: { code: "RPT_SCHED" },
    select: { id: true },
  })) {
    await cleanup(o.id);
  }

  const org = await prisma.organization.create({
    data: { name: "Report Sched", code: "RPT_SCHED", baseCurrency: "EGP" },
  });
  await ensureDefaultTenantSaaS(org.id);
  const user = await prisma.user.create({
    data: {
      email: `rpt.sched.${Date.now()}@example.com`,
      name: "Sched User",
      passwordHash: "x",
    },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: user.id, status: "ACTIVE" },
  });

  try {
    const schedule = await createSchedule(
      org.id,
      {
        name: "مبيعات الشهر",
        reportPath: "/tenant/reports/sales/by-product",
        format: "xlsx",
        frequency: "MONTHLY",
        hour: 8,
        dayOfMonth: 1,
        dayOfWeek: null,
        range: "PREVIOUS_MONTH",
        recipientUserIds: [user.id],
      },
      user.id
    );

    const result = await runSchedule(org.id, schedule.id, user.id);
    if (!result.runId) throw new Error("no runId");
    if (result.run.status !== "SUCCESS") throw new Error(`status ${result.run.status}`);
    if (!result.run.filePublicId) throw new Error("no file");

    const notif = await prisma.notification.findFirst({
      where: {
        organizationId: org.id,
        userId: user.id,
        type: "REPORT_READY",
      },
    });
    if (!notif) throw new Error("no notification");

    await deleteSchedule(org.id, schedule.id);
    pass("schedule create + run + notify");
  } catch (e) {
    fail("schedule create + run + notify", e instanceof Error ? e.message : String(e));
  }

  await cleanup(org.id);
  await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);

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
