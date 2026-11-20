import type { LocaleCode, MemberStatus, SubscriptionStatus } from "@prisma/client";

/** Canonical tenant identity — always equals Organization.id */
export type TenantId = string;

export type TenantContext = {
  tenantId: TenantId;
  code: string;
  name: string;
  defaultLocale: LocaleCode;
  timezone: string;
  baseCurrency: string;
  isActive: boolean;
  membership: {
    memberId: string;
    status: MemberStatus;
    jobTitle: string | null;
    roles: string[];
    permissionCodes: string[];
  };
  subscription: {
    planCode: string;
    status: SubscriptionStatus;
    seats: number;
  } | null;
  entitlements: Array<{ code: string; enabled: boolean; limits: unknown }>;
  modules: Array<{ moduleCode: string; enabled: boolean; config: unknown }>;
};

/** Business module codes controlled centrally per tenant (Phase 18). */
export const TENANT_BUSINESS_MODULE_CODES = [
  "DASHBOARD",
  "INVENTORY",
  "SALES",
  "PURCHASING",
  "POS",
  "PRODUCTION",
  "ACCOUNTING",
  "FINANCE",
  "HR",
  "PAYROLL",
  "PROJECTS",
  "ASSETS",
  "MAINTENANCE",
  "OPERATIONS",
  "WORKFLOW",
  "DOCUMENTS",
  "REPORTS",
  "CRM",
  "ADMINISTRATION",
] as const;

export type TenantBusinessModuleCode = (typeof TENANT_BUSINESS_MODULE_CODES)[number];
