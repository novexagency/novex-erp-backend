import {
  AccountingEventType,
  AccountingPeriodStatus,
  FiscalYearStatus,
  GlAccountStatus,
  GlAccountType,
  PrismaClient,
  type Prisma,
} from "@prisma/client";

type Db = Prisma.TransactionClient | PrismaClient;

type AccountSeed = {
  code: string;
  name: string;
  nameAr: string;
  type: GlAccountType;
  systemRole?: string;
  parentCode?: string;
  isPostable?: boolean;
};

const DEFAULT_ACCOUNTS: AccountSeed[] = [
  { code: "1000", name: "Assets", nameAr: "الأصول", type: GlAccountType.ASSET, isPostable: false },
  { code: "1100", name: "Current Assets", nameAr: "أصول متداولة", type: GlAccountType.ASSET, parentCode: "1000", isPostable: false },
  { code: "1110", name: "Cash on Hand", nameAr: "الصندوق", type: GlAccountType.ASSET, parentCode: "1100", systemRole: "CASH" },
  { code: "1120", name: "Bank", nameAr: "البنك", type: GlAccountType.ASSET, parentCode: "1100", systemRole: "BANK" },
  { code: "1130", name: "Accounts Receivable", nameAr: "الذمم المدينة", type: GlAccountType.ASSET, parentCode: "1100", systemRole: "AR" },
  { code: "1140", name: "Inventory", nameAr: "المخزون", type: GlAccountType.ASSET, parentCode: "1100", systemRole: "INVENTORY" },
  { code: "2000", name: "Liabilities", nameAr: "الخصوم", type: GlAccountType.LIABILITY, isPostable: false },
  { code: "2100", name: "Current Liabilities", nameAr: "خصوم متداولة", type: GlAccountType.LIABILITY, parentCode: "2000", isPostable: false },
  { code: "2110", name: "Accounts Payable", nameAr: "الذمم الدائنة", type: GlAccountType.LIABILITY, parentCode: "2100", systemRole: "AP" },
  { code: "2120", name: "Tax Payable", nameAr: "ضرائب مستحقة", type: GlAccountType.LIABILITY, parentCode: "2100", systemRole: "TAX_PAYABLE" },
  { code: "3000", name: "Equity", nameAr: "حقوق الملكية", type: GlAccountType.EQUITY, isPostable: false },
  { code: "3100", name: "Owner Equity", nameAr: "رأس المال", type: GlAccountType.EQUITY, parentCode: "3000", systemRole: "EQUITY" },
  { code: "3200", name: "Opening Balance Equity", nameAr: "أرصدة افتتاحية", type: GlAccountType.EQUITY, parentCode: "3000", systemRole: "OPENING" },
  { code: "4000", name: "Revenue", nameAr: "الإيرادات", type: GlAccountType.REVENUE, isPostable: false },
  { code: "4100", name: "Sales Revenue", nameAr: "إيرادات المبيعات", type: GlAccountType.REVENUE, parentCode: "4000", systemRole: "REVENUE" },
  { code: "5000", name: "Expenses", nameAr: "المصروفات", type: GlAccountType.EXPENSE, isPostable: false },
  { code: "5100", name: "Cost of Goods Sold", nameAr: "تكلفة البضاعة المباعة", type: GlAccountType.EXPENSE, parentCode: "5000", systemRole: "COGS" },
  { code: "5200", name: "Operating Expenses", nameAr: "مصروفات تشغيلية", type: GlAccountType.EXPENSE, parentCode: "5000", systemRole: "EXPENSE" },
];

