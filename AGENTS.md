# AGENTS.md — Novex ERP Backend Knowledge Base & Guide

> **Notice for AI Agents & Developers:**  
> This file contains the complete technical context, cloud infrastructure details, database schema architecture, API endpoints, credentials, and verification procedures for this codebase. Read this thoroughly before making changes.

---

## 1. Project Overview & Current State

- **Repository**: `novex_erp_back` (Express + TypeScript + Prisma ORM + PostgreSQL)
- **Role**: Backend API for Novex ERP (`https://novexerp.vercel.app`).
- **Current Status**: **Phases 01–18 complete**; **Phase 19 Wave 1** (frontend auth/dashboard wiring); **Phase 20 QA report**; **Phase 21 production ops tooling** (backup/restore drill/docs — go-live blocked until deploy+restore PASS).
- **Architecture**: Domain-agnostic multi-tenant ERP / SaaS foundation (`Organization.id` = tenant ID) with platform vs tenant namespaces, capable of hosting business modules (Inventory, Sales, Purchasing, Production, Accounting, HR) with isolation. **Locales:** `en` + `ar`. **Inventory constraint:** single warehouse per tenant.
- **Phase 01**: SaaS tenant foundation complete (tenant context middleware, entitlements/modules/activity, platform routes, isolation tests).
- **Phase 18 (Option A)**: ERP `/api/v1/platform/*` is the runtime source of truth for tenants, modules, entitlements, and support access. `novex_admin_back` syncs via `X-Platform-Key` (`PLATFORM_SERVICE_KEY`) and stores `Client.erpOrganizationId`.

---

## 2. Cloud Infrastructure (Neon PostgreSQL)

All database data is hosted in **Neon Cloud Serverless PostgreSQL**.

### Account & Project Metadata
- **Neon Account**: `zeyad.mashaal.156@gmail.com`
- **Neon Organization ID**: `org-wild-breeze-58864160`
- **Neon Project ID**: `little-silence-80448577` (Project Name: `novex-erp`)
- **Neon Branch**: `production` (Branch ID: `br-ancient-river-ba2wviai`)
- **Region**: `AWS Europe Central 1 (Frankfurt)` (`eu-central-1`)
- **Database Name**: `neondb`
- **Database User**: `neondb_owner`

### Connection Strings

1. **Direct Connection (Used by Prisma for migrations, seeding, CLI)**:
   ```text
   postgresql://neondb_owner:npg_wsz9ILSE4Cyg@ep-wandering-scene-baz182e6.c-8.eu-central-1.aws.neon.tech/neondb?sslmode=require&connect_timeout=30
   ```
