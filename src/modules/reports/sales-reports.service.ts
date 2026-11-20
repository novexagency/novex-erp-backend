import { PosSaleStatus, SalesDocStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { growthPct, n, parseRange, previousPeriod, round4 } from "./period.js";

export type SalesBucket = "day" | "week" | "month";

const BUCKET_LIMITS: Record<SalesBucket, number> = {
  day: 366,
  week: 53,
  month: 36,
};

function invoiceDateFilter(from?: Date, to?: Date) {
  if (!from && !to) return {};
  return {
    invoiceDate: {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    },
  };
}

function posDateFilter(from?: Date, to?: Date) {
  if (!from && !to) return {};
  return {
    createdAt: {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    },
  };
}

/** Posted sales invoices + completed POS sales (revenue, not profit). */
export async function salesRevenueTotal(
  tenantId: TenantId,
  from?: string,
  to?: string
) {
  const tid = requireTenantId(tenantId);
  const range = parseRange(from, to);

  const [invoices, pos] = await Promise.all([
    prisma.salesInvoice.aggregate({
      where: {
        organizationId: tid,
        status: SalesDocStatus.POSTED,
        ...invoiceDateFilter(range.from, range.to),
      },
      _sum: { totalAmount: true, discountAmount: true, subtotal: true },
      _count: true,
    }),
    prisma.posSale.aggregate({
      where: {
        organizationId: tid,
        status: PosSaleStatus.COMPLETED,
        type: "SALE",
        ...posDateFilter(range.from, range.to),
      },
      _sum: { totalAmount: true, discountAmount: true, subtotal: true },
      _count: true,
    }),
  ]);

  const invoiceSales = n(invoices._sum.totalAmount);
  const posSales = n(pos._sum.totalAmount);
  return {
    from: from ?? null,
    to: to ?? null,
    invoiceSales: round4(invoiceSales),
    invoiceCount: invoices._count,
    posSales: round4(posSales),
    posCount: pos._count,
    /** KPI: Total sales = posted invoice totals + completed POS sale totals (gross revenue). */
    totalSales: round4(invoiceSales + posSales),
    totalDiscounts: round4(n(invoices._sum.discountAmount) + n(pos._sum.discountAmount)),
  };
}

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isoWeekKey(d: Date): string {
  // ISO week: Thursday-based year/week
  const date = startOfUtcDay(d);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function bucketKey(d: Date, bucket: SalesBucket): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  if (bucket === "day") return `${y}-${m}-${day}`;
  if (bucket === "month") return `${y}-${m}`;
  return isoWeekKey(d);
}

function buildBucketKeys(from: Date, to: Date, bucket: SalesBucket): string[] {
  const start = startOfUtcDay(from);
  const end = startOfUtcDay(to);
  if (start > end) throw new AppError("from must be <= to", 400);

  const keys: string[] = [];

  if (bucket === "month") {
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth();
    const endY = end.getUTCFullYear();
    const endM = end.getUTCMonth();
    while (y < endY || (y === endY && m <= endM)) {
      keys.push(`${y}-${String(m + 1).padStart(2, "0")}`);
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
      if (keys.length > BUCKET_LIMITS.month + 5) break;
    }
  } else {
    const cursor = new Date(start);
    const seen = new Set<string>();
    while (cursor <= end) {
      const key = bucketKey(cursor, bucket);
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      if (keys.length > BUCKET_LIMITS[bucket] + 5) break;
    }
  }

  if (keys.length > BUCKET_LIMITS[bucket]) {
    throw new AppError(
      `Too many ${bucket} buckets (${keys.length}). Max is ${BUCKET_LIMITS[bucket]}`,
      400
    );
  }
  return keys;
}

type PointAgg = {
  invoiceSales: number;
  posSales: number;
  invoiceCount: number;
  posCount: number;
  returnAmount: number;
  returnCount: number;
};

async function salesSeriesPoints(
  tenantId: string,
  from: Date,
  to: Date,
  bucket: SalesBucket
) {
  const keys = buildBucketKeys(from, to, bucket);
  const map = new Map<string, PointAgg>();
  for (const k of keys) {
    map.set(k, {
      invoiceSales: 0,
      posSales: 0,
      invoiceCount: 0,
      posCount: 0,
      returnAmount: 0,
      returnCount: 0,
    });
  }

  const [invoices, pos, returns] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: {
        organizationId: tenantId,
        status: SalesDocStatus.POSTED,
        ...invoiceDateFilter(from, to),
      },
      select: { invoiceDate: true, totalAmount: true },
    }),
    prisma.posSale.findMany({
      where: {
        organizationId: tenantId,
        status: PosSaleStatus.COMPLETED,
        type: "SALE",
        ...posDateFilter(from, to),
      },
      select: { createdAt: true, totalAmount: true },
    }),
    prisma.salesReturn.findMany({
      where: {
        organizationId: tenantId,
        status: SalesDocStatus.POSTED,
        postedAt: { gte: from, lte: to },
      },
      select: { postedAt: true, totalAmount: true },
    }),
  ]);

  for (const inv of invoices) {
    const key = bucketKey(inv.invoiceDate, bucket);
    const row = map.get(key);
    if (!row) continue;
    row.invoiceSales += n(inv.totalAmount);
    row.invoiceCount += 1;
  }
  for (const sale of pos) {
    const key = bucketKey(sale.createdAt, bucket);
    const row = map.get(key);
    if (!row) continue;
    row.posSales += n(sale.totalAmount);
    row.posCount += 1;
  }
  for (const ret of returns) {
    if (!ret.postedAt) continue;
    const key = bucketKey(ret.postedAt, bucket);
    const row = map.get(key);
    if (!row) continue;
    row.returnAmount += n(ret.totalAmount);
    row.returnCount += 1;
  }

  const points = keys.map((period) => {
    const row = map.get(period)!;
    return {
      period,
      label: period,
      totalSales: round4(row.invoiceSales + row.posSales),
      invoiceSales: round4(row.invoiceSales),
      posSales: round4(row.posSales),
      invoiceCount: row.invoiceCount,
      posCount: row.posCount,
    };
  });

  // Independent returns series — not subtracted from points.totalSales
  const returnsSeries = keys.map((period) => {
    const row = map.get(period)!;
    return {
      period,
      label: period,
      totalReturns: round4(row.returnAmount),
      returnCount: row.returnCount,
    };
  });

  return { points, returns: returnsSeries };
}

