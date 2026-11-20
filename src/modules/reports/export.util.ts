import ExcelJS from "exceljs";
import { createPdfDocument, pdfFontName, resolvePdfFontPath } from "../../lib/pdf.js";
import { AppError } from "../../utils/AppError.js";

export type ExportFormat = "json" | "csv" | "xlsx" | "pdf";
export type TabularReport = {
  title: string;
  meta?: Record<string, unknown>;
  columns: Array<{ key: string; header: string }>;
  rows: Array<Record<string, unknown>>;
};

function cell(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Visual RTL shaping for PDFKit (no HarfBuzz) — reverse Arabic/Hebrew runs. */
export function shapeRtlForPdf(text: string): string {
  if (!text) return text;
  if (!/[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text)) {
    return text;
  }
  return [...text].reverse().join("");
}

export function toCsv(report: TabularReport): string {
  const headers = report.columns.map((c) => c.header);
  const lines = ["\uFEFF" + headers.map(escapeCsv).join(",")]; // BOM for Excel Arabic
  for (const row of report.rows) {
    lines.push(report.columns.map((c) => escapeCsv(cell(row[c.key]))).join(","));
  }
  return lines.join("\n");
}

function escapeCsv(v: string) {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export async function toExcel(report: TabularReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Novex ERP";
  const sheet = wb.addWorksheet(report.title.slice(0, 31) || "Report");
  sheet.views = [{ rightToLeft: true }];
  sheet.addRow(report.columns.map((c) => c.header));
  for (const row of report.rows) {
    sheet.addRow(
      report.columns.map((c) => {
        const v = row[c.key];
        if (typeof v === "number") return v;
        return cell(v);
      })
    );
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function toPdf(report: TabularReport): Promise<Buffer> {
  const fontPath = resolvePdfFontPath();
  const font = pdfFontName();

  return new Promise((resolve, reject) => {
    const doc = createPdfDocument({ margin: 40, size: "A4", bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const write = (text: string, opts?: { underline?: boolean; align?: "left" | "center" | "right" }) => {
      doc.text(shapeRtlForPdf(text), opts);
    };

    doc.fontSize(16);
    write(report.title, { underline: true, align: "right" });
    doc.moveDown(0.5);
    if (report.meta) {
      doc.fontSize(9).fillColor("#444");
      for (const [k, v] of Object.entries(report.meta)) {
        write(`${k}: ${cell(v)}`, { align: "right" });
      }
      doc.fillColor("#000");
      doc.moveDown(0.5);
    }

    doc.fontSize(8);
    const colCount = Math.max(1, report.columns.length);
    const usable = 515;
    const colW = Math.max(36, Math.floor(usable / colCount));
    const pageBottom = 780;
    const rowHeight = 14;

    const drawHeader = () => {
      let x = 40;
      const y = doc.y;
      for (const c of report.columns) {
        doc.text(shapeRtlForPdf(c.header), x, y, {
          width: colW,
          align: "right",
          lineBreak: false,
        });
        x += colW;
      }
      doc.moveDown(0.4);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown(0.3);
    };

    drawHeader();

    // All rows — paginate inside the PDF (no 80-row cap).
    for (const row of report.rows) {
      if (doc.y + rowHeight > pageBottom) {
        doc.addPage();
        if (fontPath) doc.font(font);
        drawHeader();
      }
      const y = doc.y;
      let x = 40;
      for (const c of report.columns) {
        const text = cell(row[c.key]).slice(0, 80);
        doc.text(shapeRtlForPdf(text), x, y, {
          width: colW,
          align: "right",
          lineBreak: false,
          height: rowHeight,
          ellipsis: true,
        });
        x += colW;
      }
      doc.y = y + rowHeight;
    }

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor("#666");
      const label = shapeRtlForPdf(`صفحة ${i + 1} / ${pages.count}`);
      doc.text(label, 40, 820, { width: 515, align: "center", lineBreak: false });
      doc.fillColor("#000");
    }

    doc.end();
  });
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_") || "report.bin";
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function renderExport(
  format: ExportFormat,
  report: TabularReport
): Promise<{ contentType: string; filename: string; body: Buffer | string | object }> {
  const safe =
    report.title
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 80) || "report";
  switch (format) {
    case "json":
      return {
        contentType: "application/json",
        filename: `${safe}.json`,
        body: report,
      };
    case "csv":
      return {
        contentType: "text/csv; charset=utf-8",
        filename: `${safe}.csv`,
        body: toCsv(report),
      };
    case "xlsx":
      return {
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename: `${safe}.xlsx`,
        body: await toExcel(report),
      };
    case "pdf":
      return {
        contentType: "application/pdf",
        filename: `${safe}.pdf`,
        body: await toPdf(report),
      };
    default:
      throw new AppError("Unsupported export format", 400);
  }
}

/** Flatten nested report objects into tabular rows when possible. */
export function objectToTabular(title: string, data: unknown): TabularReport {
  if (data && typeof data === "object" && Array.isArray((data as { rows?: unknown }).rows)) {
    const rows = (data as { rows: Array<Record<string, unknown>> }).rows;
    const keys = rows[0] ? Object.keys(rows[0]) : ["value"];
    return {
      title,
      meta: pickMeta(data),
      columns: keys.map((k) => ({ key: k, header: k })),
      rows,
    };
  }
  if (data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)) {
    const rows = (data as { items: Array<Record<string, unknown>> }).items;
    const keys = rows[0] ? Object.keys(rows[0]) : ["value"];
    return {
      title,
      meta: pickMeta(data),
      columns: keys.map((k) => ({ key: k, header: k })),
      rows,
    };
  }
  if (data && typeof data === "object" && Array.isArray((data as { accounts?: unknown }).accounts)) {
    const rows = (data as { accounts: Array<Record<string, unknown>> }).accounts;
    const keys = rows[0] ? Object.keys(rows[0]) : ["value"];
    return {
      title,
      meta: pickMeta(data),
      columns: keys.map((k) => ({ key: k, header: k })),
      rows,
    };
  }
  const obj = (data && typeof data === "object" ? data : { value: data }) as Record<
    string,
    unknown
  >;
  const scalars: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      scalars[k] = v;
    }
  }
  const keys = Object.keys(scalars);
  return {
    title,
    meta: pickMeta(data),
    columns: keys.map((k) => ({ key: k, header: k })),
    rows: [scalars],
  };
}

function pickMeta(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object") return undefined;
  const o = data as Record<string, unknown>;
  const meta: Record<string, unknown> = {};
  for (const k of ["from", "to", "asOf", "generatedAt", "definitions", "compare"]) {
    if (o[k] != null) meta[k] = o[k];
  }
  return Object.keys(meta).length ? meta : undefined;
}
