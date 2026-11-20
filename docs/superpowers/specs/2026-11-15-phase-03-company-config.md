# Phase 03 — Company Profile & System Configuration

**Status:** Implemented  
**Date:** 2026-11-15

## Scope

Tenant-specific company profile, system configuration, and **single active warehouse** setup.

## Models

- Extended `Organization` profile fields (address, phones, contact, activity, description)
- `TenantSystemConfig` (currency default EGP, timezone, formats, fiscal year, tax, invoice/document numbering, locale, text direction)
- `Warehouse` + `WarehouseLocation` (shelves); only one **active** warehouse per tenant

## APIs (`/api/v1/tenant/company`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Full company bundle |
| PATCH | `/profile` | Update company profile |
| PATCH | `/system-config` | Update system configuration |
| GET | `/warehouse` | Get default/single warehouse |
| PUT | `/warehouse` | Upsert the tenant warehouse |
| PATCH | `/warehouse/:warehouseId` | Update warehouse |
| POST | `/warehouse/locations` | Add shelf/location |
| PATCH | `/warehouse/locations/:locationId` | Update location |
| DELETE | `/warehouse/locations/:locationId` | Delete location |

## Rules

- Settings never cross tenants (`organizationId` on every row + assertSameTenant)
- Locales: `en` + `ar`; `textDirection` auto => RTL for `ar`
- No multi-warehouse workflows
- No external integrations

## Tests

`npx tsx scripts/test-company-config.ts`
