# Phase 20 — Full QA, Security & Business Workflow Report

**Date:** 2026-11-17  
**Scope:** NOVEX Business OS (`novex_erp_back` + `novex_erp` frontend)  
**Rule:** Only evidence-backed results are marked completed. Untested items are listed as limitations.

---

## Executive summary

Backend domain/security suites largely **passed** against live Neon. Frontend **production build passed**; **ESLint failed**. End-to-end browser QA of all frontend routes against a live API was **not executed** (backend not deployed publicly; no interactive UI automation run in this session). Dark mode was **not found in code** and is therefore **not verified**.

---

## 1. Completed tests (evidence)

### 1.1 Tenant isolation

| Test | Result | Evidence |
|------|--------|----------|
| Service-level cross-tenant deny | PASS | `test-tenant-isolation.ts` 12/12 |
| HTTP: A cannot switch to B | PASS | `test-phase20-security-qa.ts` |
| HTTP: `X-Tenant-Id` spoof does not leak B products | PASS | same |
| HTTP: A cannot GET B product/customer by id | PASS | same |
| Domain isolation (inventory/sales/crm/rbac/finance/accounting/hr/ops/workflow/reports/company) | PASS | respective phase scripts |
| Tenant user blocked from `/api/v1/platform/*` | PASS | Phase20 security QA |
| Platform staff vs tenant users separation | PASS | tenant-isolation + HR suite |

### 1.2 Authentication & permissions

| Test | Result | Evidence |
|------|--------|----------|
| Login success + memberships | PASS | `test-auth-security.ts` |
| Wrong password generic reject | PASS | auth-security + Phase20 |
| Failed login counter / history | PASS | auth-security |
| Password change revokes sessions | PASS | auth-security |
| Session revocation | PASS | auth-security |
| Deactivated user cannot login | PASS | auth-security + Phase20 |
| Suspended subscription blocks tenant login | PASS | auth-security |
| Unauthenticated → 401 | PASS | Phase20 |
| RBAC assign + privilege escalation blocked | PASS | `test-rbac.ts` 10/10 |
| Cross-tenant role access blocked | PASS | rbac |
| Invalid `X-Platform-Key` rejected | PASS | Phase20 |
| Support grant requires reason (min length) | PASS | Phase20 |
| Support grant + revoke | PASS | `test-platform-control.ts` |

### 1.3 Inventory

| Test | Result | Evidence |
|------|--------|----------|
| Opening stock + WAC | PASS | `test-inventory.ts` 16/16 |
| Reservation / sales issue / sales return | PASS | inventory |
| Damaged adjustment | PASS | inventory |
| Negative stock blocked | PASS | inventory |
| Duplicate opening post blocked | PASS | inventory |
| Stock count approve+post | PASS | inventory |
| Valuation + barcode + lots + ledger | PASS | inventory |
| Purchase receiving (partial/full), returns, adjustments | PASS | `test-procurement.ts` (functional asserts passed) |
| Duplicate GRN post blocked | PASS | procurement |

### 1.4 Sales & purchasing

| Test | Result | Evidence |
|------|--------|----------|
| Quotation → order → reserve → deliver → invoice → receipt → return | PASS | `test-sales.ts` 10/10 |
| Customer pricing | PASS | sales |
| Invoice print payload | PASS | sales |
| Supplier PR→PO→GRN→invoice→payment→return | PASS | procurement |
| Outstanding / financial summaries (customers) | PASS | `test-crm.ts` |
| POS checkout, split pay, idempotent duplicate, stock, receipt, cancel, cash discrepancy | PASS | `test-pos.ts` 12/12 |

### 1.5 Accounting & treasury

| Test | Result | Evidence |
|------|--------|----------|
| Unbalanced journal rejected | PASS | `test-accounting.ts` 17/17 |
| Auto-post sales journal + duplicate source blocked | PASS | accounting |
| Draft expense journal when autoPost=false + manual post | PASS | accounting |
| Period lock / reopen auth | PASS | accounting |
| Reversal entries | PASS | accounting |
| Trial balance / IS / BS | PASS | accounting |
| Treasury cash/bank/transfer/receipt/payment/expense/integrity/dashboard/cashflow | PASS | `test-finance.ts` 18/18 |

### 1.6 HR

| Test | Result | Evidence |
|------|--------|----------|
| Employee + compensation gated by `hr:salary` | PASS | `test-hr.ts` 11/11 |
| Documents / teams / requests / org chart | PASS | hr |
| Attendance late/OT/absent/corrections | PASS | `test-hr-payroll.ts` 11/11 |
| Leave approval + balance | PASS | hr-payroll |
| Payroll calc → review → approve → finalize immutable + payslip | PASS | hr-payroll |

### 1.7 Platform / company / master / CRM / workflow / reports / ops

| Suite | Result |
|-------|--------|
| Platform control (provision, seats, modules, support) | 18/18 PASS |
| Company/warehouse config + AR locale | 10/10 PASS |
| Master data | 13/13 PASS |
| CRM | 15/15 PASS |
| Workflow/docs/notifications | 15/15 PASS (after phase stamp fix) |
| Reports/BI exports | 11/11 PASS (after phase stamp fix) |
| Operations | 10/10 PASS (after phase stamp fix; see observations) |

### 1.8 Builds

| Check | Result |
|-------|--------|
| Backend `npm run build` (`tsc`) | **PASS** |
| Frontend `npm run build` (Next.js 16.4.5) | **PASS** (en/ar static routes generated for all modules) |
| Frontend `npm run lint` (eslint) | **FAIL** (see Failed tests) |

---

## 2. Failed tests

