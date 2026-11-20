import { MasterStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { pageResult, parsePage, type PageQuery } from "./pagination.js";

const MAX_DEPTH = 4;

async function categoryDepth(categoryId: string | null | undefined): Promise<number> {
  let depth = 1;
  let currentId = categoryId ?? null;
  while (currentId) {
    const parent = await prisma.productCategory.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    if (!parent?.parentId) break;
    depth += 1;
    currentId = parent.parentId;
    if (depth > MAX_DEPTH + 1) break;
  }
  return depth;
}

export async function listCategories(tenantId: TenantId, query: PageQuery & { parentId?: string | null; tree?: boolean }) {
  const tid = requireTenantId(tenantId);
  if (query.tree) {
    const all = await prisma.productCategory.findMany({
      where: {
        organizationId: tid,
        status: { not: MasterStatus.ARCHIVED },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    type Node = (typeof all)[number] & { children: Node[] };
    const map = new Map<string, Node>();
    for (const c of all) map.set(c.id, { ...c, children: [] });
    const roots: Node[] = [];
    for (const c of all) {
      const node = map.get(c.id)!;
      if (c.parentId && map.has(c.parentId)) map.get(c.parentId)!.children.push(node);
      else roots.push(node);
    }
    return { tree: roots };
  }

  const p = parsePage(query as Record<string, unknown>);
  const where: Prisma.ProductCategoryWhereInput = {
    organizationId: tid,
    ...(p.includeArchived ? {} : { status: { not: MasterStatus.ARCHIVED } }),
    ...(p.status ? { status: p.status as MasterStatus } : {}),
    ...(query.parentId === "null" || query.parentId === null
      ? { parentId: null }
      : query.parentId
        ? { parentId: query.parentId }
        : {}),
    ...(p.search
      ? {
          OR: [
            { name: { contains: p.search, mode: "insensitive" } },
            { nameAr: { contains: p.search, mode: "insensitive" } },
            { code: { contains: p.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.productCategory.count({ where }),
    prisma.productCategory.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      skip: p.skip,
      take: p.pageSize,
    }),
  ]);
  return pageResult(items, total, p.page, p.pageSize);
}

export async function createCategory(
  tenantId: TenantId,
  data: {
    name: string;
    nameAr?: string | null;
    code?: string | null;
    description?: string | null;
    descriptionAr?: string | null;
    parentId?: string | null;
    status?: MasterStatus;
    sortOrder?: number;
  }
) {
  const tid = requireTenantId(tenantId);
  if (data.code) {
    const dupCode = await prisma.productCategory.findUnique({
      where: { organizationId_code: { organizationId: tid, code: data.code } },
    });
    if (dupCode) throw new AppError("Duplicate category code", 409);
  }
  if (data.parentId) {
    const parent = await prisma.productCategory.findUnique({ where: { id: data.parentId } });
    if (!parent) throw new AppError("Parent category not found", 404);
    assertSameTenant(parent.organizationId, tid);
    const depth = await categoryDepth(data.parentId);
    if (depth >= MAX_DEPTH) {
      throw new AppError(`Category hierarchy cannot exceed ${MAX_DEPTH} levels`, 400);
    }
  }
  return prisma.productCategory.create({
    data: {
      organizationId: tid,
      name: data.name,
      nameAr: data.nameAr,
      code: data.code,
      description: data.description,
      descriptionAr: data.descriptionAr,
      parentId: data.parentId ?? null,
      status: data.status,
      sortOrder: data.sortOrder ?? 0,
    },
  });
}

export async function updateCategory(tenantId: TenantId, id: string, data: Record<string, unknown>) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.productCategory.findUnique({ where: { id } });
  if (!row) throw new AppError("Category not found", 404);
  assertSameTenant(row.organizationId, tid);

  if (data.parentId) {
    if (data.parentId === id) throw new AppError("Category cannot be its own parent", 400);
    const parent = await prisma.productCategory.findUnique({ where: { id: String(data.parentId) } });
    if (!parent) throw new AppError("Parent category not found", 404);
    assertSameTenant(parent.organizationId, tid);
    const depth = await categoryDepth(String(data.parentId));
    if (depth >= MAX_DEPTH) {
      throw new AppError(`Category hierarchy cannot exceed ${MAX_DEPTH} levels`, 400);
    }
  }

  return prisma.productCategory.update({ where: { id }, data });
}

export async function archiveCategory(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.productCategory.findUnique({ where: { id } });
  if (!row) throw new AppError("Category not found", 404);
  assertSameTenant(row.organizationId, tid);
  return prisma.productCategory.update({
    where: { id },
    data: { status: MasterStatus.ARCHIVED, archivedAt: new Date() },
  });
}
