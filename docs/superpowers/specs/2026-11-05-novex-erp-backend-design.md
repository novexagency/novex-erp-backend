# Novex ERP Backend — Design (Auth Foundation)

**Date:** 2026-11-05  
**Scope:** Express + TypeScript foundation + secure Auth for full ERP system  
**Frontend:** Next.js app in `novex_erp` (currently mock localStorage auth)

## Goals

- Production-minded API foundation for Novex ERP.
- First vertical: Auth (login / logout / me / refresh).
- Security defaults suitable for a multi-module ERP, not a demo toy.

## Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js 22+, Express 4 |
| Language | TypeScript (strict) |
| DB | PostgreSQL |
| ORM | Prisma |
| Auth | Access JWT + Refresh token in **httpOnly** cookies |
| Validation | Zod |
| Passwords | bcrypt (cost 12) |
| Hardening | helmet, cors (credentials), rate-limit on auth, centralized errors |

## Architecture

Layered Express modules:

```
routes → controllers → services → Prisma
```

```
src/
  app.ts
  server.ts
  config/env.ts
  lib/          # prisma, password, tokens, cookies
  middleware/   # authGuard, errorHandler, validate, rateLimit
  modules/auth/
  types/
prisma/
  schema.prisma
  seed.ts
```

API prefix: `/api/v1`

## Data model (Auth)

**User**

- `id` (uuid), `email` (unique), `passwordHash`, `name`
- `role` enum: `ADMIN` | `USER` (seed starts with ADMIN; permissions expand later)
- `isActive`, `createdAt`, `updatedAt`

**RefreshToken**

- `id`, `userId`, `tokenHash` (sha256 of raw token), `expiresAt`
- `revokedAt` nullable — supports logout + rotation + revocation

## Auth flow (secure)

1. **POST `/api/v1/auth/login`**  
   Validate body → verify user/password → issue:
   - `access_token` cookie (short-lived JWT, ~15m)
   - `refresh_token` cookie (opaque random, ~7d, hashed in DB)  
   Response body: user profile only (no tokens in JSON).

2. **POST `/api/v1/auth/refresh`**  
   Read refresh cookie → verify hash in DB → rotate (revoke old, issue new pair).

3. **POST `/api/v1/auth/logout`**  
   Revoke refresh token in DB → clear both cookies.

4. **GET `/api/v1/auth/me`**  
   Requires valid access cookie → return current user.

### Cookie policy

| Attribute | Value |
|-----------|--------|
| httpOnly | true |
| secure | true in production |
| sameSite | `lax` (dev same-site/proxy); `none` + secure when cross-site prod |
| path | `/` |
| Access maxAge | 15 minutes |
| Refresh maxAge | 7 days |

CORS: allow frontend origin with `credentials: true`.

### Hardening

- Rate limit login/refresh (e.g. 20 req / 15 min per IP).
- Generic error on bad credentials (`Invalid email or password`) — no user enumeration.
- Helmet defaults.
- Env validated at boot (fail fast).
- No public register in v1; admin via Prisma seed.

## Seed

- Email: `admin@novex.com`
- Password: from `SEED_ADMIN_PASSWORD` (default documented in `.env.example` for local only)
- Role: `ADMIN`

## Out of scope (v1)

- Register endpoint
- Full RBAC / module permissions
- Wiring Next.js frontend (follow-up)
- Other ERP modules (Sales, Production, …)

## Success criteria

- `npm run dev` starts API with validated env.
- Seed creates admin; login sets httpOnly cookies.
- `/me` works with cookie; fails without.
- Logout revokes refresh and clears cookies.
- Refresh rotates tokens.
