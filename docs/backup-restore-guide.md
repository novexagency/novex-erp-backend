# NOVEX ERP — Backup & Restoration Guide

## Objectives

| Objective | Target | Notes |
|-----------|--------|-------|
| **RPO** (Recovery Point) | ≤ 24h (logical); minutes with Neon PITR | Nightly logical + Neon continuous |
| **RTO** (Recovery Time) | ≤ 4h for API restore from logical backup | Depends on host + DB size |

## Backup types

### 1) Neon platform backups / PITR (primary for production)

- Enable Neon history retention for the project branch.
- Use Neon console restore for point-in-time recovery of the whole database.
- Treat this as the **authoritative** disaster recovery path.

### 2) Application logical backup (portable, checksummed)

```bash
npm run backup:db
```

- Output: `storage/backups/novex-erp-<timestamp>.json` + `.sha256`
- Retention: `BACKUP_RETENTION_DAYS` (default **30**)
- Directory: `BACKUP_DIR` (default `storage/backups`, gitignored)
- Credentials are never printed

Schedule (example cron / Task Scheduler daily 02:00):

```bash
cd /path/to/novex_erp_back && npm run backup:db >> storage/logs/backup.log 2>&1
```

Copy verified `.json` + `.sha256` pairs to encrypted off-host storage (S3 with SSE / encrypted disk).

## Verification

```bash
npm run restore:drill
```

This:

1. Writes a **critical-table** backup and verifies SHA-256  
2. Restores into temporary schema `restore_drill_public`  
3. Compares row counts for inventory/finance-critical tables  
4. Compares `stock_balances.quantityOnHand` sum and posted `sales_invoices.totalAmount`  
5. Drops the drill schema  

**Live tenant data is not modified** (except temporary drill schema).

## Restoration procedures

### A. Neon PITR (preferred)

1. Create a new branch / restore from Neon history.  
2. Point `DATABASE_URL` at the restored endpoint.  
3. `npx prisma generate`  
4. Start API (`pm2 restart novex-erp-api`).  
5. Verify `/health/ready`, login, sample stock valuation + trial balance.

### B. Logical restore (selected tables / drill-proven path)

1. Stop writers (`pm2 stop novex-erp-api`).  
2. Take a fresh safety backup.  
3. Restore using a reviewed SQL/ETL procedure from the JSON backup (or re-run drill pattern into a staging DB first).  
4. Validate critical counts and financial/inventory totals.  
5. Cut over `DATABASE_URL` only after validation.  
6. Start API and smoke-test.

> Full production cutover from JSON into live `public` must be human-supervised. Prefer Neon PITR for whole-DB recovery.

## Secure storage

- Do not commit backups.  
- Restrict filesystem ACLs on `BACKUP_DIR`.  
- Encrypt at rest off-host.  
- Rotate access keys used for off-host sync.

## After any restore — mandatory checks

1. `GET /health/ready`  
2. Superadmin / owner login  
3. Stock valuation for a known tenant  
4. Posted sales invoice totals / AR sample  
5. Trial balance (if accounting in use)  
6. Audit log write smoke  
