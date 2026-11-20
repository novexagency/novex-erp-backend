# Novex ERP Backend

Express + TypeScript API for Novex ERP (`https://novexerp.vercel.app`).

Built on a domain-agnostic **multi-tenant enterprise ERP core** powered by **Prisma ORM** and **Neon Serverless PostgreSQL (eu-central-1)**.

> **AI Agents & Contributors**: Complete architecture, database schema, endpoints, and cloud metadata are documented in [**`AGENTS.md`**](AGENTS.md).

---

## Stack

- **Runtime & Framework**: Node.js, Express (TypeScript strict mode)
- **Database & ORM**: PostgreSQL on Neon Cloud, Prisma ORM
- **Security & Auth**: HttpOnly cookies, JWT access tokens, cryptographic SHA-256 refresh tokens, Bcrypt, Helmet, CORS, Rate limiting
- **Validation**: Zod schema validation

---

## Cloud Database (Neon)

- **Provider**: Neon Cloud Serverless PostgreSQL (`eu-central-1` Frankfurt)
- **Database**: `neondb`
- **Seeded Organization**: `Novex ERP HQ` (`NOVEX_HQ`)
- **Seeded Superadmin**: `admin@novex.com` / `123456` (Assigned as Organization Owner)

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Push schema to database
npx prisma db push

# 3. Seed initial ERP metadata (superadmin, permissions, roles, sequences)
npm run prisma:seed

# 4. Verify system
npx tsx scripts/test-neon-e2e.ts

# 5. Start dev server
npm run dev
```

API Server: `http://localhost:4000`  
Health Endpoint: `GET /health`

---

## Auth Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/login` | — | Sets httpOnly cookies, returns user + tenant memberships |
| POST | `/api/v1/auth/refresh` | refresh cookie | Rotates refresh token and issues new access token |
| POST | `/api/v1/auth/logout` | — | Revokes refresh token in database & clears cookies |
| GET | `/api/v1/auth/me` | access cookie | Returns current user profile with roles & organizations |

Login request body:
```json
{
  "email": "admin@novex.com",
  "password": "123456"
}
```

---

## Scripts

- `npm run dev` — Watch mode with tsx
- `npm run build` — Compile TypeScript to `dist/`
- `npm start` — Run production build (`node dist/server.js`)
- `npm run prisma:generate` — Generate Prisma Client
- `npm run prisma:seed` — Seed default system roles, permissions, and superadmin
- `npx tsx scripts/verify-offline.ts` — Offline unit verification tests (12 tests)
- `npx tsx scripts/test-neon-e2e.ts` — Live Neon Cloud integration tests (18 tests)
- `npx tsx scripts/test-tenant-isolation.ts` — Phase 01 tenant isolation tests
- `npx tsx scripts/test-auth-security.ts` — Phase 02 auth security tests
- `npx tsx scripts/test-company-config.ts` — Phase 03 company/warehouse config tests
- `npx tsx scripts/test-rbac.ts` — Phase 04 tenant RBAC tests
- `npx tsx scripts/test-master-data.ts` — Phase 05 master data tests

### Master Data (Phase 05)

- Base path: `/api/v1/tenant/master-data`
- Products, categories, units, brands, taxes, currencies, departments, sequences
- Archive instead of delete; import/export preparation endpoints

### RBAC (Phase 04)

- `GET /api/v1/tenant/rbac/permissions`
- `CRUD /api/v1/tenant/rbac/roles`
- `POST /api/v1/tenant/rbac/assignments` (+ `/remove`)

### Company & Warehouse (Phase 03)

- `GET /api/v1/tenant/company` — profile + system config + warehouse
- `PATCH /api/v1/tenant/company/profile`
- `PATCH /api/v1/tenant/company/system-config`
- `GET|PUT /api/v1/tenant/company/warehouse` — **one active warehouse only**

### Tenant Auth (Phase 02)

- Sessions: `GET/DELETE /api/v1/auth/sessions`, `POST /sessions/revoke-all`
- Password: `POST /change-password`, admin reset issue + `POST /password-reset/confirm`
- Activation: `PATCH /api/v1/tenant/users/:userId/active`
- Login history: `GET /api/v1/auth/login-history`

### Tenant APIs (Phase 01)

- `GET /api/v1/tenant/memberships` — tenants for current user
- `POST /api/v1/tenant/switch` — switch active tenant (verified)
- `GET /api/v1/tenant/context` — active tenant context
- `GET /api/v1/platform/tenants` — Central Control (superadmin)

Locales: `en` + `ar`. Warehouse mode: **single** per tenant.
