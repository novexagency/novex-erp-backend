import { DocVisibility } from "@prisma/client";
import { buildUploadFolder } from "../../lib/cloudinary.js";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import * as uploadService from "../uploads/upload.service.js";

function assertTenantOwnedUpload(
  tid: string,
  file: { publicId: string; secureUrl: string }
) {
  const folder = buildUploadFolder(tid);
  const publicId = file.publicId.trim();
  if (!publicId.startsWith(`${folder}/`) && publicId !== folder) {
    throw new AppError(
      "File publicId does not belong to this organization's uploads",
      400
    );
  }
  let url: URL;
  try {
    url = new URL(file.secureUrl);
  } catch {
    throw new AppError("Invalid file secureUrl", 400);
  }
  if (!url.hostname.includes("cloudinary.com")) {
    throw new AppError("secureUrl must be a Cloudinary URL from the upload step", 400);
  }
  // Cloudinary paths encode folders; require publicId path segment presence.
  const decodedPath = decodeURIComponent(url.pathname);
  if (!decodedPath.includes(publicId) && !decodedPath.includes(folder)) {
    throw new AppError("secureUrl does not match the uploaded publicId for this tenant", 400);
  }
}

async function userRoleIds(tid: string, userId: string): Promise<string[]> {
  const member = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId: tid, userId },
    },
    include: { memberRoles: true },
  });
  return member?.memberRoles.map((r) => r.roleId) ?? [];
}

export async function canAccessDocument(
  tid: string,
  doc: {
    visibility: DocVisibility;
    ownerUserId: string | null;
    access: Array<{ userId: string | null; roleId: string | null }>;
  },
  userId: string
): Promise<boolean> {
  if (doc.visibility === DocVisibility.TENANT) return true;
  if (doc.ownerUserId === userId) return true;
  if (doc.access.some((a) => a.userId === userId)) return true;
  const roles = await userRoleIds(tid, userId);
  return doc.access.some((a) => a.roleId && roles.includes(a.roleId));
}

export async function listCategories(tenantId: TenantId) {
  return prisma.docCategory.findMany({
    where: { organizationId: requireTenantId(tenantId) },
    orderBy: { name: "asc" },
  });
}

export async function createCategory(
  tenantId: TenantId,
  data: { code: string; name: string; nameAr?: string | null }
) {
  const tid = requireTenantId(tenantId);
  return prisma.docCategory.create({
    data: {
      organizationId: tid,
      code: data.code,
      name: data.name,
      nameAr: data.nameAr,
    },
  });
}

export async function listTags(tenantId: TenantId) {
  return prisma.docTag.findMany({
    where: { organizationId: requireTenantId(tenantId) },
    orderBy: { name: "asc" },
  });
}

export async function createTag(tenantId: TenantId, name: string) {
  return prisma.docTag.create({
    data: { organizationId: requireTenantId(tenantId), name },
  });
}

const docInclude = {
  category: true,
  versions: { orderBy: { version: "desc" as const } },
  access: true,
  links: true,
  tags: { include: { tag: true } },
};