export async function salesByPeriod(
  tenantId: TenantId,
  from?: string,
  to?: string,
  bucket?: SalesBucket | string | null
) {
  const current = await salesRevenueTotal(tenantId, from, to);
  let compare: {
    previous: Awaited<ReturnType<typeof salesRevenueTotal>>;
    salesGrowthPct: number | null;
  } | null = null;

  if (from && to) {
    const cur = parseRange(from, to);
    if (cur.from && cur.to) {
      const prev = previousPeriod(cur.from, cur.to);
      const previous = await salesRevenueTotal(
        tenantId,
        prev.from.toISOString(),
        prev.to.toISOString()
      );
      compare = {
        previous,
        salesGrowthPct: growthPct(current.totalSales, previous.totalSales),
      };
    }
  }

  const base = {
    ...current,
    definitions: {
      totalSales: "Sum of posted SalesInvoice.totalAmount + completed PosSale(type=SALE).totalAmount",
      salesGrowthPct: "(current.totalSales - previous.totalSales) / |previous.totalSales| * 100",
      note: "Revenue metric — not profit. Returns are not deducted from chart points; see returns series when bucket is set.",
    },
    compare,
  };

  if (!bucket) return base;

  const b = String(bucket).toLowerCase() as SalesBucket;
  if (b !== "day" && b !== "week" && b !== "month") {
    throw new AppError("bucket must be day, week, or month", 400);
  }
  if (!from || !to) {
    throw new AppError("from and to are required when bucket is set", 400);
  }
  const range = parseRange(from, to);
  if (!range.from || !range.to) throw new AppError("Invalid from/to", 400);

  const series = await salesSeriesPoints(requireTenantId(tenantId), range.from, range.to, b);
  return {
    ...base,
    bucket: b,
    points: series.points,
    returns: series.returns,
  };
}

