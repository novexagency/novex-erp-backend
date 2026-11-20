import { NotificationSeverity, NotificationType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

export async function createNotification(
  tenantId: TenantId,
  data: {
    userId: string;
    type: NotificationType;
    title: string;
    body?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    severity?: NotificationSeverity;
  }
) {
  const tid = requireTenantId(tenantId);
  return prisma.notification.create({
    data: {
      organizationId: tid,
      userId: data.userId,
      type: data.type,
      title: data.title,
      body: data.body,
      entityType: data.entityType,
      entityId: data.entityId,
      severity: data.severity ?? NotificationSeverity.INFO,
    },
  });
}

export async function notifyUsers(
  tenantId: TenantId,
  userIds: string[],
  data: {
    type: NotificationType;
    title: string;
    body?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    severity?: NotificationSeverity;
  }
) {
  const unique = [...new Set(userIds.filter(Boolean))];
  for (const userId of unique) {
    await createNotification(tenantId, { ...data, userId });
  }
}

export async function listNotifications(
  tenantId: TenantId,
  userId: string,
  opts?: { unreadOnly?: boolean }
) {
  const tid = requireTenantId(tenantId);
  return prisma.notification.findMany({
    where: {
      organizationId: tid,
      userId,
      ...(opts?.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function unreadCount(tenantId: TenantId, userId: string) {
  const tid = requireTenantId(tenantId);
  return prisma.notification.count({
    where: { organizationId: tid, userId, readAt: null },
  });
}

export async function markRead(tenantId: TenantId, id: string, userId: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.notification.findUnique({ where: { id } });
  if (!row) throw new AppError("Notification not found", 404);
  assertSameTenant(row.organizationId, tid);
  if (row.userId !== userId) throw new AppError("Notification not found", 404);
  return prisma.notification.update({
    where: { id },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(tenantId: TenantId, userId: string) {
  const tid = requireTenantId(tenantId);
  await prisma.notification.updateMany({
    where: { organizationId: tid, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { ok: true };
}

export async function runLowStockJob(tenantId: TenantId, recipientUserIds: string[]) {
  const tid = requireTenantId(tenantId);
  const all = await prisma.stockBalance.findMany({
    where: { organizationId: tid },
    take: 200,
    include: {
      product: { select: { sku: true, name: true, minStock: true, reorderLevel: true } },
    },
  });
  const low = all.filter((b) => {
    const onHand = Number(b.quantityOnHand);
    const reorder = Number(b.product.reorderLevel ?? 0);
    const min = Number(b.product.minStock ?? 0);
    const threshold = reorder > 0 ? reorder : min;
    return threshold > 0 && onHand <= threshold;
  });

  if (low.length === 0) return { notified: 0, items: 0 };
  const body = low
    .slice(0, 10)
    .map((b) => `${b.product.sku}: ${Number(b.quantityOnHand)}`)
    .join(", ");
  await notifyUsers(tid, recipientUserIds, {
    type: NotificationType.LOW_STOCK,
    title: `Low stock: ${low.length} item(s)`,
    body,
    entityType: "STOCK",
    severity: NotificationSeverity.WARNING,
  });
  return { notified: recipientUserIds.length, items: low.length };
}

export async function runExpiringDocumentsJob(
  tenantId: TenantId,
  recipientUserIds: string[],
  withinDays = 30
) {
  const tid = requireTenantId(tenantId);
  const until = new Date();
  until.setUTCDate(until.getUTCDate() + withinDays);

  const repoDocs = await prisma.repoDocument.findMany({
    where: {
      organizationId: tid,
      archivedAt: null,
      expiresAt: { lte: until, not: null },
    },
    take: 50,
  });

  const empDocs = await prisma.employeeDocument.findMany({
    where: {
      organizationId: tid,
      archivedAt: null,
      expiresAt: { lte: until, not: null },
    },
    take: 50,
  });

  const total = repoDocs.length + empDocs.length;
  if (total === 0) return { notified: 0, items: 0 };

  await notifyUsers(tid, recipientUserIds, {
    type: NotificationType.DOCUMENT_EXPIRING,
    title: `Expiring documents: ${total}`,
    body: `${repoDocs.length} repository, ${empDocs.length} employee docs within ${withinDays} days`,
    entityType: "DOCUMENT",
    severity: NotificationSeverity.WARNING,
  });
  return { notified: recipientUserIds.length, items: total };
}
