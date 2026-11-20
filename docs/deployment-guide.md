# NOVEX ERP — Production Deployment Guide

## Architecture

| Layer | Component |
|-------|-----------|
| API | `novex_erp_back` (Express + Prisma) |
| DB | Neon PostgreSQL (`public` schema) |
| Frontend | `novex_erp` on Vercel (`https://novexerp.vercel.app`) |
| Media | Cloudinary |
| Process | Node 20+ via PM2 (`ecosystem.config.cjs`) or container |

## Prerequisites

1. Neon project with TLS (`sslmode=require`).
2. Host with Node 20+, outbound HTTPS to Neon + Cloudinary.
3. TLS terminator (Caddy / Nginx / cloud load balancer) — **HTTPS required**.
4. Secrets stored in host env / secret manager — never commit `.env.production`.

## Configuration

1. Copy `.env.production.example` → host secrets (not into git).
2. Required production guards (enforced at boot when `NODE_ENV=production`):
   - `COOKIE_SECURE=true`
   - `DATABASE_URL` contains `sslmode=require`
   - `JWT_ACCESS_SECRET` not containing `change-me`
   - `SEED_ADMIN_PASSWORD` not `123456`
   - Non-localhost `CORS_ORIGIN` entries use `https://`
3. Cross-site cookies (Vercel ↔ API host): `COOKIE_SAME_SITE=none` + `COOKIE_SECURE=true`.
4. `CORS_ORIGIN=https://novexerp.vercel.app` (add staging origins as needed).

## Database procedure

Historical schema evolution used **`npx prisma db push`**.  
`npm run prisma:deploy` is **gated** (`scripts/guard-migrate-deploy.js`).

Reviewed apply:

```bash
npx prisma generate
npx prisma db push
# optional idempotent seed for empty environments only
npm run prisma:seed
```

Emergency migrate deploy (human-reviewed only):

```bash
NOVEX_ALLOW_MIGRATE_DEPLOY=1 npm run prisma:deploy
```

## Build & start

```bash
npm ci
npm run build
pm2 start ecosystem.config.cjs --env production
pm2 save
```

Or: `npm run start` behind a process supervisor with `NODE_ENV=production`.

## Health checks

| Path | Purpose |
|------|---------|
| `GET /health/live` | Process up |
| `GET /health/ready` | DB reachable |
| `GET /health` | Compatibility stamp (`phase: 21-production-ops`) |

Point load balancer readiness at `/health/ready`.

## Frontend

Set Vercel env: `NEXT_PUBLIC_API_URL=https://<your-api-host>`  
Redeploy frontend after API URL is live.

## Rollback

1. Keep previous `dist/` / container image.
2. Restore DB from last verified backup (see backup guide) **or** Neon PITR.
3. Point DNS / LB to previous healthy revision.
4. Re-run `/health/ready` and a smoke login.

## Monitoring (minimum)

- Uptime on `/health/ready`
- PM2 / host disk for `storage/logs` and `storage/backups`
- Neon dashboard CPU/storage + connection count
- Auth failure spikes (rate limiter + lockouts)