export async function listDocuments(
  tenantId: TenantId,
  userId: string,
  opts?: {
    q?: string;
    categoryId?: string;
    tag?: string;
    entityType?: string;
    entityId?: string;
  }
) {
  const tid = requireTenantId(tenantId);
  const rows = await prisma.repoDocument.findMany({
    where: {
      organizationId: tid,
      archivedAt: null,
      ...(opts?.q
        ? { title: { contains: opts.q, mode: "insensitive" as const } }
        : {}),
      ...(opts?.categoryId ? { categoryId: opts.categoryId } : {}),
      ...(opts?.tag ? { tags: { some: { tag: { name: opts.tag } } } } : {}),
      ...(opts?.entityType && opts?.entityId
        ? {
            links: {
              some: { entityType: opts.entityType, entityId: opts.entityId },
            },
          }
        : {}),
    },
    include: docInclude,
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  const out = [];
  for (const row of rows) {
    if (await canAccessDocument(tid, row, userId)) out.push(row);
  }
  return out;
}

export async function getDocument(tenantId: TenantId, id: string, userId: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.repoDocument.findUnique({
    where: { id },
    include: docInclude,
  });
  if (!row) throw new AppError("Document not found", 404);
  assertSameTenant(row.organizationId, tid);
  if (!(await canAccessDocument(tid, row, userId))) {
    throw new AppError("Document not found", 404);
  }
  return row;
}

export async function createDocument(
  tenantId: TenantId,
  data: {
    title: string;
    categoryId?: string | null;
    visibility?: DocVisibility;
    expiresAt?: string | null;
    tagIds?: string[];
    access?: Array<{ userId?: string | null; roleId?: string | null }>;
    file?: {
      publicId: string;
      secureUrl: string;
      fileName?: string | null;
      bytes?: number | null;
    };
  },
  userId: string
) {
  const tid = requireTenantId(tenantId);
  if (data.file) {
    assertTenantOwnedUpload(tid, data.file);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const doc = await tx.repoDocument.create({
        data: {
          organizationId: tid,
          title: data.title,
          categoryId: data.categoryId,
          visibility: data.visibility ?? DocVisibility.TENANT,
          ownerUserId: userId,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          currentVersion: data.file ? 1 : 0,
        },
      });

      if (data.file) {
        await tx.documentVersion.create({
          data: {
            organizationId: tid,
            documentId: doc.id,
            version: 1,
            publicId: data.file.publicId,
            secureUrl: data.file.secureUrl,
            fileName: data.file.fileName,
            bytes: data.file.bytes,
            uploadedByUserId: userId,
          },
        });
      }

      for (const tagId of data.tagIds ?? []) {
        await tx.docTagOnDocument.create({
          data: { organizationId: tid, documentId: doc.id, tagId },
        });
      }

      for (const a of data.access ?? []) {
        if (!a.userId && !a.roleId) continue;
        await tx.documentAccess.create({
          data: {
            organizationId: tid,
            documentId: doc.id,
            userId: a.userId,
            roleId: a.roleId,
          },
        });
      }

      return tx.repoDocument.findUniqueOrThrow({
        where: { id: doc.id },
        include: docInclude,
      });
    });
  } catch (err) {
    // If DB registration fails after a successful Cloudinary upload, best-effort cleanup.
    if (data.file?.publicId) {
      await uploadService.deleteAsset(data.file.publicId, "raw").catch(() => undefined);
      await uploadService.deleteAsset(data.file.publicId, "image").catch(() => undefined);
    }
    throw err;
  }
}

export async function updateDocument(
  tenantId: TenantId,
  id: string,
  userId: string,
  data: {
    title?: string;
    categoryId?: string | null;
    visibility?: DocVisibility;
    expiresAt?: string | null;
  }
) {
  await getDocument(tenantId, id, userId);
  return prisma.repoDocument.update({
    where: { id },
    data: {
      title: data.title,
      categoryId: data.categoryId,
      visibility: data.visibility,
      expiresAt:
        data.expiresAt === undefined
          ? undefined
          : data.expiresAt
            ? new Date(data.expiresAt)
            : null,
    },
    include: docInclude,
  });
}

export async function archiveDocument(tenantId: TenantId, id: string, userId: string) {
  await getDocument(tenantId, id, userId);
  return prisma.repoDocument.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
}

export async function addVersion(
  tenantId: TenantId,
  id: string,
  userId: string,
  file: {
    publicId: string;
    secureUrl: string;
    fileName?: string | null;
    bytes?: number | null;
  }
) {
  const tid = requireTenantId(tenantId);
  assertTenantOwnedUpload(tid, file);
  const doc = await getDocument(tenantId, id, userId);
  const next = doc.currentVersion + 1;
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.documentVersion.create({
        data: {
          organizationId: tid,
          documentId: id,
          version: next,
          publicId: file.publicId,
          secureUrl: file.secureUrl,
          fileName: file.fileName,
          bytes: file.bytes,
          uploadedByUserId: userId,
        },
      });
      return tx.repoDocument.update({
        where: { id },
        data: { currentVersion: next },
        include: docInclude,
      });
    });
  } catch (err) {
    await uploadService.deleteAsset(file.publicId, "raw").catch(() => undefined);
    await uploadService.deleteAsset(file.publicId, "image").catch(() => undefined);
    throw err;
  }
}

export async function linkDocument(
  tenantId: TenantId,
  id: string,
  userId: string,
  entityType: string,
  entityId: string
) {
  await getDocument(tenantId, id, userId);
  try {
    return await prisma.documentLink.create({
      data: {
        organizationId: requireTenantId(tenantId),
        documentId: id,
        entityType,
        entityId,
      },
    });
  } catch {
    throw new AppError("Document already linked to this entity", 409);
  }
}

export async function downloadDocument(tenantId: TenantId, id: string, userId: string) {
  const doc = await getDocument(tenantId, id, userId);
  const latest = doc.versions[0];
  if (!latest) throw new AppError("No file version available", 404);
  return {
    documentId: doc.id,
    title: doc.title,
    version: latest.version,
    publicId: latest.publicId,
    secureUrl: latest.secureUrl,
    fileName: latest.fileName,
    bytes: latest.bytes,
  };
}
