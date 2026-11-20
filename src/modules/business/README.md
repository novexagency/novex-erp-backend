# Tenant Business Modules (scaffold)

Phase 01 prepares this folder for future business modules.  
Do **not** implement full domain logic here until the dedicated phase.

Planned modules (each must filter by `organizationId` / `tenantId`):

| Code | Folder (future) | Notes |
|------|-----------------|-------|
| DASHBOARD | `dashboard/` | KPIs |
| INVENTORY | `inventory/` | **Single warehouse per tenant** |
| SALES | `sales/` | |
| PURCHASING | `purchasing/` | |
| PRODUCTION | `production/` | |
| ACCOUNTING | `accounting/` | |
| HR | `hr/` | Tenant employees only — never platform staff |
| DOCUMENTS | `documents/` | |
| REPORTS | `reports/` | |
| ADMINISTRATION | `administration/` | Tenant admin |

Rules:
1. Every table/query is tenant-scoped.
2. Resolve tenant via `req.tenant` (middleware), never from untrusted body alone.
3. UI copy / API message keys support `en` + `ar`.
