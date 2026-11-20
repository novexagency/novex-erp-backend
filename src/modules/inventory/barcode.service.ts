import { BarcodeScanResult, BarcodeScanSource, Prisma } from "@prisma/client";
import bwipjs from "bwip-js";
import { randomBytes } from "node:crypto";
import { createPdfDocument, pdfFontName, resolvePdfFontPath } from "../../lib/pdf.js";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

const SUPPORTED_SYMBOLOGY = new Set(["CODE128"]);

async function assertProduct(tid: string, productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, organizationId: true, name: true, sku: true },
  });
  if (!product) throw new AppError("Product not found", 404);
  assertSameTenant(product.organizationId, tid);
  return product;
}

async function generateUniqueCode(tid: string): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const code = `NX${Date.now().toString(36).toUpperCase()}${randomBytes(2)
      .toString("hex")
      .toUpperCase()}`;
    const exists = await prisma.productBarcode.findUnique({
      where: {
        organizationId_barcode: { organizationId: tid, barcode: code },
      },
    });
    if (!exists) return code;
  }
  throw new AppError("Could not allocate a unique barcode", 500);
}

export async function generateBarcode(
  tenantId: TenantId,
  data: {
    productId: string;
    symbology?: string;
    copies?: number;
    forceNew?: boolean;
  }
) {
  const tid = requireTenantId(tenantId);
  const symbology = (data.symbology ?? "CODE128").toUpperCase();
  if (!SUPPORTED_SYMBOLOGY.has(symbology)) {
    throw new AppError("Unsupported symbology — use CODE128", 400);
  }
  await assertProduct(tid, data.productId);

  const primary = await prisma.productBarcode.findFirst({
    where: { organizationId: tid, productId: data.productId, isPrimary: true },
  });

  if (primary && !data.forceNew) {
    return {
      barcode: primary.barcode,
      productId: data.productId,
      symbology: primary.symbology || symbology,
    };
  }

  const barcode = await generateUniqueCode(tid);
  const makePrimary = !primary;

  if (makePrimary === false && data.forceNew) {
    // keep existing primary; add secondary
  }

  await prisma.productBarcode.create({
    data: {
      organizationId: tid,
      productId: data.productId,
      barcode,
      isPrimary: makePrimary,
      symbology,
    },
  });

  return { barcode, productId: data.productId, symbology };
}

async function renderBarcodePng(text: string, symbology: string): Promise<Buffer> {
  const bcid = symbology === "CODE128" ? "code128" : "code128";
  return bwipjs.toBuffer({
    bcid,
    text,
    scale: 2,
    height: 10,
    includetext: true,
    textxalign: "center",
  });
}