2. **Pooled Connection (For high-concurrency runtime / serverless functions)**:
   ```text
   postgresql://neondb_owner:npg_wsz9ILSE4Cyg@ep-wandering-scene-baz182e6-pooler.c-8.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

*Note: In local `.env`, `DATABASE_URL` is set to the direct connection with `&connect_timeout=30` to prevent IPv6 timeout delays on Windows.*

---

## 3. Database Architecture (Prisma Schema)

Located in [`prisma/schema.prisma`](prisma/schema.prisma).

### A. Global Identity & Authentication
- **`User` (`users`)**: Global user entity decoupled from any single company.
  - Fields: `id` (UUID), `email` (Unique), `passwordHash` (Bcrypt), `name`, `phone`, `avatarUrl`, `isSuperAdmin` (Boolean, platform owner), `isActive`, `createdAt`, `updatedAt`.
- **`RefreshToken` (`refresh_tokens`)**: Cryptographic session store for token rotation.
  - Fields: `id`, `userId`, `tokenHash` (SHA-256), `expiresAt`, `revokedAt`, `userAgent`, `ipAddress`, `createdAt`.

### B. Multi-Tenancy & Enterprise Hierarchy
- **`Organization` (`organizations`)**: The root company / tenant entity.
  - Fields: `id`, `name`, `code` (Unique, e.g. `NOVEX_HQ`), `taxNumber`, `commercialRegister`, `baseCurrency` (Default: `EGP`), `logoUrl`, `website`, `isActive`, `createdAt`, `updatedAt`.
- **`Branch` (`branches`)**: Physical facilities (Headquarters, Factories, Warehouses, Retail Stores, Offices).
  - Fields: `id`, `organizationId`, `name`, `code`, `type` (`BranchType`), `address`, `city`, `country`, `phone`, `isActive`.
  - Constraint: `@@unique([organizationId, code])`.
- **`Department` (`departments`)**: Functional teams within an organization.
  - Fields: `id`, `organizationId`, `name`, `code`.
  - Constraint: `@@unique([organizationId, name])`.

### C. Dynamic RBAC (Role-Based & Permission-Based Access Control)
- **`OrganizationMember` (`organization_members`)**: Connects a `User` to an `Organization`.
  - Fields: `id`, `organizationId`, `userId`, `departmentId`, `jobTitle`, `status` (`ACTIVE`, `INVITED`, `SUSPENDED`), `joinedAt`.
  - Constraint: `@@unique([organizationId, userId])`.
- **`Permission` (`permissions`)**: Granular action capabilities across ERP modules.
  - Fields: `id`, `module` (e.g. `AUTH`, `ORGANIZATION`, `INVENTORY`, `SALES`, `FINANCE`), `action`, `code` (Unique, e.g. `inventory:read`, `sales:manage`, `users:manage`).
- **`Role` (`roles`)**: Custom or system-defined roles per organization.
  - Fields: `id`, `organizationId`, `name`, `description`, `isSystem`, `createdAt`, `updatedAt`.
  - Constraint: `@@unique([organizationId, name])`.
- **`RolePermission` (`role_permissions`)**: M:N mapping of permissions to roles.
- **`MemberRole` (`member_roles`)**: Maps roles to members, optionally scoped to a specific `branchId`.
  - Constraint: `@@unique([memberId, roleId, branchId])`.

### D. Governance, Sequences & Settings
- **`AuditLog` (`audit_logs`)**: Immutable compliance log for sensitive mutations.
  - Fields: `id`, `organizationId`, `userId`, `action` (`AuditAction`), `entity`, `entityId`, `oldValues` (JSON), `newValues` (JSON), `ipAddress`, `userAgent`, `createdAt`.
- **`DocumentSequence` (`document_sequences`)**: Thread-safe auto-numbering generator for ERP transactions (e.g., `INV-2026-0001`, `PO-2026-0012`).
  - Fields: `id`, `organizationId`, `module`, `prefix`, `year`, `currentNumber`, `padding`.
  - Constraint: `@@unique([organizationId, module, year])`.
- **`OrganizationSetting` (`organization_settings`)**: Key-value settings per tenant.

---

## 4. Default Seed Data (In Cloud Database)

The database in Neon already has the following seeded records:

- **Superadmin User**:
  - Email: `admin@novex.com`
  - Password: `123456`
  - Name: `Novex Admin`
  - Status: `isSuperAdmin = true`
- **Default Organization**:
  - Name: `Novex ERP HQ`
  - Code: `NOVEX_HQ`
  - Base Currency: `EGP`
- **Default Branch**:
  - Name: `Main Headquarters`
  - Code: `HQ-01`
  - Type: `HEADQUARTERS`
- **Default System Roles**:
  - `Owner` (Linked to all 17 core permissions)
  - `Administrator` (Linked to all 17 core permissions)
  - `Manager`, `Staff`, `Auditor`
- **Superadmin Membership**:
  - Admin is assigned to `Novex ERP HQ` with role `Owner` at branch `HQ-01`.
- **Document Sequences Initialized**:
  - `INV` (Sales Invoices)
  - `PO` (Purchase Orders)
  - `WO` (Work Orders)
  - `TRF` (Stock Transfers)

---

## 5. API Endpoints & Contracts

API Base: `http://localhost:4000` (or deployed server URL)

### 1. Health Check
- **`GET /health`**
- Response: `{"success": true, "message": "ok"}`

### 2. Login
- **`POST /api/v1/auth/login`**
- Body:
  ```json
  {
    "email": "admin@novex.com",
    "password": "123456"
  }
  ```
- Sets HTTP-Only cookies:
  - `novex_access` (JWT access token, default 15m)
  - `novex_refresh` (Cryptographic refresh token, default 7d)
