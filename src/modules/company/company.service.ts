import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import type { z } from "zod";
import type {
  updateCompanyProfileSchema,
  updateSystemConfigSchema,
  updateWarehouseLocationSchema,
  updateWarehouseSchema,
  upsertWarehouseSchema,
  warehouseLocationSchema,
} from "./company.validation.js";

function resolveTextDirection(locale: "en" | "ar", preference: string): "ltr" | "rtl" {
  if (preference === "ltr" || preference === "rtl") return preference;
  return locale === "ar" ? "rtl" : "ltr";
}

export async function ensureSystemConfig(tenantId: TenantId) {
  const id = requireTenantId(tenantId);
  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org) throw new AppError("Tenant not found", 404);

  return prisma.tenantSystemConfig.upsert({
    where: { organizationId: id },
    update: {},
    create: {
      organizationId: id,
      currency: org.baseCurrency || "EGP",
      timezone: org.timezone || "Africa/Cairo",
      defaultLocale: org.defaultLocale,
      textDirection: "auto",
      invoicePrefix: "INV",
    },
  });
}

export async function ensureDefaultWarehouse(tenantId: TenantId) {
  const id = requireTenantId(tenantId);
  const existing = await prisma.warehouse.findFirst({
    where: { organizationId: id },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  return prisma.warehouse.create({
    data: {
      organizationId: id,
      name: "Main Warehouse",
      code: "WH-01",
      isActive: true,
      isDefault: true,
      country: "Egypt",
    },
  });
}

export async function getCompanyBundle(tenantId: TenantId) {
  const id = requireTenantId(tenantId);
  const [org, config, warehouse, sequences] = await Promise.all([
    prisma.organization.findUnique({ where: { id } }),
    ensureSystemConfig(id),
    ensureDefaultWarehouse(id).then(async (wh) =>
      prisma.warehouse.findUnique({
        where: { id: wh.id },
        include: { locations: { orderBy: { code: "asc" } } },
      })
    ),
    prisma.documentSequence.findMany({
      where: { organizationId: id },
      orderBy: [{ module: "asc" }, { year: "desc" }],
    }),
  ]);

  if (!org) throw new AppError("Tenant not found", 404);

  const effectiveDirection = resolveTextDirection(
    config.defaultLocale,
    config.textDirection
  );

  return {
    profile: {
      tenantId: org.id,
      name: org.name,
      code: org.code,
      logoUrl: org.logoUrl,
      commercialRegister: org.commercialRegister,
      taxNumber: org.taxNumber,
      addressLine1: org.addressLine1,
      addressLine2: org.addressLine2,
      city: org.city,
      country: org.country,
      postalCode: org.postalCode,
      phonePrimary: org.phonePrimary,
      phoneSecondary: org.phoneSecondary,
      emailContact: org.emailContact,
      website: org.website,
      businessActivity: org.businessActivity,
      description: org.description,
    },
    systemConfig: {
      ...config,
      defaultTaxRate:
        config.defaultTaxRate !== null && config.defaultTaxRate !== undefined
          ? Number(config.defaultTaxRate)
          : null,
      effectiveTextDirection: effectiveDirection,
      supportedLocales: ["en", "ar"] as const,
      warehouseMode: "single" as const,
    },
    warehouse,
    documentSequences: sequences,
  };
}

function emptyToNull<T extends Record<string, unknown>>(data: T): T {
  const out = { ...data };
  for (const key of Object.keys(out)) {
    if (out[key] === "") (out as Record<string, unknown>)[key] = null;
  }
  return out;
}

export async function updateCompanyProfile(
  tenantId: TenantId,
  data: z.infer<typeof updateCompanyProfileSchema>
) {
  const id = requireTenantId(tenantId);
  const normalized = emptyToNull(data);
  return prisma.organization.update({
    where: { id },
    data: normalized,
  });
}

export async function updateSystemConfig(
  tenantId: TenantId,
  data: z.infer<typeof updateSystemConfigSchema>
) {
  const id = requireTenantId(tenantId);
  await ensureSystemConfig(id);

  const updated = await prisma.tenantSystemConfig.update({
    where: { organizationId: id },
    data: {
      ...data,
      defaultTaxRate:
        data.defaultTaxRate === undefined
          ? undefined
          : data.defaultTaxRate === null
            ? null
            : new Prisma.Decimal(data.defaultTaxRate),
    },
  });

  // Keep Organization mirrors in sync for locale/currency/timezone
  await prisma.organization.update({
    where: { id },
    data: {
      ...(data.currency ? { baseCurrency: data.currency } : {}),
      ...(data.timezone ? { timezone: data.timezone } : {}),
      ...(data.defaultLocale ? { defaultLocale: data.defaultLocale } : {}),
    },
  });

  // Sync invoice sequence prefix/padding for current year
  if (data.invoicePrefix || data.invoicePadding) {
    const year = new Date().getFullYear();
    await prisma.documentSequence.upsert({
      where: {
        organizationId_module_year: {
          organizationId: id,
          module: "SALES_INVOICE",
          year,
        },
      },
      update: {
        ...(data.invoicePrefix ? { prefix: data.invoicePrefix } : {}),
        ...(data.invoicePadding ? { padding: data.invoicePadding } : {}),
      },
      create: {
        organizationId: id,
        module: "SALES_INVOICE",
        prefix: data.invoicePrefix || "INV",
        year,
        currentNumber: 0,
        padding: data.invoicePadding || 4,
      },
    });
  }

  if (data.documentPadding) {
    await prisma.documentSequence.updateMany({
      where: { organizationId: id },
      data: { padding: data.documentPadding },
    });
  }

  return updated;
}

async function assertSingleActiveWarehouse(tenantId: TenantId, keepId?: string) {
  const active = await prisma.warehouse.findMany({
    where: {
      organizationId: tenantId,
      isActive: true,
      ...(keepId ? { NOT: { id: keepId } } : {}),
    },
  });
  if (active.length > 0) {
    throw new AppError(
      "Only one active warehouse is allowed. Deactivate the current warehouse first.",
      409
    );
  }
}

export async function getWarehouse(tenantId: TenantId) {
  const id = requireTenantId(tenantId);
  const warehouse = await ensureDefaultWarehouse(id);
  return prisma.warehouse.findFirst({
    where: { id: warehouse.id, organizationId: id },
    include: { locations: { orderBy: { code: "asc" } } },
  });
}

export async function upsertWarehouse(
  tenantId: TenantId,
  data: z.infer<typeof upsertWarehouseSchema>
) {
  const id = requireTenantId(tenantId);
  const warehouses = await prisma.warehouse.findMany({
    where: { organizationId: id },
    orderBy: { createdAt: "asc" },
  });
  const current = warehouses[0];

  // Product version: never create a second warehouse for a tenant
  if (warehouses.length > 1) {
    // Heal legacy duplicates by keeping the first as the only editable warehouse
  }

  const wantActive = data.isActive ?? true;

  if (current) {
    if (wantActive && !current.isActive) {
      await assertSingleActiveWarehouse(id, current.id);
    }
    return prisma.warehouse.update({
      where: { id: current.id },
      data: {
        name: data.name,
        code: data.code,
        address: data.address ?? null,
        city: data.city ?? null,
        country: data.country ?? current.country,
        managerUserId: data.managerUserId ?? null,
        managerName: data.managerName ?? null,
        isActive: wantActive,
        isDefault: true,
      },
      include: { locations: true },
    });
  }

  return prisma.warehouse.create({
    data: {
      organizationId: id,
      name: data.name,
      code: data.code,
      address: data.address ?? null,
      city: data.city ?? null,
      country: data.country ?? "Egypt",
      managerUserId: data.managerUserId ?? null,
      managerName: data.managerName ?? null,
      isActive: wantActive,
      isDefault: true,
    },
    include: { locations: true },
  });
}

export async function updateWarehouse(
  tenantId: TenantId,
  warehouseId: string,
  data: z.infer<typeof updateWarehouseSchema>
) {
  const id = requireTenantId(tenantId);
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw new AppError("Warehouse not found", 404);
  assertSameTenant(warehouse.organizationId, id, "Warehouse");

  if (data.isActive === true && !warehouse.isActive) {
    await assertSingleActiveWarehouse(id, warehouse.id);
  }

  return prisma.warehouse.update({
    where: { id: warehouseId },
    data: {
      ...data,
      isDefault: true,
    },
    include: { locations: { orderBy: { code: "asc" } } },
  });
}

/** Product rule helper — exposes single-warehouse constraint for tests/API docs */
export async function countWarehouses(tenantId: TenantId) {
  return prisma.warehouse.count({ where: { organizationId: requireTenantId(tenantId) } });
}

export async function addWarehouseLocation(
  tenantId: TenantId,
  data: z.infer<typeof warehouseLocationSchema>
) {
  const id = requireTenantId(tenantId);
  const warehouse = await getWarehouse(id);
  if (!warehouse) throw new AppError("Warehouse not found", 404);

  return prisma.warehouseLocation.create({
    data: {
      organizationId: id,
      warehouseId: warehouse.id,
      name: data.name,
      code: data.code,
      isActive: data.isActive ?? true,
    },
  });
}

export async function updateWarehouseLocation(
  tenantId: TenantId,
  locationId: string,
  data: z.infer<typeof updateWarehouseLocationSchema>
) {
  const id = requireTenantId(tenantId);
  const location = await prisma.warehouseLocation.findUnique({ where: { id: locationId } });
  if (!location) throw new AppError("Location not found", 404);
  assertSameTenant(location.organizationId, id, "Location");

  return prisma.warehouseLocation.update({
    where: { id: locationId },
    data,
  });
}

export async function deleteWarehouseLocation(tenantId: TenantId, locationId: string) {
  const id = requireTenantId(tenantId);
  const location = await prisma.warehouseLocation.findUnique({ where: { id: locationId } });
  if (!location) throw new AppError("Location not found", 404);
  assertSameTenant(location.organizationId, id, "Location");

  await prisma.warehouseLocation.delete({ where: { id: locationId } });
}
