# Phase 04 — Tenant Roles & Permissions

**Status:** Implemented  
**Date:** 2026-11-15

## Scope

Complete tenant-level RBAC on existing `Role` / `Permission` / `MemberRole` models.

## Catalog

- Modules: dashboard, customers, suppliers, products, categories, sales, sales_invoices, sales_returns, purchases, purchase_orders, purchase_invoices, inventory, stock_adjustments, stock_counts, financial_accounts, receipts_payments, expenses, accounting, employees, attendance, leave, payroll, tasks, projects, assets, reports, settings, roles, users
- Actions: view, create, update, delete, approve, reject, post, cancel, export, print
- Legacy codes retained (`users:manage`, `org:manage`, `sales:read`, …)

## APIs (`/api/v1/tenant/rbac`)

| Method | Path | Permission |
|--------|------|------------|
| GET | `/permissions` | roles:view or users:manage |
| GET | `/roles` | roles:view or users:manage |
| GET | `/roles/:roleId` | roles:view or users:manage |
| POST | `/roles` | roles:create or users:manage |
| PATCH | `/roles/:roleId` | roles:update or users:manage |
| DELETE | `/roles/:roleId` | roles:delete or users:manage |
| POST | `/assignments` | roles:update or users:manage |
| POST | `/assignments/remove` | roles:update or users:manage |
| GET | `/members/:userId` | roles:view or users:manage |

## Security

- `requirePermission` / `requireAnyPermission` guards on backend routes
- System roles (`isSystem`) cannot be deleted or renamed
- Roles with assignments cannot be deleted until unassigned
- Actors cannot grant permission codes they do not possess (unless `users:manage` / superadmin)
- Roles are always scoped by `organizationId` (tenant isolation)

## Tests

`npx tsx scripts/test-rbac.ts`
