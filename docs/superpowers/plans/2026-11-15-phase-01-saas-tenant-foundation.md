# Phase 01 — SaaS Tenant Foundation Implementation Plan

> **For agentic workers:** Execute inline in this session. Stop after Phase 01.

**Goal:** Implement tenant SaaS core architecture (identity, isolation, entitlements, modules scaffold) on the existing Express + Prisma + Neon modular monolith without breaking auth/uploads.

**Architecture:** Keep `Organization.id` as the canonical **tenant ID**. Add tenant context middleware (resolve tenant from authenticated membership / verified cookie — never trust raw client IDs alone). Separate **platform** (NOVEX Central Control) from **tenant** business data via dedicated models + API namespaces. Scaffold subscription entitlements, module toggles, activity, and audit-aware helpers. System locales: `en` + `ar`. Business constraint for later inventory: **single warehouse per tenant**.

**Tech Stack:** Express, TypeScript, Prisma, Neon PostgreSQL, Zod, existing cookie JWT auth

## Global Constraints

- Preserve existing Express/Prisma/Neon infrastructure; do not switch frameworks.
- Preserve Central Control Panel path (`isSuperAdmin` / platform routes).
- Do not mix NOVEX platform staff with tenant employees.
- No cross-tenant data access.
- No external integrations in this phase.
- Do not implement full business modules (Sales/Inventory/etc.) in this phase.
- i18n: Arabic + English (`en` | `ar`).
- Single warehouse per tenant (config flag only in Phase 01).

## File map

- Modify: `prisma/schema.prisma` — tenant SaaS models + Organization locale fields
- Modify: `prisma/seed.ts` — entitlements/modules/settings seed
- Modify: `src/app.ts` — mount platform + tenant routers
- Modify: `src/config/env.ts` — tenant cookie name
- Modify: `src/types/express.d.ts` — `req.tenant`
- Create: `src/lib/tenantDb.ts`
- Create: `src/middleware/tenantContext.ts`
- Create: `src/middleware/platformGuard.ts`
- Create: `src/modules/tenant/*`
- Create: `src/modules/platform/*`
- Create: `scripts/test-tenant-isolation.ts`
- Create: `docs/superpowers/specs/2026-11-15-phase-01-saas-tenant-foundation.md`
- Update: `AGENTS.md`

---