/** Idempotent SME chart of accounts + fiscal year/periods + per-event posting rules. */
export async function seedAccountingDefaults(tx: Db, organizationId: string) {
  const existingAccounts = await tx.glAccount.findMany({
    where: { organizationId },
    select: { id: true, code: true, systemRole: true },
  });
  const byCode = new Map(existingAccounts.map((a) => [a.code, a.id]));
  const byRole = new Map(
    existingAccounts.filter((a) => a.systemRole).map((a) => [a.systemRole!, a.id])
  );

  const roots = DEFAULT_ACCOUNTS.filter((a) => !a.parentCode);
  const children = DEFAULT_ACCOUNTS.filter((a) => a.parentCode);

  for (const a of [...roots, ...children]) {
    if (byCode.has(a.code)) continue;
    const parentId = a.parentCode ? byCode.get(a.parentCode) : undefined;
    const created = await tx.glAccount.create({
      data: {
        organizationId,
        code: a.code,
        name: a.name,
        nameAr: a.nameAr,
        type: a.type,
        parentId: parentId ?? null,
        isPostable: a.isPostable !== false,
        isSystem: true,
        status: GlAccountStatus.ACTIVE,
        systemRole: a.systemRole ?? null,
      },
    });
    byCode.set(a.code, created.id);
    if (a.systemRole) byRole.set(a.systemRole, created.id);
  }

  const cash = byRole.get("CASH") ?? null;
  const bank = byRole.get("BANK") ?? null;
  const ar = byRole.get("AR") ?? null;
  const ap = byRole.get("AP") ?? null;
  const revenue = byRole.get("REVENUE") ?? null;
  const cogs = byRole.get("COGS") ?? null;
  const inventory = byRole.get("INVENTORY") ?? null;
  const expense = byRole.get("EXPENSE") ?? null;
  const opening = byRole.get("OPENING") ?? null;

  const rules: Array<{
    eventType: AccountingEventType;
    autoPost: boolean;
    debitAccountId: string | null;
    creditAccountId: string | null;
    debitSecondaryId?: string | null;
    creditSecondaryId?: string | null;
    description: string;
  }> = [
    {
      eventType: AccountingEventType.SALES_INVOICE,
      autoPost: true,
      debitAccountId: ar,
      creditAccountId: revenue,
      debitSecondaryId: cogs,
      creditSecondaryId: inventory,
      description: "Dr AR / Cr Revenue (+ optional COGS/Inventory)",
    },
    {
      eventType: AccountingEventType.SALES_RETURN,
      autoPost: true,
      debitAccountId: revenue,
      creditAccountId: ar,
      debitSecondaryId: inventory,
      creditSecondaryId: cogs,
      description: "Reverse sales (Dr Revenue / Cr AR)",
    },
    {
      eventType: AccountingEventType.PURCHASE_INVOICE,
      autoPost: true,
      debitAccountId: inventory,
      creditAccountId: ap,
      description: "Dr Inventory / Cr AP",
    },
    {
      eventType: AccountingEventType.PURCHASE_RETURN,
      autoPost: true,
      debitAccountId: ap,
      creditAccountId: inventory,
      description: "Dr AP / Cr Inventory",
    },
    {
      eventType: AccountingEventType.CUSTOMER_RECEIPT,
      autoPost: true,
      debitAccountId: cash ?? bank,
      creditAccountId: ar,
      description: "Dr Cash/Bank / Cr AR",
    },
    {
      eventType: AccountingEventType.SUPPLIER_PAYMENT,
      autoPost: true,
      debitAccountId: ap,
      creditAccountId: cash ?? bank,
      description: "Dr AP / Cr Cash/Bank",
    },
    {
      eventType: AccountingEventType.EXPENSE,
      autoPost: false,
      debitAccountId: expense,
      creditAccountId: cash ?? bank,
      description: "Dr Expense / Cr Cash (draft for review)",
    },
    {
      eventType: AccountingEventType.INVENTORY_MOVEMENT,
      autoPost: false,
      debitAccountId: expense,
      creditAccountId: inventory,
      description: "Inventory adjustment (draft for review)",
    },
    {
      eventType: AccountingEventType.OPENING_BALANCE,
      autoPost: false,
      debitAccountId: inventory,
      creditAccountId: opening,
      description: "Opening stock / balances (draft for review)",
    },
  ];

  const existingRules = await tx.accountingPostingRule.findMany({
    where: { organizationId },
    select: { eventType: true },
  });
  const haveRule = new Set(existingRules.map((r) => r.eventType));

  for (const r of rules) {
    if (!r.debitAccountId || !r.creditAccountId) continue;
    if (haveRule.has(r.eventType)) continue;
    await tx.accountingPostingRule.create({
      data: {
        organizationId,
        eventType: r.eventType,
        autoPost: r.autoPost,
        isActive: true,
        isSystemDefault: true,
        debitAccountId: r.debitAccountId,
        creditAccountId: r.creditAccountId,
        debitSecondaryId: r.debitSecondaryId ?? null,
        creditSecondaryId: r.creditSecondaryId ?? null,
        description: r.description,
      },
    });
  }

  const year = new Date().getFullYear();
  const yearCode = String(year);
  let fy = await tx.fiscalYear.findUnique({
    where: { organizationId_code: { organizationId, code: yearCode } },
  });
  if (!fy) {
    fy = await tx.fiscalYear.create({
      data: {
        organizationId,
        code: yearCode,
        startDate: new Date(`${year}-01-01T00:00:00.000Z`),
        endDate: new Date(`${year}-12-31T23:59:59.999Z`),
        status: FiscalYearStatus.OPEN,
      },
    });
  }

  const existingPeriods = await tx.accountingPeriod.findMany({
    where: { organizationId, fiscalYearId: fy.id },
    select: { code: true },
  });
  const havePeriod = new Set(existingPeriods.map((p) => p.code));

  for (let m = 1; m <= 12; m++) {
    const code = `${year}-${String(m).padStart(2, "0")}`;
    if (havePeriod.has(code)) continue;
    const start = new Date(Date.UTC(year, m - 1, 1));
    const end = new Date(Date.UTC(year, m, 0, 23, 59, 59, 999));
    await tx.accountingPeriod.create({
      data: {
        organizationId,
        fiscalYearId: fy.id,
        code,
        name: start.toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" }),
        startDate: start,
        endDate: end,
        status: AccountingPeriodStatus.OPEN,
      },
    });
  }

  return { accountCount: byCode.size, year: yearCode };
}