export async function buildLabelsPdf(
  tenantId: TenantId,
  data: {
    items: Array<{ productId: string; barcode: string; copies?: number }>;
    layout?: { columns?: number; widthMm?: number; heightMm?: number };
  }
): Promise<Buffer> {
  const tid = requireTenantId(tenantId);
  if (!data.items?.length) throw new AppError("At least one label item is required", 400);

  const columns = Math.min(4, Math.max(1, data.layout?.columns ?? 2));
  const widthMm = data.layout?.widthMm ?? 50;
  const heightMm = data.layout?.heightMm ?? 30;
  const mmToPt = (mm: number) => (mm * 72) / 25.4;
  const labelW = mmToPt(widthMm);
  const labelH = mmToPt(heightMm);
  const margin = 18;
  const gap = 8;

  type Label = { name: string; sku: string; barcode: string; png: Buffer };
  const labels: Label[] = [];

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i]!;
    const copies = Math.min(100, Math.max(1, item.copies ?? 1));
    const product = await assertProduct(tid, item.productId);
    const row = await prisma.productBarcode.findFirst({
      where: {
        organizationId: tid,
        productId: item.productId,
        barcode: item.barcode.trim(),
      },
    });
    if (!row) {
      throw new AppError(
        `Barcode does not belong to product (items[${i}]: ${item.barcode})`,
        400
      );
    }
    const png = await renderBarcodePng(row.barcode, row.symbology || "CODE128");
    for (let c = 0; c < copies; c++) {
      labels.push({
        name: product.name,
        sku: product.sku,
        barcode: row.barcode,
        png,
      });
    }
  }

  // One page per label copy (explicit requirement).
  const pageW = Math.max(labelW + margin * 2, columns * labelW + margin * 2);
  const pageH = labelH + margin * 2;

  return new Promise((resolve, reject) => {
    const doc = createPdfDocument({
      size: [pageW, pageH],
      margin: 0,
      autoFirstPage: false,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const fontPath = resolvePdfFontPath();
    const font = pdfFontName();

    for (const label of labels) {
      doc.addPage({ size: [pageW, pageH], margin: 0 });
      if (fontPath) doc.font(font);
      const x = margin;
      const y = margin;
      doc.rect(x, y, labelW, labelH).stroke("#cccccc");
      doc
        .fontSize(8)
        .fillColor("#111")
        .text(label.name.slice(0, 40), x + 4, y + 4, {
          width: labelW - 8,
          ellipsis: true,
        });
      doc
        .fontSize(7)
        .fillColor("#444")
        .text(`SKU: ${label.sku}`, x + 4, y + 16, { width: labelW - 8 });
      const imgW = labelW - 12;
      const imgH = Math.min(labelH - 36, 40);
      doc.image(label.png, x + 6, y + 28, {
        fit: [imgW, imgH],
        align: "center",
      });
    }

    doc.end();
  });
}

export async function recordBarcodeScan(
  tenantId: TenantId,
  data: {
    barcode: string;
    source: "MANUAL" | "CAMERA";
    result: "FOUND" | "NOT_FOUND";
    productId?: string | null;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const barcode = data.barcode.trim();
  if (!barcode) throw new AppError("barcode is required", 400);
  if (data.source !== "MANUAL" && data.source !== "CAMERA") {
    throw new AppError("source must be MANUAL or CAMERA", 400);
  }
  if (data.result !== "FOUND" && data.result !== "NOT_FOUND") {
    throw new AppError("result must be FOUND or NOT_FOUND", 400);
  }

  let productName: string | null = null;
  let productId = data.productId ?? null;
  if (productId) {
    const p = await prisma.product.findFirst({
      where: { id: productId, organizationId: tid },
      select: { name: true },
    });
    productName = p?.name ?? null;
    if (!p) productId = null;
  } else if (data.result === "FOUND") {
    const hit = await prisma.productBarcode.findFirst({
      where: { organizationId: tid, barcode },
      include: { product: { select: { id: true, name: true } } },
    });
    if (hit) {
      productId = hit.productId;
      productName = hit.product.name;
    }
  }

  const scan = await prisma.barcodeScan.create({
    data: {
      organizationId: tid,
      barcode,
      source: data.source as BarcodeScanSource,
      result: data.result as BarcodeScanResult,
      productId,
      productName,
      userId: userId ?? null,
    },
  });

  return {
    id: scan.id,
    barcode: scan.barcode,
    source: scan.source,
    result: scan.result,
    productId: scan.productId,
    productName: scan.productName,
    userId: scan.userId,
    createdAt: scan.createdAt.toISOString(),
  };
}

export async function listBarcodeScans(
  tenantId: TenantId,
  query: {
    from?: string;
    to?: string;
    barcode?: string;
    result?: string;
    page?: number;
    pageSize?: number;
  } = {}
) {
  const tid = requireTenantId(tenantId);
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

  const where: Prisma.BarcodeScanWhereInput = {
    organizationId: tid,
    ...(query.barcode ? { barcode: { contains: query.barcode.trim() } } : {}),
    ...(query.result === "FOUND" || query.result === "NOT_FOUND"
      ? { result: query.result as BarcodeScanResult }
      : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.barcodeScan.count({ where }),
    prisma.barcodeScan.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  return {
    items: rows.map((r) => {
      const u = r.userId ? userMap.get(r.userId) : null;
      return {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        userId: r.userId,
        userName: u?.name ?? null,
        userEmail: u?.email ?? null,
        barcode: r.barcode,
        result: r.result,
        productId: r.productId,
        productName: r.productName,
        source: r.source,
      };
    }),
    page,
    pageSize,
    total,
  };
}
