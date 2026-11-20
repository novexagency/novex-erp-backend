# NOVEX ERP — Production Environment Documentation

## Services

| Name | URL / location | Notes |
|------|----------------|-------|
| ERP API | HTTPS host (TBD until published) | PM2 `novex-erp-api` |
| ERP Frontend | `https://novexerp.vercel.app` | `NEXT_PUBLIC_API_URL` → API |
| Database | Neon `neondb` eu-central-1 | TLS required |
| Media | Cloudinary folder `novex-erp` | Private signing via API |
| Control Panel sync | Admin → `X-Platform-Key` | `PLATFORM_SERVICE_KEY` |

## Environment variables

See `.env.production.example`. Boot fails if production safety checks fail (`src/config/env.ts`).

## Security controls

| Control | Implementation |
|---------|----------------|
| Secrets | Host env / secret manager; `.env*` gitignored |
| HTTPS | Terminated at reverse proxy / platform |
| CORS | Explicit origin list, credentials |
| Cookies | httpOnly; Secure + SameSite in prod |
| Auth | JWT access + rotating refresh; lockouts |
| Authz | Tenant middleware + `requirePermission` |
| Rate limits | Auth 20/15m; API 300/min |
| Uploads | Authenticated Cloudinary only |
| Audit | `AuditLog` / auth events / support access logs |
| Errors | Generic 500 messages in production |

## Performance baseline

- Prisma schema includes **350+** indexes on tenant-scoped tables.  
- List endpoints use pagination (page / pageSize patterns in modules).  
- Prefer Neon **pooled** URL for high-concurrency runtimes; direct URL for migrations/`db push`.  
- Logical backups are offline jobs — not request-path.  
- Caching: HTTP caching not enabled for authenticated APIs (correct for multi-tenant data). Optional Redis not required for Phase 21.

## Process management

```bash
pm2 start ecosystem.config.cjs --env production
pm2 status
pm2 logs novex-erp-api
```

Logs: `storage/logs/pm2-*.log` (gitignored).

## Schema change policy

1. Change `prisma/schema.prisma`  
2. Review indexes / multi-tenant filters  
3. Apply with `npx prisma db push` (or gated migrate deploy)  
4. Run relevant `scripts/test-*.ts`  
5. Take a backup before/after  
