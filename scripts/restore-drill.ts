/**
 * Non-destructive restore drill:
 * 1) Write + checksum-verify a critical-table logical backup
 * 2) Restore into schema restore_drill_public
 * 3) Compare row counts for critical financial/inventory tables
 * 4) Spot-check stock_balances totals vs live
 * 5) Drop drill schema
 *
 * Live public data is only READ (except temporary drill schema).
 * Run: npm run restore:drill
 */
import "dotenv/config";
import path from "node:path";

const DRILL_SCHEMA = "restore_drill_public";

function withPoolTimeout(url: string): string {
  if (url.includes("pool_timeout=")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}pool_timeout=30`;
}

function redact(message: string): string {
  return message.replace(/postgresql:\/\/[^@\s]+@/g, "postgresql://[redacted]@");
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  process.env.DATABASE_URL = withPoolTimeout(databaseUrl);

  const { PrismaClient } = await import("@prisma/client");
  const {
    CRITICAL_RESTORE_TABLES,
    defaultBackupDirectory,
    quoteIdent,
    readLogicalBackup,
    writeLogicalBackup,
  } = await import("./logical-backup.js");

  const prisma = new PrismaClient();
  const started = Date.now();
  let dropped = false;

  try {
    const directory = process.env.BACKUP_DIR || defaultBackupDirectory();
    const written = await writeLogicalBackup(prisma, databaseUrl, directory, {
      onlyTables: [...CRITICAL_RESTORE_TABLES],
      retentionDays: Number(process.env.BACKUP_RETENTION_DAYS || 30),
    });
    const backup = await readLogicalBackup(written.filePath);
    console.log(`Checksum verified for ${path.basename(written.filePath)}`);

    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteIdent(DRILL_SCHEMA)} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${quoteIdent(DRILL_SCHEMA)}`);

    const names = Object.keys(backup.tables).sort();
    for (const key of names) {
      const [, table] = key.split(".");
      if (!table) throw new Error(`Invalid backup table key: ${key}`);
      await prisma.$executeRawUnsafe(
        `CREATE TABLE ${quoteIdent(DRILL_SCHEMA)}.${quoteIdent(table)} (LIKE ${quoteIdent("public")}.${quoteIdent(table)} INCLUDING DEFAULTS)`
      );
      const rows = backup.tables[key] ?? [];
      if (rows.length === 0) continue;
      await prisma.$executeRawUnsafe(
        `INSERT INTO ${quoteIdent(DRILL_SCHEMA)}.${quoteIdent(table)} SELECT * FROM json_populate_recordset(NULL::${quoteIdent("public")}.${quoteIdent(table)}, $1::json)`,
        JSON.stringify(rows)
      );
    }

    let mismatches = 0;
    for (const table of CRITICAL_RESTORE_TABLES) {
      const key = `public.${table}`;
      if (!(key in backup.tables)) {
        // Table may not exist yet in this environment
        continue;
      }
      const live = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT count(*)::int AS count FROM ${quoteIdent("public")}.${quoteIdent(table)}`
      );
      const restored = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT count(*)::int AS count FROM ${quoteIdent(DRILL_SCHEMA)}.${quoteIdent(table)}`
      );
      const liveCount = Number(live[0]?.count ?? -1);
      const restoredCount = Number(restored[0]?.count ?? -1);
      if (liveCount !== restoredCount) {
        mismatches += 1;
        console.error(`Count mismatch ${table}: live ${liveCount}, restored ${restoredCount}`);
      } else {
        console.log(`OK count ${table}: ${liveCount}`);
      }
    }

    // Inventory integrity spot-check: sum of on-hand qty
    try {
      const liveStock = await prisma.$queryRawUnsafe<Array<{ total: string | null }>>(
        `SELECT coalesce(sum("quantityOnHand"),0)::text AS total FROM ${quoteIdent("public")}.${quoteIdent("stock_balances")}`
      );
      const restoredStock = await prisma.$queryRawUnsafe<Array<{ total: string | null }>>(
        `SELECT coalesce(sum("quantityOnHand"),0)::text AS total FROM ${quoteIdent(DRILL_SCHEMA)}.${quoteIdent("stock_balances")}`
      );
      if (String(liveStock[0]?.total) !== String(restoredStock[0]?.total)) {
        mismatches += 1;
        console.error(
          `Stock on-hand sum mismatch: live ${liveStock[0]?.total}, restored ${restoredStock[0]?.total}`
        );
      } else {
        console.log(`OK inventory quantityOnHand sum: ${liveStock[0]?.total}`);
      }
    } catch (err) {
      console.warn("Stock sum check skipped:", err instanceof Error ? err.message : err);
    }

    // Financial spot-check: sales invoice posted totals
    try {
      const liveInv = await prisma.$queryRawUnsafe<Array<{ total: string | null }>>(
        `SELECT coalesce(sum("totalAmount"),0)::text AS total FROM ${quoteIdent("public")}.${quoteIdent("sales_invoices")} WHERE status = 'POSTED'`
      );
      const restoredInv = await prisma.$queryRawUnsafe<Array<{ total: string | null }>>(
        `SELECT coalesce(sum("totalAmount"),0)::text AS total FROM ${quoteIdent(DRILL_SCHEMA)}.${quoteIdent("sales_invoices")} WHERE status = 'POSTED'`
      );
      if (String(liveInv[0]?.total) !== String(restoredInv[0]?.total)) {
        mismatches += 1;
        console.error(
          `Posted sales invoice total mismatch: live ${liveInv[0]?.total}, restored ${restoredInv[0]?.total}`
        );
      } else {
        console.log(`OK posted sales_invoices totalAmount: ${liveInv[0]?.total}`);
      }
    } catch (err) {
      console.warn("Sales total check skipped:", err instanceof Error ? err.message : err);
    }

    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteIdent(DRILL_SCHEMA)} CASCADE`);
    dropped = true;

    const elapsedSeconds = Math.round((Date.now() - started) / 1000);
    if (mismatches > 0) {
      throw new Error(`Restore drill failed with ${mismatches} mismatches`);
    }
    console.log(
      `Restore drill PASSED: ${names.length} tables, ${elapsedSeconds}s, drill schema dropped`
    );
  } finally {
    if (!dropped) {
      await prisma
        .$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteIdent(DRILL_SCHEMA)} CASCADE`)
        .catch(() => undefined);
    }
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "Restore drill failed";
  console.error(redact(message));
  process.exit(1);
});
