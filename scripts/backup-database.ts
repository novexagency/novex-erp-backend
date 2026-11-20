/**
 * Logical backup of the ERP public schema.
 * Writes JSON + SHA-256 sidecar under storage/backups (gitignored).
 * Retains files for BACKUP_RETENTION_DAYS (default 30). Never prints credentials.
 *
 * Run: npm run backup:db
 */
import "dotenv/config";

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
  const { defaultBackupDirectory, writeLogicalBackup } = await import("./logical-backup.js");
  const prisma = new PrismaClient();
  try {
    const directory = process.env.BACKUP_DIR || defaultBackupDirectory();
    const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 30);
    const result = await writeLogicalBackup(prisma, databaseUrl, directory, {
      retentionDays: Number.isFinite(retentionDays) ? retentionDays : 30,
    });
    const tables = Object.keys(result.tableCounts).length;
    const rows = Object.values(result.tableCounts).reduce((sum, count) => sum + count, 0);
    console.log(
      `Backup written: ${tables} tables, ${rows} rows, ${result.bytes} bytes, sha256 ${result.sha256}`
    );
    console.log(`Path: ${result.filePath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "Backup failed";
  console.error(redact(message));
  process.exit(1);
});