| Item | Severity | Detail |
|------|----------|--------|
| Frontend ESLint | Medium | `react-hooks/set-state-in-effect` in `AppShell.jsx`, `Sidebar.jsx`, `GlobalSearch.jsx`, `AuthContext.jsx` (+ a11y warning). Build still succeeds. |
| Procurement script cleanup | Low (harness) | After all procurement asserts passed, cleanup threw FK `inventory_lots_productId_fkey` RESTRICT — leftover fixture risk, not a business assert failure. |
| Ops member create unique constraint log | Low | Prisma logged unique `(projectId,employeeId)` during ops run; suite still reported 10/10. Possible double-add path. |

---

## 3. Fixed issues during QA

1. Updated health-phase guards in `test-operations.ts`, `test-workflow.ts`, `test-reports.ts` to accept `19-frontend-integration` so suites execute against current app stamp (previously hard-failed before any domain assert).
2. Added `scripts/test-phase20-security-qa.ts` for HTTP isolation / authz / SQLi-smoke / mass-assignment elevation checks.

---

## 4. Remaining limitations (not completed / not tested)

| Area | Status |
|------|--------|
| Live browser E2E of every frontend route with real API | **Not tested** |
| Arabic/English UI switching in browser | **Not browser-tested** (dictionaries + `/en/*` `/ar/*` build routes exist; company AR locale asserted in backend) |
| RTL/LTR visual QA | **Not browser-tested** (code sets `dir` via locale; CSS has `html[dir=rtl]` rules) |
| Light/Dark themes | **Not verified** — no `theme` / `dark-mode` implementation found in frontend source |
| Responsive layout device matrix | **Not tested** |
| Frontend forms/tables CRUD against API (Sales, Purchasing, warehouses, etc.) | **Not connected** (Phase 19 Wave 1 only; still mock UI) |
| Session wall-clock JWT expiry wait | **Not timed**; logout/revoke/deactivate covered instead |
| Full “support access cannot bypass tenant ACL” deep path | Grant/revoke + reason enforced; **deep support-impersonation bypass suite not run** |
| Dedicated file-storage IDOR fuzz beyond workflow document ACL | Partial (workflow ACL PASS); Cloudinary IDOR matrix **not fully fuzzed** |
| Load/performance (concurrency, p95 latency) | **Not tested** |
| Automated SQL injection / XSS payload matrix beyond one customer-search smoke | Limited smoke only |
| Partial invoice payment (multi-allocation remainder) | Sales suite marks invoice PAID via receipt — **partial multi-payment remainder not separately asserted** |
| Production module business workflows | **No full backend production engine**; frontend mock only |

---

## 5. Security findings

### Confirmed controls (PASS)

- Cross-tenant switch/spoof/IDOR blocked in tested HTTP paths.
- Tenant users cannot call platform admin APIs.
- Invalid platform service key rejected.
- Deactivated users cannot login.
- RBAC privilege escalation blocked in role management.
- Prisma parameterized queries: SQLi-like search did not drop/destroy customer row.
- Company profile mass-assignment did not elevate `user.isSuperAdmin`.
- Support access requires explicit reason; revoke works.
- Document download ACL + tenant isolation in workflow suite.
- Financial cancel/reopen/post paths require authorization in finance/accounting suites.

### Risks / gaps

1. **Frontend still serves mock business data** on most pages — risk of operators trusting demo numbers if API not connected (Phase 19 incomplete). Dashboard Wave 1 correctly errors without mock fallback.
2. **Cross-site cookie config** for Vercel→future API host not production-validated (`SameSite=None; Secure` required when domains differ) — **untested in prod**.
3. **`PLATFORM_SERVICE_KEY` unset** in local env during platform suite — M2M key path skipped (noted as skip PASS in platform test).
4. ESLint effect-state issues in auth/shell — quality debt, not a confirmed exploit.

---

## 6. Performance findings

- No formal load test.
- Observed: sequential suite runs against Neon completed successfully; individual suites typically minutes-scale.
- Frontend production build ~2–3 minutes; backend `tsc` ~30–40s in this environment.
- Ops suite emitted a unique-constraint error log without failing asserts — investigate duplicate project-member create for robustness.

---

## 7. Frontend route inventory (build-time only)

Present and statically generated for `en` + `ar`:

`/login`, `/dashboard`, `/finished-goods`, `/fabric`, `/accessories`, `/barcode`, `/production`, `/purchasing`, `/sales`, `/accounting`, `/reports`, `/hr`, `/administration`, `/documents`, `/integrations`, `/security`, `/notifications`, `/analytics`

**Connected to API in Wave 1:** login/session/tenant + dashboard.  
**Others:** UI present; business data still mock / incomplete — **not reported as integration-complete**.

---

## 8. Suite scoreboard (this run)

| Suite | Score |
|-------|-------|
| Tenant isolation | 12/12 |
| Auth security | 11/11 |
| RBAC | 10/10 |
| Phase20 security QA | 16/16 |
| Company | 10/10 |
| Master data | 13/13 |
| CRM | 15/15 |
| Procurement (asserts) | 16/16 (+ cleanup error) |
| Inventory | 16/16 |
| Sales | 10/10 |
| POS | 12/12 |
| Finance | 18/18 |
| Accounting | 17/17 |
| HR | 11/11 |
| HR payroll | 11/11 |
| Operations | 10/10 |
| Workflow | 15/15 |
| Reports | 11/11 |
| Platform | 18/18 |
| Backend build | PASS |
| Frontend build | PASS |
| Frontend lint | FAIL |

---

## 9. Verdict

**Backend Business OS core workflows + isolation/authz controls: QA PASS with noted harness/observability issues.**  
**Frontend: build PASS; lint FAIL; full UI/integration/theme/responsive QA NOT complete.**  
**Do not treat Phase 19 module pages as production-ready until later waves replace mocks.**

---

*End of Phase 20 report. Stopped after QA as requested.*