- Response:
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "id": "uuid",
        "email": "admin@novex.com",
        "name": "Novex Admin",
        "isSuperAdmin": true,
        "memberships": [
          {
            "organizationId": "uuid",
            "organizationName": "Novex ERP HQ",
            "organizationCode": "NOVEX_HQ",
            "jobTitle": "Chief Executive / Founder",
            "status": "ACTIVE",
            "roles": ["Owner"]
          }
        ]
      }
    }
  }
  ```

### 3. Current User Profile
- **`GET /api/v1/auth/me`**
- Requires `novex_access` cookie (or Bearer token)
- Returns current user with organization memberships and roles.

### 4. Refresh Token Rotation
- **`POST /api/v1/auth/refresh`**
- Reads `novex_refresh` cookie.
- Revokes previous refresh token and issues a new access token and rotated refresh token cookie.

### 5. Logout
- **`POST /api/v1/auth/logout`**
- Revokes the refresh token record in the database and clears cookies.

### 5b. Tenant Auth Sessions (Phase 02)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/change-password` | Change password; revokes all sessions |
| POST | `/api/v1/auth/password-reset/confirm` | Confirm admin-issued reset token |
| GET | `/api/v1/auth/sessions` | List active sessions |
| DELETE | `/api/v1/auth/sessions/:sessionId` | Revoke one session |
| POST | `/api/v1/auth/sessions/revoke-all` | Revoke other sessions |
| GET | `/api/v1/auth/login-history` | Login / security event history |
| POST | `/api/v1/tenant/users/password-reset` | Admin issues reset token (internal handoff) |
| PATCH | `/api/v1/tenant/users/:userId/active` | Activate / deactivate user |
| PATCH | `/api/v1/tenant/users/:userId/membership-status` | ACTIVE / INVITED / SUSPENDED |

Security notes:
- Failed logins recorded; lockout after 5 failures (15m).
- Tenant login blocked if subscription `SUSPENDED`/`CANCELLED` (platform superadmin exempt).
- Password reset is admin/internal only — no email/WhatsApp delivery in Phase 02.
- Suggested role categories seeded (Owner, Administrator, Department Manager, Accountant, Sales/Purchasing/Warehouse/HR/General Employee) — not hardcoded permission boundaries.

### 6. Media Uploads (Cloudinary)
Requires authenticated session (`novex_access` cookie). Max size **10 MB** per file.

Config (via `.env` only — never commit secrets):
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_FOLDER` (default: `novex-erp`)

| Method | Path | Form fields | Description |
|--------|------|-------------|-------------|
| POST | `/api/v1/uploads/image` | `file` (image), optional `organizationId`, `folder` | Upload image |
| POST | `/api/v1/uploads/file` | `file`, optional `organizationId`, `folder` | Upload any file |
| POST | `/api/v1/uploads/many` | `files` (array), optional `organizationId`, `folder` | Upload multiple |
| DELETE | `/api/v1/uploads?publicId=...&resourceType=image\|raw` | — | Delete asset |

Response asset shape:
```json
{
  "publicId": "novex-erp/.../abc",
  "secureUrl": "https://res.cloudinary.com/...",
  "url": "http://res.cloudinary.com/...",
  "resourceType": "image",
  "bytes": 12345,
  "format": "png",
  "width": 800,
  "height": 600
}
```

Frontend must call with `credentials: "include"` and `FormData` (do **not** set `Content-Type` manually).

### 7. Tenant SaaS (Phase 01)

- Canonical tenant ID = `Organization.id`
- Cookie: `novex_tenant` (httpOnly) — verified on every request
- Optional header hint: `X-Tenant-Id` (must match a membership)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/tenant/memberships` | Tenants for current user |
| POST | `/api/v1/tenant/switch` | `{ "tenantId": "uuid" }` |
| GET | `/api/v1/tenant/context` | Active tenant context |
| GET | `/api/v1/tenant/modules` | Enabled business modules |
| GET | `/api/v1/tenant/entitlements` | Subscription + entitlements |
| PATCH | `/api/v1/tenant/config` | Update locale/timezone/name |
| GET | `/api/v1/platform/tenants` | Central Control — list tenants (superadmin) |
| GET | `/api/v1/platform/health` | Central Control health (superadmin) |

Isolation test: `npx tsx scripts/test-tenant-isolation.ts`

### 7b. Platform Control / Business OS (Phase 18)

