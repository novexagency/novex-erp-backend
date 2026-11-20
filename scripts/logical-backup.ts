import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export type LogicalBackup = {
  format: "novex-erp-logical-backup-v1";
  createdAt: string;
  databaseHost: string;
  schema: "public";
  tables: Record<string, unknown[]>;
};

export type BackupResult = {
  filePath: string;
  sha256: string;
  bytes: number;
  tableCounts: Record<string, number>;
};

/** Tables required to verify financial + inventory integrity after a restore drill. */
export const CRITICAL_RESTORE_TABLES = [
  "organizations",
  "users",
  "products",
  "stock_balances",
  "inventory_movements",
  "customers",
  "suppliers",
  "sales_invoices",
  "purchase_invoices",
  "journal_entries",
  "journal_lines",
  "treasury_movements",
  "tenant_subscriptions",
] as const;

function quoteIdent(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Rejected SQL identifier: ${value}`);
  return `"${value}"`;
}

function databaseHost(databaseUrl: string): string {
  const normalized = databaseUrl.replace(/^postgresql:/, "http:");
  try {
    return new URL(normalized).hostname;
  } catch {
    return "unknown";
  }
}

function serializeValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { __bytea_base64: value.toString("base64") };
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toFixed?: unknown }).toFixed === "function"
  ) {
    return String(value);
  }
  return value;
}

function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = serializeValue(value);
  }
  return out;
}

export async function listApplicationTables(
  prisma: PrismaClient
): Promise<Array<{ schema: string; table: string }>> {
  const rows = await prisma.$queryRaw<Array<{ table_schema: string; table_name: string }>>`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('_prisma_migrations')
    ORDER BY table_name
  `;
  return rows.map((row) => {
    if (!IDENTIFIER.test(row.table_schema) || !IDENTIFIER.test(row.table_name)) {
      throw new Error("Unexpected table name from information_schema");
    }
    return { schema: row.table_schema, table: row.table_name };
  });
}

export async function writeLogicalBackup(
  prisma: PrismaClient,
  databaseUrl: string,
  directory: string,
  options?: { onlyTables?: string[]; retentionDays?: number }
): Promise<BackupResult> {
  await mkdir(directory, { recursive: true });
  let tables = await listApplicationTables(prisma);
  if (options?.onlyTables?.length) {
    const allow = new Set(options.onlyTables);
    tables = tables.filter((t) => allow.has(t.table));
  }

  const payload: LogicalBackup = {
    format: "novex-erp-logical-backup-v1",
    createdAt: new Date().toISOString(),
    databaseHost: databaseHost(databaseUrl),
    schema: "public",
    tables: {},
  };
  const tableCounts: Record<string, number> = {};

  for (const item of tables) {
    const key = `${item.schema}.${item.table}`;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM ${quoteIdent(item.schema)}.${quoteIdent(item.table)}`
    );
    payload.tables[key] = rows.map(serializeRow);
    tableCounts[key] = rows.length;
  }

  const stamp = payload.createdAt.replace(/[:.]/g, "-");
  const filePath = path.join(directory, `novex-erp-${stamp}.json`);
  const body = JSON.stringify(payload);
  const sha256 = createHash("sha256").update(body).digest("hex");
  await writeFile(filePath, body, { encoding: "utf8", flag: "wx" });
  await writeFile(`${filePath}.sha256`, `${sha256}  ${path.basename(filePath)}\n`, "utf8");
  await pruneOldBackups(directory, options?.retentionDays ?? 30);
  const info = await stat(filePath);
  return { filePath, sha256, bytes: info.size, tableCounts };
}

export async function readLogicalBackup(filePath: string): Promise<LogicalBackup> {
  const body = await readFile(filePath, "utf8");
  const digestFile = await readFile(`${filePath}.sha256`, "utf8");
  const expected = digestFile.split(/\s+/)[0];
  const actual = createHash("sha256").update(body).digest("hex");
  if (!expected || expected !== actual) {
    throw new Error("Backup checksum does not match the file");
  }
  const parsed = JSON.parse(body) as LogicalBackup;
  if (parsed.format !== "novex-erp-logical-backup-v1" || !parsed.tables) {
    throw new Error("Unrecognized backup format");
  }
  return parsed;
}

async function pruneOldBackups(directory: string, retentionDays: number): Promise<number> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  const entries = await readdir(directory);
  for (const entry of entries) {
    if (
      !entry.startsWith("novex-erp-") ||
      (!entry.endsWith(".json") && !entry.endsWith(".sha256"))
    ) {
      continue;
    }
    const full = path.join(directory, entry);
    const info = await stat(full);
    if (info.mtimeMs < cutoff) {
      await unlink(full);
      removed += 1;
    }
  }
  return removed;
}

export function defaultBackupDirectory(): string {
  return path.resolve(process.cwd(), "storage", "backups");
}

export { quoteIdent };
