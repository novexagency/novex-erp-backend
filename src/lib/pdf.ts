import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

const FONT_NAME = "NovexSans";

function candidateFontPaths(): string[] {
  return [
    path.join(process.cwd(), "assets", "fonts", "NotoNaskhArabic-Regular.ttf"),
    path.join(process.cwd(), "dist", "..", "assets", "fonts", "NotoNaskhArabic-Regular.ttf"),
    // dist/lib → repo root/assets (local & Vercel traced layout)
    path.join(__dirname, "..", "..", "assets", "fonts", "NotoNaskhArabic-Regular.ttf"),
    path.join("/var/task", "assets", "fonts", "NotoNaskhArabic-Regular.ttf"),
  ];
}

/** Resolve bundled TTF — never rely on pdfkit Helvetica AFM on serverless. */
export function resolvePdfFontPath(): string | null {
  for (const p of candidateFontPaths()) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Create a PDFDocument that prefers the embedded TTF.
 * Avoids pdfkit standard-font lookups that break when AFM/ICC files are missing on Vercel.
 */
export function createPdfDocument(options?: PDFKit.PDFDocumentOptions): PDFKit.PDFDocument {
  const doc = new PDFDocument(options);
  const fontPath = resolvePdfFontPath();
  if (fontPath) {
    doc.registerFont(FONT_NAME, fontPath);
    doc.font(FONT_NAME);
  }
  return doc;
}

export function pdfFontName(): string {
  return FONT_NAME;
}