Auth: superadmin JWT/cookie **or** `X-Platform-Key: $PLATFORM_SERVICE_KEY` (M2M from Control Panel).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/platform/health` | Platform health + module catalog |
| GET | `/api/v1/platform/modules/catalog` | Business module codes |
| GET/POST | `/api/v1/platform/tenants` | List / provision tenant |
| GET | `/api/v1/platform/tenants/:tenantId` | Tenant detail |
| GET | `/api/v1/platform/tenants/:tenantId/status` | Usage + health |
| PATCH | `/api/v1/platform/tenants/:tenantId/subscription` | Plan/status/seats/grace/renew |
| PUT | `/api/v1/platform/tenants/:tenantId/modules` | Enable/disable modules |
| PUT | `/api/v1/platform/tenants/:tenantId/entitlements` | Limits (e.g. `users.max`) |
| GET/POST | `/api/v1/platform/tenants/:tenantId/support-access` | List / grant (reason required) |
| POST | `/api/v1/platform/support-access/:accessId/revoke` | Revoke support access |

Models: `TenantSubscription` (+ grace/renewed), `PlatformSupportAccess`, `PlatformSupportAccessLog`.  
Seat helper: `assertWithinUserSeatLimit`.  
Test: `npx tsx scripts/test-platform-control.ts`

### 8. Company Profile & Warehouse (Phase 03)

Tenant-scoped company settings + **single active warehouse**.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/tenant/company` | Profile + systemConfig + warehouse |
| PATCH | `/api/v1/tenant/company/profile` | Company profile |
| PATCH | `/api/v1/tenant/company/system-config` | Currency/timezone/tax/locale/numbering |
| GET/PUT | `/api/v1/tenant/company/warehouse` | Single warehouse |
| POST/PATCH/DELETE | `/api/v1/tenant/company/warehouse/locations...` | Shelves/locations |

Defaults: currency `EGP`, locales `en`/`ar`, warehouse mode `single`.  
Test: `npx tsx scripts/test-company-config.ts`

### 9. Tenant RBAC (Phase 04)

Granular permissions (`module:action`) + custom roles per tenant.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/tenant/rbac/permissions` | Permission catalog |
| GET/POST | `/api/v1/tenant/rbac/roles` | List / create roles |
| PATCH/DELETE | `/api/v1/tenant/rbac/roles/:roleId` | Update / delete (safe) |
| POST | `/api/v1/tenant/rbac/assignments` | Assign role to user |
| POST | `/api/v1/tenant/rbac/assignments/remove` | Unassign role |
| GET | `/api/v1/tenant/rbac/members/:userId` | Member roles |

Guards: `requirePermission` / `requireAnyPermission` (backend enforced).  
Test: `npx tsx scripts/test-rbac.ts`

### 10. Master Data (Phase 05)

Base: `/api/v1/tenant/master-data`

- Products (SKU/barcode/variants/price history/archive/import-export prep)
- Hierarchical categories (max 4 levels)
- Units + conversions (PCS/BOX/CTN/KG/G/L/M defaults)
- Brands, taxes, payment methods, expense categories, currencies
- Departments, job titles, document sequences

Test: `npx tsx scripts/test-master-data.ts`

### 11. CRM & Customers (Phase 06)

Base: `/api/v1/tenant/crm`

Customer profiles (individual/company), categories, groups, tags, archive, search/filters.
Financial foundation via `CustomerLedgerEntry` (balance, sales, payments, statement, credit utilization).
CRM activities: notes, interactions, follow-ups, sales opportunities, unified timeline.
No email / WhatsApp / calling / external CRM integrations.

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/customers` | List (search/filter) / create |
| GET/PATCH | `/customers/:id` | Get / update |
| POST | `/customers/:id/archive` | Soft-archive |
| GET | `/customers/:id/financial` | Balance, sales, paid, utilization |
| GET | `/customers/:id/statement` | Statement (`?from=&to=`) |
| GET/POST | `/customers/:id/ledger` | Ledger list / add entry |
| GET | `/customers/:id/timeline` | Unified activity timeline |
| GET/POST | `/customers/:id/notes` | Notes |
| GET/POST | `/customers/:id/interactions` | Interaction history |
| GET/POST | `/customers/:id/follow-ups` | Follow-up tasks |
| PATCH | `/follow-ups/:followUpId` | Update follow-up |
| GET/POST | `/customers/:id/opportunities` | Sales opportunities |
| PATCH | `/opportunities/:opportunityId` | Update opportunity |
| GET/POST | `/categories` `/groups` `/tags` | Lookups |