export async function salesByCustomer(tenantId: TenantId, from?: string, to?: string) {
  const tid = requireTenantId(tenantId);
  const range = parseRange(from, to);
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      organizationId: tid,
      status: SalesDocStatus.POSTED,
      ...invoiceDateFilter(range.from, range.to),
    },
    select: {
      customerId: true,
      totalAmount: true,
      customer: { select: { id: true, code: true, name: true } },
    },
  });

  const map = new Map<
    string,
    { customerId: string; code: string; name: string; sales: number; invoices: number }
  >();
  for (const inv of invoices) {
    const cur = map.get(inv.customerId) ?? {
      customerId: inv.customerId,
      code: inv.customer.code,
      name: inv.customer.name,
      sales: 0,
      invoices: 0,
    };
    cur.sales += n(inv.totalAmount);
    cur.invoices += 1;
    map.set(inv.customerId, cur);
  }

  const rows = [...map.values()]
    .map((r) => ({ ...r, sales: round4(r.sales) }))
    .sort((a, b) => b.sales - a.sales);

  return { from: from ?? null, to: to ?? null, rows, items: rows };
}

export async function salesByProduct(tenantId: TenantId, from?: string, to?: string) {
  const tid = requireTenantId(tenantId);
  const range = parseRange(from, to);

  const [invLines, posLines] = await Promise.all([
    prisma.salesInvoiceLine.findMany({
      where: {
        organizationId: tid,
        salesInvoice: {
          organizationId: tid,
          status: SalesDocStatus.POSTED,
          ...invoiceDateFilter(range.from, range.to),
        },
      },
      include: {
        product: { select: { id: true, sku: true, name: true } },
      },
    }),
    prisma.posSaleLine.findMany({
      where: {
        organizationId: tid,
        posSale: {
          organizationId: tid,
          status: PosSaleStatus.COMPLETED,
          type: "SALE",
          ...posDateFilter(range.from, range.to),
        },
      },
      include: {
        product: { select: { id: true, sku: true, name: true } },
      },
    }),
  ]);

  const map = new Map<
    string,
    {
      productId: string;
      sku: string;
      name: string;
      qty: number;
      revenue: number;
      cost: number;
    }
  >();

  for (const l of invLines) {
    const cur = map.get(l.productId) ?? {
      productId: l.productId,
      sku: l.product.sku,
      name: l.product.name,
      qty: 0,
      revenue: 0,
      cost: 0,
    };
    cur.qty += n(l.quantity);
    cur.revenue += n(l.lineTotal);
    map.set(l.productId, cur);
  }
  for (const l of posLines) {
    const cur = map.get(l.productId) ?? {
      productId: l.productId,
      sku: l.product.sku,
      name: l.product.name,
      qty: 0,
      revenue: 0,
      cost: 0,
    };
    cur.qty += n(l.quantity);
    cur.revenue += n(l.lineTotal);
    map.set(l.productId, cur);
  }

  // Attach WAC cost where stock balance exists
  const balances = await prisma.stockBalance.findMany({
    where: { organizationId: tid, productId: { in: [...map.keys()] } },
    select: { productId: true, avgUnitCost: true },
  });
  const costMap = new Map(balances.map((b) => [b.productId, n(b.avgUnitCost)]));

  const rows = [...map.values()]
    .map((r) => {
      const unitCost = costMap.get(r.productId) ?? 0;
      const cogs = round4(r.qty * unitCost);
      const revenue = round4(r.revenue);
      const grossMargin = round4(revenue - cogs);
      return {
        ...r,
        qty: round4(r.qty),
        revenue,
        avgUnitCost: round4(unitCost),
        estimatedCogs: cogs,
        /** Gross margin estimate when WAC available — not net profit. */
        estimatedGrossMargin: grossMargin,
        estimatedGrossMarginPct:
          revenue > 0 ? round4((grossMargin / revenue) * 100) : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  return {
    from: from ?? null,
    to: to ?? null,
    definitions: {
      estimatedCogs: "quantity * StockBalance.avgUnitCost (WAC); 0 if no cost layer",
      estimatedGrossMargin: "revenue - estimatedCogs (not net profit)",
    },
    rows,
    items: rows,
  };
}

export async function salesByEmployee(tenantId: TenantId, from?: string, to?: string) {
  const tid = requireTenantId(tenantId);
  const range = parseRange(from, to);

  const [invoices, pos] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: {
        organizationId: tid,
        status: SalesDocStatus.POSTED,
        ...invoiceDateFilter(range.from, range.to),
      },
      select: { createdByUserId: true, postedByUserId: true, totalAmount: true },
    }),
    prisma.posSale.findMany({
      where: {
        organizationId: tid,
        status: PosSaleStatus.COMPLETED,
        type: "SALE",
        ...posDateFilter(range.from, range.to),
      },
      select: { cashierUserId: true, totalAmount: true },
    }),
  ]);

  const map = new Map<string, { userId: string; sales: number; count: number }>();
  for (const inv of invoices) {
    const uid = inv.postedByUserId ?? inv.createdByUserId ?? "unknown";
    const cur = map.get(uid) ?? { userId: uid, sales: 0, count: 0 };
    cur.sales += n(inv.totalAmount);
    cur.count += 1;
    map.set(uid, cur);
  }
  for (const s of pos) {
    const uid = s.cashierUserId ?? "unknown";
    const cur = map.get(uid) ?? { userId: uid, sales: 0, count: 0 };
    cur.sales += n(s.totalAmount);
    cur.count += 1;
    map.set(uid, cur);
  }

  const rows = [...map.values()]
    .map((r) => ({ ...r, sales: round4(r.sales) }))
    .sort((a, b) => b.sales - a.sales);
  return { from: from ?? null, to: to ?? null, rows, items: rows };
}

