# Phase 05 — Master Data Management

**Status:** Implemented  
**Date:** 2026-11-15

## Scope

Tenant-scoped master data: products, hierarchical categories, UOM + conversions, brands, taxes, payment methods, expense categories, currencies, departments, job titles, document sequences.

## Rules

- Every row has `organizationId`
- Archive (`status=ARCHIVED`) instead of hard delete for master entities
- Duplicate detection on SKU / barcode / codes / names where applicable
- Categories: adjacency tree, max depth 4
- Single-warehouse product still enforced elsewhere (Phase 03)
- Bilingual fields: `name` + optional `nameAr`

## Base path

`/api/v1/tenant/master-data`

Key endpoints:
- `/products`, `/products/export`, `/products/import`
- `/categories?tree=true`
- `/units`, `/unit-conversions`
- `/brands`, `/taxes`, `/payment-methods`, `/expense-categories`, `/currencies`
- `/departments`, `/job-titles`
- `/document-sequences`

## Tests

`npx tsx scripts/test-master-data.ts`