Permissions: `customers:view|create|update` (also accepts `sales:read|view|manage`).  
Test: `npx tsx scripts/test-crm.ts`

### 12. Suppliers & Procurement (Phase 07)

Base: `/api/v1/tenant/procurement`

Suppliers (profiles, categories, ledger), purchasing workflow:
`Purchase Request → Approve → Purchase Order → Goods Receipt (post) → Purchase Invoice → Supplier Payment`.
Purchase returns + authorized stock adjustments.
Inventory foundation: `StockBalance` + immutable `InventoryMovement` (stock changes only on posted GRN / return / adjustment). Single warehouse per tenant.

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/suppliers` `/supplier-categories` | Suppliers + categories |
| GET/PATCH | `/suppliers/:id` | Get / update |
| POST | `/suppliers/:id/archive` | Soft-archive |
| GET | `/suppliers/:id/financial` | Payable balance summary |
| GET/POST | `/purchase-requests` | List / create PR |
| POST | `/purchase-requests/:id/submit\|approve\|reject` | PR workflow |
| GET/POST | `/purchase-orders` | List / create PO |
| POST | `/purchase-orders/:id/issue` | Issue PO |
| POST | `/purchase-orders/:id/attachments` | Attach file metadata |
| GET/POST | `/goods-receipts` | List / create GRN (partial OK) |
| POST | `/goods-receipts/:id/post` | Post GRN → stock IN |
| GET/POST | `/purchase-invoices` | List / create |
| POST | `/purchase-invoices/:id/post` | Post invoice → supplier ledger |
| GET/POST | `/supplier-payments` | Payments + allocations |
| GET/POST | `/purchase-returns` | Returns |
| POST | `/purchase-returns/:id/post` | Post return → stock OUT |
| GET | `/stock` `/stock/:productId` | Stock balances |
| GET | `/inventory-movements` | Movement audit ledger |
| POST | `/stock-adjustments` + `/:id/post` | Authorized adjustments only |

Permissions: `suppliers:*` / `purchases:*` / `purchase_orders:*` / `purchasing:read|manage` / `inventory:*`.  
Test: `npx tsx scripts/test-procurement.ts`

### 13. Advanced Inventory (Phase 08)

Base: `/api/v1/tenant/inventory`

Single warehouse. Stock changes **only** via posted documents → immutable `InventoryMovement` + WAC on `StockBalance`.
`InventoryLot` stores batch/expiry layers (`quantityRemaining`) for future FIFO — valuation stays **Weighted Average**.
Sales issue / return / reservation documents ready for Sales-phase links (`salesOrderId`, etc.).
Negative stock blocked unless `TenantSystemConfig.allowNegativeStock`.

| Area | Endpoints |
|------|-----------|
| Balances | `GET /stock`, `/stock/:productId` (onHand, available, reserved, incoming, outgoing, min/max, reorder) |
| Ledger | `GET /movements` |
| Valuation | `GET /valuation` (WAC) |
| Barcode | `GET /barcode?barcode=` |
| Opening | `POST /opening-stocks` + `/:id/post` |
| Adjustments | `POST /adjustments` + `/:id/post` (`MANUAL`/`DAMAGED`/`EXPIRED`) |
| Sales issue/return | `POST /issues`, `/returns` + post |
| Reservations | `POST /reservations`, `/:id/release` |
| Stock counts | create → record lines → submit → approve → post |
| Alerts/reports | `/alerts/low-stock`, `/alerts/reorder`, `/reports/slow-moving`, `/aging`, `/expiry` |
| Lots | `GET /lots` |

Test: `npx tsx scripts/test-inventory.ts`

### 14. Sales Management & Invoicing (Phase 09)

Base: `/api/v1/tenant/sales`

Workflow: Quotation → Order → Reserve → Deliver (stock issue) → Invoice → Receipt → Return.
Pricing: price lists, customer overrides, discount rules, authorized manual prices (`allowManualPrice`).
Invoice print: `GET /invoices/:id/print` returns print-ready JSON (no e-invoicing / payment gateways).

| Area | Endpoints |
|------|-----------|
| Pricing | `/price-lists`, `/customer-prices`, `/discount-rules`, `/resolve-price` |
| Quotations | CRUD-ish + `/status` + `/convert` |
| Orders | create/confirm/`reserve`/`deliver` |
| Invoices | create/post/cancel + `/print` |
| Receipts | create with invoice allocations |
| Returns | create/post (stock + customer credit) |

Test: `npx tsx scripts/test-sales.ts`

### 15. Point of Sale & Cashier (Phase 10)

Base: `/api/v1/tenant/pos`

Dedicated POS tickets (not full sales-order flow). Cashier shifts with cash in/out, expected vs actual cash, discrepancy approval.
Checkout: barcode/search, cart lines, discounts (auth >5%), tax, customer, cash/credit, split payments, idempotent `clientRequestId`.
Receipt: print-ready JSON + configurable layout. No payment gateways.

| Area | Endpoints |
|------|-----------|
| Catalog | `GET /products/search?q=`, `/barcode` |
| Sessions | `POST /sessions/open`, cash-movements, close, approve |
| Checkout | `POST /checkout` |
| Sales | get/list, cancel, refund, `/receipt` |
| Receipt config | `GET/PUT /receipt-config` |

Test: `npx tsx scripts/test-pos.ts`

### 16. Financial Management — Treasury / Cashbook (Phase 11)

Base: `/api/v1/tenant/finance`

Cashbook-first treasury (not full GL): cashboxes, bank accounts, immutable `TreasuryMovement` ledger, transfers, customer receipts, supplier payments, expenses with optional approval, statements, cash-flow, integrity check. Cancel uses reverse movements (no delete). No external bank sync.

| Area | Endpoints |
|------|-----------|
| Dashboard | `GET /dashboard`, `/balances`, `/cash-flow`, `/reports/expenses` |
| Accounts | `GET/POST /cashboxes`, `/banks` + `/:id/statement` |
| Movements | `POST /movements`, `GET/POST /transfers` + post/cancel |
| Receipts | `GET/POST /receipts` + `/:id/post` + `/:id/cancel` |
| Payments | `GET/POST /payments` + `/:id/post` + `/:id/cancel` |
| Expenses | cost-centers, expenses (+ approve/post/cancel/attachments), recurring |
| Controls | `POST /reconcile`, `POST /integrity` |

Permissions: `finance:read|view|create|update|approve|manage`.
Test: `npx tsx scripts/test-finance.ts`

### 17. General Ledger & Accounting Engine (Phase 12)

Base: `/api/v1/tenant/accounting`

Double-entry GL beside Phase 11 treasury. Hierarchical COA, fiscal years/periods (close/lock/authorized reopen), per-**event-type** posting rules with `autoPost` true|false, immutable journals + reversals, financial reports. Not a tax/regulatory compliance claim.

When `autoPost=true`, journal is created and posted in the same DB transaction as the source document. When `false`, a DRAFT journal is still required (source post fails if rule missing). Duplicate source journals blocked.

| Area | Endpoints |
|------|-----------|
| COA | `GET/POST /accounts`, `PATCH /accounts/:id`, `POST /accounts/seed-defaults` |
| Periods | fiscal-years, periods + `close` / `lock` / `reopen` |
| Rules | `GET /posting-rules`, `PATCH /posting-rules/:eventType` |
| Journals | CRUD draft, `POST .../post`, `POST .../reverse` |
| Reports | trial-balance, general-ledger, income-statement, balance-sheet, cash-flow, account-statement, journals |

Permissions: `accounting:read|view|create|post|approve|configure|reopen|manage`.
Test: `npx tsx scripts/test-accounting.ts`

### 18. Human Resources & Employee Management (Phase 13)

Base: `/api/v1/tenant/hr`

Tenant employee directory separate from NOVEX platform users. Optional `userId` links an employee to ERP login (must already be an `OrganizationMember`). Salary via `EmployeeCompensation` only with `hr:salary` / `hr:manage`. Reuses master-data departments & job titles; adds teams, documents (with expiry), and HR requests with approval history. No payroll/attendance in this phase.

| Area | Endpoints |
|------|-----------|
| Directory | `GET /employees`, `POST /employees`, `GET/PATCH /employees/:id`, `GET /org-chart` |
| Salary | `PUT /employees/:id/compensation` (`hr:salary`) |
| Documents | `GET/POST /employees/:id/documents`, `POST /documents/:id/archive`, `GET /documents/expiring` |
| Teams | `GET/POST /teams`, `PATCH /teams/:id`, members add/remove |
| Requests | `GET/POST /requests`, submit / review / decide / cancel |

Permissions: `hr:read|view|create|update|manage|salary|documents|approve`.
Test: `npx tsx scripts/test-hr.ts`

### 19. Attendance, Leaves & Payroll (Phase 14)

Base: `/api/v1/tenant/hr` (schedules, attendance, leave, payroll sub-routes)

Work schedules/shifts + employee assignments. Soft check-in/out with late/early/OT/absent metrics; corrections need approval. Leave types/balances/requests with approval and balance deduction. Payroll periods/runs: calculate from compensation + attendance + unpaid leave + advances → review → approve → **FINALIZED (immutable)**. Payslip print JSON. Device adapter stub only (no fingerprint/payment providers).

| Area | Endpoints |
|------|-----------|
| Schedules | `GET/POST /schedules`, shifts, `POST /schedule-assignments` |
| Attendance | check-in/out, list, absent, missing, corrections, `device-punch` |
| Leave | leave-types (+ seed), balances, leave-requests submit/decide |
| Payroll | periods, advances, runs calculate/review/approve/finalize |
| Payslip | `GET /payroll/payslips/:lineId/print` |

Permissions: `hr:attendance`, `hr:leave`, `hr:payroll` (+ existing `hr:salary` / `hr:approve`).
Test: `npx tsx scripts/test-hr-payroll.ts`

### 20. Operations — Tasks, Projects, Assets & Maintenance (Phase 15)

Base: `/api/v1/tenant/operations`

Unified operational work management (not GL-heavy): tasks with assignees/comments/events, projects with milestones/members/operational budgets, fixed assets with categories/documents, corrective + preventive maintenance. Sequences: `TASK`, `PRJ`, `AST`, `MNT`. No auto GL posting, IoT, full Gantt, or payment integrations.

| Area | Endpoints |
|------|-----------|
| Dashboard | `GET /dashboard` |
| Tasks | `GET/POST /tasks`, `GET/PATCH /tasks/:id`, assignees, comments |
| Projects | `GET/POST /projects`, `GET/PATCH /projects/:id`, members, milestones, `/report` |
| Assets | `GET/POST /asset-categories`, `GET/POST /assets`, `GET/PATCH /assets/:id`, documents |
| Maintenance | `GET/POST /maintenance`, `PATCH /:id/status`, schedules + `/complete` |

Permissions: `operations:read|manage`, `maintenance:view|manage`.
Test: `npx tsx scripts/test-operations.ts`

### 21. Approval Workflows, Documents & Notifications (Phase 16)

Base: `/api/v1/tenant/workflow`

Hard-gated approval engine: when a tenant has an **active** `WorkflowDefinition` for a document type, domain submit/issue/post starts an `ApprovalInstance` and blocks one-shot domain approve until the engine completes. No definition → existing domain behavior unchanged. Supports single/multi-level steps, role/user/manager assignees, amount limits, rejection reasons, history, escalation status, and authorized delegation. Central document repository (Cloudinary metadata + versions + ACL + entity links). In-app notifications only (no email/WhatsApp/SMS/push).

Document types: `PURCHASE_REQUEST`, `PURCHASE_ORDER`, `SALES_DISCOUNT`, `SALES_RETURN`, `EXPENSE`, `PAYMENT`, `STOCK_ADJUSTMENT`, `LEAVE_REQUEST`, `PAYROLL_RUN`, `MANUAL_JOURNAL`.

| Area | Endpoints |
|------|-----------|
| Definitions | `GET/POST /definitions`, `PATCH /:id`, `POST /:id/steps` |
| Approvals | inbox, list/get, approve/reject/delegate, escalations refresh |
| Delegations | `GET/POST /delegations`, revoke |
| Documents | categories/tags, CRUD, versions, links, download |
| Notifications | list, read/read-all, jobs low-stock / expiring-documents |

Permissions: `workflow:read|configure|approve|manage`, `documents:read|manage`, `notifications:read|manage`.
Test: `npx tsx scripts/test-workflow.ts`

### 22. Advanced Dashboard, Reports & BI (Phase 17)

Base: `/api/v1/tenant/reports`

Unified reporting façade over live tenant data (no demo numbers). Executive dashboard aggregates sales/purchases/expenses, GL net income vs estimated operating indicator (explicitly **not** the same as revenue), treasury cash/bank, AR/AP, inventory WAC value, low stock, top products/customers, HR headcount, pending approvals, overdue tasks. Domain suites: financial (wraps Phase 12 GL + AR/AP + expenses), sales analytics, inventory, HR. Every KPI response includes a `definitions` map. Period comparison via equal-length prior window. Export: `?format=csv|xlsx|pdf` (requires `reports:export`).

| Area | Endpoints |
|------|-----------|
| Dashboard | `GET /dashboard/executive`, `GET /compare` |
| Financial | income-statement, balance-sheet, cash-flow, trial-balance, general-ledger, customer/supplier balances, expenses |
| Sales | by-period, by-customer, by-product, by-employee, returns, discounts |
| Inventory | stock, valuation, movements, low-stock, aging, count-differences, product-profitability |
| HR | attendance, absence, overtime, leave-balances, payroll-summary |

Permissions: `dashboard:read|manage`, `reports:read|export|manage|finance|sales|inventory|hr`.
Test: `npx tsx scripts/test-reports.ts`

---

## 6. How to Run & Verify

```bash
# 1. Install dependencies
npm install

