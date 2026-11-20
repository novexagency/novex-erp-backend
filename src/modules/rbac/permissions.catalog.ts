/**
 * Phase 04 — Tenant permission catalog.
 * Codes: `{module}:{action}` (lowercase).
 * Legacy codes from earlier phases are kept for backward compatibility.
 */

export const PERMISSION_MODULES = [
  "dashboard",
  "customers",
  "suppliers",
  "products",
  "categories",
  "sales",
  "sales_invoices",
  "sales_returns",
  "purchases",
  "purchase_orders",
  "purchase_invoices",
  "inventory",
  "stock_adjustments",
  "stock_counts",
  "financial_accounts",
  "receipts_payments",
  "expenses",
  "accounting",
  "employees",
  "attendance",
  "leave",
  "payroll",
  "tasks",
  "projects",
  "assets",
  "reports",
  "settings",
  "roles",
  "users",
] as const;

export const PERMISSION_ACTIONS = [
  "view",
  "create",
  "update",
  "delete",
  "approve",
  "reject",
  "post",
  "cancel",
  "export",
  "print",
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export type PermissionDef = {
  module: string;
  action: string;
  code: string;
  description: string;
};

export function buildGranularPermissions(): PermissionDef[] {
  const defs: PermissionDef[] = [];
  for (const module of PERMISSION_MODULES) {
    for (const action of PERMISSION_ACTIONS) {
      defs.push({
        module: module.toUpperCase(),
        action: action.toUpperCase(),
        code: `${module}:${action}`,
        description: `${action} access for ${module.replaceAll("_", " ")}`,
      });
    }
  }
  return defs;
}

/** Legacy codes still referenced by existing guards/seeds */
export const LEGACY_PERMISSIONS: PermissionDef[] = [
  { module: "AUTH", action: "MANAGE_USERS", code: "users:manage", description: "Manage users and system access" },
  { module: "AUTH", action: "VIEW_USERS", code: "users:read", description: "View user directory" },
  { module: "ORGANIZATION", action: "MANAGE", code: "org:manage", description: "Manage organization profile & settings" },
  { module: "BRANCHES", action: "MANAGE", code: "branches:manage", description: "Manage facilities, plants and warehouses" },
  { module: "BRANCHES", action: "VIEW", code: "branches:read", description: "View branches and facilities" },
  { module: "INVENTORY", action: "MANAGE", code: "inventory:manage", description: "Full control over inventory and stock" },
  { module: "INVENTORY", action: "READ", code: "inventory:read", description: "View inventory levels and movements" },
  { module: "SALES", action: "MANAGE", code: "sales:manage", description: "Manage sales orders, invoices, and clients" },
  { module: "SALES", action: "READ", code: "sales:read", description: "View sales data and reports" },
  { module: "PURCHASING", action: "MANAGE", code: "purchasing:manage", description: "Manage purchase orders and suppliers" },
  { module: "PURCHASING", action: "READ", code: "purchasing:read", description: "View purchase orders" },
  { module: "PRODUCTION", action: "MANAGE", code: "production:manage", description: "Manage BOM, cutting, sewing, and work orders" },
  { module: "PRODUCTION", action: "READ", code: "production:read", description: "View production lines and progress" },
  { module: "FINANCE", action: "MANAGE", code: "finance:manage", description: "Manage treasury, receipts, payments, and expenses" },
  { module: "FINANCE", action: "READ", code: "finance:read", description: "View treasury balances, statements, and reports" },
  { module: "FINANCE", action: "VIEW", code: "finance:view", description: "View financial dashboards and statements" },
  { module: "FINANCE", action: "CREATE", code: "finance:create", description: "Create receipts, payments, and expenses" },
  { module: "FINANCE", action: "UPDATE", code: "finance:update", description: "Update draft financial documents" },
  { module: "FINANCE", action: "APPROVE", code: "finance:approve", description: "Approve expenses and authorize cancellations" },
  { module: "ACCOUNTING", action: "MANAGE", code: "accounting:manage", description: "Manage chart of accounts, journals, and periods" },
  { module: "ACCOUNTING", action: "READ", code: "accounting:read", description: "View general ledger and financial reports" },
  { module: "ACCOUNTING", action: "VIEW", code: "accounting:view", description: "View journals and account statements" },
  { module: "ACCOUNTING", action: "CREATE", code: "accounting:create", description: "Create draft journal entries" },
  { module: "ACCOUNTING", action: "POST", code: "accounting:post", description: "Post draft journal entries" },
  { module: "ACCOUNTING", action: "APPROVE", code: "accounting:approve", description: "Review journals and authorize reversals" },
  { module: "ACCOUNTING", action: "CONFIGURE", code: "accounting:configure", description: "Configure posting rules and seed COA" },
  { module: "ACCOUNTING", action: "REOPEN", code: "accounting:reopen", description: "Authorize reopening of closed or locked periods" },
  { module: "HR", action: "MANAGE", code: "hr:manage", description: "Manage employees, teams, documents, and requests" },
  { module: "HR", action: "READ", code: "hr:read", description: "View employee directory" },
  { module: "HR", action: "VIEW", code: "hr:view", description: "View employee profiles" },
  { module: "HR", action: "CREATE", code: "hr:create", description: "Create employees and HR requests" },
  { module: "HR", action: "UPDATE", code: "hr:update", description: "Update employee profiles and assignments" },
  { module: "HR", action: "SALARY", code: "hr:salary", description: "View and update employee compensation" },
  { module: "HR", action: "DOCUMENTS", code: "hr:documents", description: "Manage employee documents" },
  { module: "HR", action: "APPROVE", code: "hr:approve", description: "Review and approve HR requests, leave, and attendance corrections" },
  { module: "HR", action: "ATTENDANCE", code: "hr:attendance", description: "Manage attendance check-in/out and schedules" },
  { module: "HR", action: "LEAVE", code: "hr:leave", description: "Manage leave types, balances, and requests" },
  { module: "HR", action: "PAYROLL", code: "hr:payroll", description: "Calculate, review, and finalize payroll runs" },
  { module: "OPERATIONS", action: "MANAGE", code: "operations:manage", description: "Manage tasks, projects, assets, and maintenance" },
  { module: "OPERATIONS", action: "READ", code: "operations:read", description: "View operations dashboard and records" },
  { module: "MAINTENANCE", action: "MANAGE", code: "maintenance:manage", description: "Manage maintenance requests and schedules" },
  { module: "MAINTENANCE", action: "VIEW", code: "maintenance:view", description: "View maintenance records" },
  { module: "WORKFLOW", action: "MANAGE", code: "workflow:manage", description: "Manage approval workflows and decide any instance" },
  { module: "WORKFLOW", action: "READ", code: "workflow:read", description: "View workflow definitions and approval history" },
  { module: "WORKFLOW", action: "CONFIGURE", code: "workflow:configure", description: "Configure workflow definitions and steps" },
  { module: "WORKFLOW", action: "APPROVE", code: "workflow:approve", description: "Approve, reject, or delegate assigned approval steps" },
  { module: "DOCUMENTS", action: "MANAGE", code: "documents:manage", description: "Manage central document repository" },
  { module: "DOCUMENTS", action: "READ", code: "documents:read", description: "View and download authorized documents" },
  { module: "NOTIFICATIONS", action: "MANAGE", code: "notifications:manage", description: "Broadcast system notifications and run alert jobs" },
  { module: "NOTIFICATIONS", action: "READ", code: "notifications:read", description: "View own in-app notifications" },
  { module: "DASHBOARD", action: "READ", code: "dashboard:read", description: "View executive dashboard KPIs" },
  { module: "DASHBOARD", action: "MANAGE", code: "dashboard:manage", description: "Manage dashboard access" },
  { module: "REPORTS", action: "READ", code: "reports:read", description: "View operational and financial reports" },
  { module: "REPORTS", action: "EXPORT", code: "reports:export", description: "Export reports as CSV, Excel, or PDF" },
  { module: "REPORTS", action: "MANAGE", code: "reports:manage", description: "Full reports access including sensitive financials" },
  { module: "REPORTS", action: "FINANCE", code: "reports:finance", description: "View financial statements and AR/AP reports" },
  { module: "REPORTS", action: "SALES", code: "reports:sales", description: "View sales analytics reports" },
  { module: "REPORTS", action: "INVENTORY", code: "reports:inventory", description: "View inventory reports" },
  { module: "REPORTS", action: "HR", code: "reports:hr", description: "View HR attendance and payroll reports" },
];

export function allPermissionDefs(): PermissionDef[] {
  const map = new Map<string, PermissionDef>();
  for (const p of [...LEGACY_PERMISSIONS, ...buildGranularPermissions()]) {
    map.set(p.code, p);
  }
  return [...map.values()];
}
