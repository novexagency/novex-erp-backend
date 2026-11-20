# Core ERP Foundational Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the multi-tenant enterprise core ERP database schema using Prisma and PostgreSQL, execute migrations, and seed initial system metadata (superadmin, roles, permissions, branches, sequences).

**Architecture:** Prisma schema modeling global users, organizations (tenants), branches/facilities, dynamic RBAC (roles + permissions), audit logging, and document sequences. PostgreSQL database connection managed via Prisma client.

**Tech Stack:** Node.js, TypeScript, Prisma ORM, PostgreSQL, bcryptjs, tsx.

**Spec:** `docs/superpowers/specs/2026-11-08-core-erp-database-design.md`

## Global Constraints

- Prisma ORM 5.x with PostgreSQL datasource provider
- Foreign keys must use UUID primary keys with default `uuid()`
- Unique constraints on business keys: `(organizationId, code)`, `(organizationId, name)`, `(memberId, roleId, branchId)`
- Passwords hashed using `bcryptjs` with salt rounds >= 10
- All transactional document numbering must use `DocumentSequence`

---

### Task 1: Comprehensive Core ERP Prisma Schema

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: Complete Prisma models (`User`, `RefreshToken`, `Organization`, `Branch`, `Department`, `OrganizationMember`, `Permission`, `Role`, `RolePermission`, `MemberRole`, `AuditLog`, `DocumentSequence`, `OrganizationSetting`)

- [ ] **Step 1: Write the complete schema models in `prisma/schema.prisma`**
- [ ] **Step 2: Run `npx prisma validate` to ensure syntax, relations, and indexes are valid**
- [ ] **Step 3: Generate Prisma Client via `npx prisma generate`**
- [ ] **Step 4: Commit schema changes**

---

### Task 2: Database Connection & Environment Configuration

**Files:**
- Modify: `.env`
- Test: `scripts/test-db-connection.ts`

**Interfaces:**
- Consumes: PostgreSQL connection credentials
- Produces: Working database connection verified via Prisma client

- [ ] **Step 1: Configure active `DATABASE_URL` in `.env`**
- [ ] **Step 2: Write test connection script `scripts/test-db-connection.ts` executing `prisma.$queryRaw`**
- [ ] **Step 3: Run connection test to verify successful connectivity to PostgreSQL**
- [ ] **Step 4: Commit environment template updates**

---

### Task 3: Database Migration

**Files:**
- Create: `prisma/migrations/*_init_core_erp/migration.sql`

**Interfaces:**
- Consumes: `prisma/schema.prisma` and live database connection
- Produces: PostgreSQL tables, foreign key constraints, indexes, and enums

- [ ] **Step 1: Run `npx prisma migrate dev --name init_core_erp` to generate and apply migration**
- [ ] **Step 2: Verify migration table state in PostgreSQL**
- [ ] **Step 3: Commit migration artifacts**

---

### Task 4: Comprehensive Core Seeding Script

**Files:**
- Modify: `prisma/seed.ts`

**Interfaces:**
- Consumes: Seed credentials from `.env` (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, etc.)
- Produces: Initial seed data in database:
  - Global Superadmin user
  - Default Organization ("Novex ERP HQ")
  - Default Branch ("Main Headquarters")
  - System Roles (`Owner`, `Administrator`, `Manager`, `Auditor`, `Staff`)
  - Complete Granular Permissions matrix (`auth`, `organization`, `branches`, `inventory`, `sales`, `production`, `finance`, `hr`)
  - Default Document Sequences (`INV`, `PO`, `WO`, `TRF`)

- [ ] **Step 1: Implement idempotent seed logic in `prisma/seed.ts`**
- [ ] **Step 2: Run `npm run prisma:seed`**
- [ ] **Step 3: Verify created records via database query test**
- [ ] **Step 4: Commit seed script**

---

### Task 5: Core Service & Auth Compatibility Update

**Files:**
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/auth.controller.ts`

**Interfaces:**
- Consumes: New `User` model with `isSuperAdmin` and `memberships`
- Produces: Updated auth service and controller returning user's organizations and permissions on `/api/v1/auth/me`

- [ ] **Step 1: Update auth service query to include user organizations and roles**
- [ ] **Step 2: Test auth build via `npm run build`**
- [ ] **Step 3: Commit auth updates**