# 2. Push schema changes to Neon cloud database
npx prisma db push

# 3. Re-seed default metadata (Idempotent)
npm run prisma:seed

# 4. Compile check (Strict TypeScript)
npm run build

# 5. Run offline unit tests (Hashing, JWT, Zod, App init)
npx tsx scripts/verify-offline.ts

# 6. Run full End-to-End integration test against live Neon Cloud
npx tsx scripts/test-neon-e2e.ts

# 7. Tenant isolation tests (Phase 01)
npx tsx scripts/test-tenant-isolation.ts

# 8. Auth security tests (Phase 02)
npx tsx scripts/test-auth-security.ts

# 9. Company/warehouse config tests (Phase 03)
npx tsx scripts/test-company-config.ts

# 10. RBAC tests (Phase 04)
npx tsx scripts/test-rbac.ts

# 11. Master data tests (Phase 05)
npx tsx scripts/test-master-data.ts

# 12. CRM & customers tests (Phase 06)
npx tsx scripts/test-crm.ts

# 13. Procurement & inventory foundation tests (Phase 07)
npx tsx scripts/test-procurement.ts

# 14. Advanced inventory tests (Phase 08)
npx tsx scripts/test-inventory.ts

# 15. Sales & invoicing tests (Phase 09)
npx tsx scripts/test-sales.ts