export async function salesReturnsReport(tenantId: TenantId, from?: string, to?: string) {
  const tid = requireTenantId(tenantId);
  const range = parseRange(from, to);
  const returns = await prisma.salesReturn.findMany({
    where: {
      organizationId: tid,
      status: SalesDocStatus.POSTED,
      ...(range.from || range.to
        ? {
            postedAt: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lte: range.to } : {}),
            },
          }
        : {}),
    },
    include: { customer: { select: { code: true, name: true } } },
    orderBy: { postedAt: "desc" },
  });

  const rows = returns.map((r) => ({
    id: r.id,
    code: r.code,
    customer: r.customer.name,
    totalAmount: n(r.totalAmount),
    postedAt: r.postedAt,
    reason: r.reason,
  }));
  return {
    from: from ?? null,
    to: to ?? null,
    totalReturns: round4(rows.reduce((s, r) => s + r.totalAmount, 0)),
    rows,
    items: rows,
  };
}

export async function discountsReport(tenantId: TenantId, from?: string, to?: string) {
  const tid = requireTenantId(tenantId);
  const range = parseRange(from, to);
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      organizationId: tid,
      status: SalesDocStatus.POSTED,
      discountAmount: { gt: 0 },
      ...invoiceDateFilter(range.from, range.to),
    },
    select: {
      code: true,
      discountAmount: true,
      totalAmount: true,
      invoiceDate: true,
      customer: { select: { name: true } },
    },
  });
  const rows = invoices.map((i) => ({
    code: i.code,
    customer: i.customer.name,
    discountAmount: n(i.discountAmount),
    totalAmount: n(i.totalAmount),
    invoiceDate: i.invoiceDate,
  }));
  return {
    from: from ?? null,
    to: to ?? null,
    totalDiscounts: round4(rows.reduce((s, r) => s + r.discountAmount, 0)),
    rows,
    items: rows,
  };
}
