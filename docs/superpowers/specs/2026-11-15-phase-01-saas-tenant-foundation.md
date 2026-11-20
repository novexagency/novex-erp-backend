# Phase 01 — SaaS Core Architecture & Tenant Foundation

**Status:** Implemented  
**Date:** 2026-11-15  
**Stack:** Express + Prisma + Neon (existing modular monolith)

## Decisions

| Topic | Decision |
|-------|----------|
| Tenant ID | `Organization.id` is the canonical unique tenant ID |
| Platform vs tenant | Platform tables `platform_staff`, `platform_settings`; tenant SaaS tables `tenant_*`; existing org-scoped tables remain tenant-owned |
| Tenant resolution | From authenticated user membership; optional `X-Tenant-Id` / cookie only after server-side membership check |
| Central Control | `/api/v1/platform/*` requires `isSuperAdmin` |
| i18n | System locales `en` + `ar` (`LocaleCode`, tenant `defaultLocale`, settings) |
| Warehouse | Config key `inventory.warehouseMode=single` (one warehouse per tenant) |
| Business modules | Scaffold only under `src/modules/business/` + `TenantModule` rows |

## Namespaces

### Platform (NOVEX Central Control)
- `platform_staff` — NOVEX internal staff (not tenant employees)
- `platform_settings` — platform-wide keys
- API: `/api/v1/platform`

### Tenant (customer business)
- `organizations` — tenant root
- `organization_members`, roles, branches, departments, audit_logs, …
- `tenant_subscriptions`, `tenant_entitlements`, `tenant_modules`, `tenant_activities`
- API: `/api/v1/tenant`

## APIs added

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/v1/tenant/memberships` | user | List tenants user can access |
| POST | `/api/v1/tenant/switch` | user | Body `{ tenantId }` verified |
| GET | `/api/v1/tenant/context` | user + tenant | Full tenant context |
| GET | `/api/v1/tenant/modules` | user + tenant | Enabled modules |
| GET | `/api/v1/tenant/entitlements` | user + tenant | Subscription + entitlements |
| PATCH | `/api/v1/tenant/config` | user + tenant | Locale / timezone / name |
| GET | `/api/v1/platform/health` | superadmin | Platform namespace health |
| GET | `/api/v1/platform/tenants` | superadmin | List all tenants |

## Isolation rules

1. Never trust frontend `tenantId` without membership verification.
2. Every future business record must include `organizationId`.
3. Cross-tenant reads return 403/404 via `tenantDb` helpers.
4. Platform staff model is separate from tenant HR employees.

## Out of scope (later phases)

- Full inventory/sales/production modules
- PlatformStaff login UI flow
- External integrations