# 16. POS & cashier tests (Phase 10)
npx tsx scripts/test-pos.ts

# 17. Financial / treasury tests (Phase 11)
npx tsx scripts/test-finance.ts

# 18. Accounting / GL tests (Phase 12)
npx tsx scripts/test-accounting.ts

# 19. HR & employee tests (Phase 13)
npx tsx scripts/test-hr.ts

# 20. Attendance / leave / payroll tests (Phase 14)
npx tsx scripts/test-hr-payroll.ts

# 21. Operations tests (Phase 15)
npx tsx scripts/test-operations.ts

# 22. Workflow / documents / notifications tests (Phase 16)
npx tsx scripts/test-workflow.ts

# 23. Reports / dashboard / export tests (Phase 17)
npx tsx scripts/test-reports.ts

# 24. Platform control / CCP integration tests (Phase 18)
npx tsx scripts/test-platform-control.ts

# 25. Start dev server
npm run dev

# 26. Start production build
npm start
```

---

## 7. Rules for Future AI Agents & Developers

1. **Multi-Tenancy is Mandatory**:
   - Every transactional model added in the future (e.g., `Product`, `WarehouseItem`, `Invoice`, `PurchaseOrder`, `BOM`) MUST include `organizationId` with a foreign key to `Organization` and cascade delete.
   - Every read and write query must filter by `organizationId`.
2. **Never Revert to Single-Tenant Auth**:
   - Do NOT add a hardcoded `role` string on `User`. Roles belong to `OrganizationMember` via `MemberRole`.
3. **Use DocumentSequence for Reference Numbers**:
   - When generating order numbers or invoices, use atomic sequence increments on `DocumentSequence`.
4. **Preserve Audit Trail**:
   - Log sensitive state transitions in `AuditLog`.
