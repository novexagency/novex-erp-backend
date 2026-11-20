import type { Prisma } from "@prisma/client";
import { AppError } from "../utils/AppError.js";
import type { TenantId } from "../types/tenant.js";

/**
 * Tenant-aware query helpers.
 * Every tenant-owned read/write must include organizationId (= tenantId).
 */
export function requireTenantId(tenantId: string | undefined | null): TenantId {
  if (!tenantId) {
    throw new AppError("Tenant context required", 403);
  }
  return tenantId;
}

export function tenantWhere(tenantId: TenantId): { organizationId: string } {
  return { organizationId: requireTenantId(tenantId) };
}

export function assertSameTenant(
  recordTenantId: string | null | undefined,
  activeTenantId: TenantId,
  entity = "Record"
): void {
  if (!recordTenantId || recordTenantId !== activeTenantId) {
    throw new AppError(`${entity} not found`, 404);
  }
}

/** Merge organizationId into create data (prevents missing tenant FK). */
export function withTenantCreate<T extends Record<string, unknown>>(
  tenantId: TenantId,
  data: T
): T & { organizationId: string } {
  return {
    ...data,
    organizationId: requireTenantId(tenantId),
  };
}

export type TenantScopedWhere = Prisma.OrganizationMemberWhereInput;
