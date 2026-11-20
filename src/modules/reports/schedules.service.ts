import {
  NotificationType,
  ReportExportFormat,
  ReportScheduleFrequency,
  ReportScheduleRange,
  ReportScheduleRunStatus,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { buildUploadFolder } from "../../lib/cloudinary.js";
import * as uploadService from "../uploads/upload.service.js";
import { notifyUsers } from "../workflow/notifications.service.js";
import { objectToTabular, renderExport, type ExportFormat } from "./export.util.js";
import { isAllowedReportPath } from "./report-catalog.js";
import * as executive from "./executive.service.js";
import * as financial from "./financial-reports.service.js";
import * as hr from "./hr-reports.service.js";
import * as inventory from "./inventory-reports.service.js";
import * as sales from "./sales-reports.service.js";

function formatToExport(f: ReportExportFormat): Exclude<ExportFormat, "json"> {
  if (f === ReportExportFormat.CSV) return "csv";
  if (f === ReportExportFormat.PDF) return "pdf";
  return "xlsx";
}

function parseFormat(input: string): ReportExportFormat {
  const v = input.toLowerCase();
  if (v === "csv") return ReportExportFormat.CSV;
  if (v === "pdf") return ReportExportFormat.PDF;
  if (v === "xlsx" || v === "excel") return ReportExportFormat.XLSX;
  throw new AppError("format must be csv, xlsx, or pdf", 400);
}

/** Compute from/to ISO for a schedule range relative to `now`. */
export function resolveScheduleRange(
  range: ReportScheduleRange,
  now = new Date()
): { from: string; to: string } {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (range === ReportScheduleRange.PREVIOUS_DAY) {
    start.setDate(start.getDate() - 1);
    end.setTime(start.getTime());
    end.setHours(23, 59, 59, 999);
  } else if (range === ReportScheduleRange.PREVIOUS_WEEK) {
    end.setDate(end.getDate() - 1);
    start.setTime(end.getTime());
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else {
    // PREVIOUS_MONTH
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const firstPrev = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
    const lastPrev = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
    return { from: firstPrev.toISOString(), to: lastPrev.toISOString() };
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

async function fetchReportData(
  tenantId: string,
  reportPath: string,
  from?: string,
  to?: string
): Promise<{ title: string; data: unknown }> {
  switch (reportPath) {
    case "/tenant/reports/dashboard/executive":
      return { title: "لوحة_التنفيذية", data: await executive.executiveDashboard(tenantId, from, to) };
    case "/tenant/reports/compare": {
      if (!from || !to) throw new AppError("compare report requires from/to range", 400);
      return { title: "مقارنة_الفترات", data: await executive.comparePeriods(tenantId, from, to) };
    }
    case "/tenant/reports/financial/income-statement":
      return { title: "قائمة_الدخل", data: await financial.incomeStatement(tenantId, from, to) };
    case "/tenant/reports/financial/balance-sheet":
      return { title: "الميزانية", data: await financial.balanceSheet(tenantId, to) };
    case "/tenant/reports/financial/cash-flow":
      return { title: "التدفق_النقدي", data: await financial.cashFlow(tenantId, from, to) };
    case "/tenant/reports/financial/trial-balance":
      return { title: "ميزان_المراجعة", data: await financial.trialBalance(tenantId, from, to) };
    case "/tenant/reports/financial/customer-balances":
      return { title: "أرصدة_العملاء", data: await financial.customerBalances(tenantId) };
    case "/tenant/reports/financial/supplier-balances":
      return { title: "أرصدة_الموردين", data: await financial.supplierBalances(tenantId) };
    case "/tenant/reports/financial/expenses":
      return { title: "تحليل_المصروفات", data: await financial.expenseAnalysis(tenantId, from, to) };
    case "/tenant/reports/sales/by-period":
      return { title: "مبيعات_بالفترة", data: await sales.salesByPeriod(tenantId, from, to) };
    case "/tenant/reports/sales/by-customer":
      return { title: "مبيعات_بالعميل", data: await sales.salesByCustomer(tenantId, from, to) };
    case "/tenant/reports/sales/by-product":
      return { title: "مبيعات_بالمنتج", data: await sales.salesByProduct(tenantId, from, to) };
    case "/tenant/reports/sales/by-employee":
      return { title: "مبيعات_بالموظف", data: await sales.salesByEmployee(tenantId, from, to) };
    case "/tenant/reports/sales/returns":
      return { title: "مرتجعات_المبيعات", data: await sales.salesReturnsReport(tenantId, from, to) };
    case "/tenant/reports/sales/discounts":
      return { title: "الخصومات", data: await sales.discountsReport(tenantId, from, to) };
    case "/tenant/reports/inventory/stock":
      return { title: "المخزون_الحالي", data: await inventory.currentStock(tenantId) };
    case "/tenant/reports/inventory/valuation":
      return { title: "تقييم_المخزون", data: await inventory.stockValuation(tenantId) };
    case "/tenant/reports/inventory/movements":
      return { title: "حركات_المخزون", data: await inventory.stockMovements(tenantId, from, to) };
    case "/tenant/reports/inventory/low-stock":
      return { title: "نواقص_المخزون", data: await inventory.lowStock(tenantId) };
    case "/tenant/reports/inventory/aging":
      return { title: "أعمار_المخزون", data: await inventory.inventoryAging(tenantId) };
    case "/tenant/reports/inventory/count-differences":
      return { title: "فروقات_الجرد", data: await inventory.stockCountDifferences(tenantId) };
    case "/tenant/reports/inventory/product-profitability":
      return {
        title: "ربحية_المنتجات",
        data: await inventory.productProfitability(tenantId, from, to),
      };
    case "/tenant/reports/hr/attendance":
      return { title: "الحضور", data: await hr.attendanceReport(tenantId, from, to) };
    case "/tenant/reports/hr/absence":
      return { title: "الغياب", data: await hr.absenceReport(tenantId, from, to) };
    case "/tenant/reports/hr/overtime":
      return { title: "الوقت_الإضافي", data: await hr.overtimeReport(tenantId, from, to) };
    case "/tenant/reports/hr/leave-balances":
      return { title: "أرصدة_الإجازات", data: await hr.leaveBalancesReport(tenantId) };
    case "/tenant/reports/hr/payroll-summary":
      return { title: "ملخص_الرواتب", data: await hr.payrollSummary(tenantId, from, to) };
    default:
      throw new AppError("Unknown report path", 400);
  }
}

async function assertRecipients(tid: string, userIds: string[]) {
  if (!userIds.length) throw new AppError("At least one recipientUserId is required", 400);
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: tid, userId: { in: userIds } },
    select: { userId: true },
  });
  if (members.length !== [...new Set(userIds)].length) {
    throw new AppError("One or more recipients are not members of this tenant", 400);
  }
}

export async function createSchedule(
  tenantId: TenantId,
  data: {
    name: string;
    reportPath: string;
    format: string;
    frequency: "DAILY" | "WEEKLY" | "MONTHLY";
    hour?: number;
    dayOfMonth?: number | null;
    dayOfWeek?: number | null;
    range: "PREVIOUS_DAY" | "PREVIOUS_WEEK" | "PREVIOUS_MONTH";
    recipientUserIds: string[];
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  if (!isAllowedReportPath(data.reportPath)) {
    throw new AppError("reportPath is not an allowed report route", 400);
  }
  const hour = data.hour ?? 8;
  if (hour < 0 || hour > 23) throw new AppError("hour must be 0-23", 400);
  if (data.frequency === "MONTHLY" && data.dayOfMonth != null) {
    if (data.dayOfMonth < 1 || data.dayOfMonth > 28) {
      throw new AppError("dayOfMonth must be 1-28", 400);
    }
  }
  if (data.frequency === "WEEKLY" && data.dayOfWeek != null) {
    if (data.dayOfWeek < 0 || data.dayOfWeek > 6) {
      throw new AppError("dayOfWeek must be 0-6", 400);
    }
  }
  await assertRecipients(tid, data.recipientUserIds);

  return prisma.reportSchedule.create({
    data: {
      organizationId: tid,
      name: data.name.trim(),
      reportPath: data.reportPath,
      format: parseFormat(data.format),
      frequency: data.frequency as ReportScheduleFrequency,
      hour,
      dayOfMonth: data.dayOfMonth ?? null,
      dayOfWeek: data.dayOfWeek ?? null,
      range: data.range as ReportScheduleRange,
      recipientUserIds: data.recipientUserIds,
      createdByUserId: userId,
    },
  });
}

export async function listSchedules(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  return prisma.reportSchedule.findMany({
    where: { organizationId: tid },
    orderBy: { createdAt: "desc" },
    include: { runs: { orderBy: { startedAt: "desc" }, take: 3 } },
  });
}

export async function updateSchedule(
  tenantId: TenantId,
  id: string,
  data: Partial<{
    name: string;
    reportPath: string;
    format: string;
    frequency: "DAILY" | "WEEKLY" | "MONTHLY";
    hour: number;
    dayOfMonth: number | null;
    dayOfWeek: number | null;
    range: "PREVIOUS_DAY" | "PREVIOUS_WEEK" | "PREVIOUS_MONTH";
    recipientUserIds: string[];
    isActive: boolean;
  }>
) {
  const tid = requireTenantId(tenantId);
  const existing = await prisma.reportSchedule.findUnique({ where: { id } });
  if (!existing) throw new AppError("Schedule not found", 404);
  assertSameTenant(existing.organizationId, tid);

  if (data.reportPath && !isAllowedReportPath(data.reportPath)) {
    throw new AppError("reportPath is not an allowed report route", 400);
  }
  if (data.recipientUserIds) await assertRecipients(tid, data.recipientUserIds);

  return prisma.reportSchedule.update({
    where: { id },
    data: {
      name: data.name?.trim(),
      reportPath: data.reportPath,
      format: data.format ? parseFormat(data.format) : undefined,
      frequency: data.frequency as ReportScheduleFrequency | undefined,
      hour: data.hour,
      dayOfMonth: data.dayOfMonth === undefined ? undefined : data.dayOfMonth,
      dayOfWeek: data.dayOfWeek === undefined ? undefined : data.dayOfWeek,
      range: data.range as ReportScheduleRange | undefined,
      recipientUserIds: data.recipientUserIds,
      isActive: data.isActive,
    },
  });
}

export async function deleteSchedule(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const existing = await prisma.reportSchedule.findUnique({ where: { id } });
  if (!existing) throw new AppError("Schedule not found", 404);
  assertSameTenant(existing.organizationId, tid);
  await prisma.reportSchedule.delete({ where: { id } });
}

export async function getRun(tenantId: TenantId, runId: string) {
  const tid = requireTenantId(tenantId);
  const run = await prisma.reportScheduleRun.findUnique({ where: { id: runId } });
  if (!run) throw new AppError("Run not found", 404);
  assertSameTenant(run.organizationId, tid);
  return run;
}

/**
 * Execute a schedule now: generate export → Cloudinary → notify recipients (in-app).
 * Email delivery is not available in this backend — notifications carry the download link.
 */
export async function runSchedule(
  tenantId: TenantId,
  scheduleId: string,
  triggeredBy?: string
) {
  const tid = requireTenantId(tenantId);
  const schedule = await prisma.reportSchedule.findUnique({ where: { id: scheduleId } });
  if (!schedule) throw new AppError("Schedule not found", 404);
  assertSameTenant(schedule.organizationId, tid);

  const run = await prisma.reportScheduleRun.create({
    data: {
      organizationId: tid,
      scheduleId,
      status: ReportScheduleRunStatus.RUNNING,
      triggeredBy: triggeredBy ?? "MANUAL",
    },
  });

  try {
    const { from, to } = resolveScheduleRange(schedule.range);
    const { title, data } = await fetchReportData(tid, schedule.reportPath, from, to);
    const tabular = objectToTabular(title, {
      ...(data && typeof data === "object" ? data : { value: data }),
      from,
      to,
      generatedAt: new Date().toISOString(),
    });
    const exported = await renderExport(formatToExport(schedule.format), tabular);
    const body =
      typeof exported.body === "string"
        ? Buffer.from(exported.body, "utf8")
        : Buffer.isBuffer(exported.body)
          ? exported.body
          : Buffer.from(JSON.stringify(exported.body));

    const asset = await uploadService.uploadBuffer({
      buffer: body,
      filename: exported.filename,
      mimetype: exported.contentType,
      kind: "raw",
      organizationId: tid,
      folder: "report-exports",
    });

    const finished = await prisma.reportScheduleRun.update({
      where: { id: run.id },
      data: {
        status: ReportScheduleRunStatus.SUCCESS,
        finishedAt: new Date(),
        filePublicId: asset.publicId,
        fileSecureUrl: asset.secureUrl,
        fileName: exported.filename,
        fileBytes: asset.bytes,
      },
    });

    await prisma.reportSchedule.update({
      where: { id: scheduleId },
      data: { lastRunAt: new Date() },
    });

    const downloadPath = `/api/v1/tenant/reports/schedules/runs/${run.id}/download`;
    await notifyUsers(tid, schedule.recipientUserIds, {
      type: NotificationType.REPORT_READY,
      title: `تقرير جاهز: ${schedule.name}`,
      body: `تم توليد التقرير (${exported.filename}). التحميل: ${downloadPath}`,
      entityType: "ReportScheduleRun",
      entityId: run.id,
    });

    return { runId: finished.id, run: finished, downloadPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.reportScheduleRun.update({
      where: { id: run.id },
      data: {
        status: ReportScheduleRunStatus.FAILED,
        finishedAt: new Date(),
        error: message.slice(0, 2000),
      },
    });
    throw err instanceof AppError ? err : new AppError(message, 500);
  }
}

/** Ensure folder prefix exists for org-owned uploads (used by labels cleanup checks elsewhere). */
export function reportExportFolder(organizationId: string) {
  return buildUploadFolder(organizationId, "report-exports");
}
