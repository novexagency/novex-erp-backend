import { OpsAssetStatus, OpsMaintenanceStatus, OpsProjectStatus, OpsTaskStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireTenantId } from "../../lib/tenantDb.js";
import type { TenantId } from "../../types/tenant.js";

export async function operationsDashboard(tenantId: TenantId) {
  const tid = requireTenantId(tenantId);
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86400000);

  const [
    overdueTasks,
    projects,
    assetsByStatus,
    maintenanceOpen,
    maintenanceDue,
  ] = await Promise.all([
    prisma.opsTask.findMany({
      where: {
        organizationId: tid,
        dueAt: { lt: now },
        status: { notIn: [OpsTaskStatus.DONE, OpsTaskStatus.CANCELLED] },
      },
      select: {
        id: true,
        code: true,
        title: true,
        priority: true,
        status: true,
        dueAt: true,
        progressPct: true,
      },
      orderBy: { dueAt: "asc" },
      take: 50,
    }),
    prisma.opsProject.findMany({
      where: {
        organizationId: tid,
        status: { in: [OpsProjectStatus.ACTIVE, OpsProjectStatus.PLANNING] },
      },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        progressPct: true,
        budgetAmount: true,
        actualCost: true,
        endDate: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.opsAsset.groupBy({
      by: ["status"],
      where: { organizationId: tid },
      _count: { _all: true },
    }),
    prisma.opsMaintenanceRequest.findMany({
      where: {
        organizationId: tid,
        status: {
          in: [
            OpsMaintenanceStatus.OPEN,
            OpsMaintenanceStatus.SCHEDULED,
            OpsMaintenanceStatus.IN_PROGRESS,
          ],
        },
      },
      include: { asset: { select: { code: true, name: true } } },
      orderBy: { scheduledAt: "asc" },
      take: 50,
    }),
    prisma.opsMaintenanceSchedule.findMany({
      where: {
        organizationId: tid,
        isActive: true,
        nextDueAt: { lte: in7 },
      },
      include: { asset: { select: { code: true, name: true } } },
      orderBy: { nextDueAt: "asc" },
      take: 50,
    }),
  ]);

  const assetStatus: Record<string, number> = {
    [OpsAssetStatus.ACTIVE]: 0,
    [OpsAssetStatus.IN_REPAIR]: 0,
    [OpsAssetStatus.RETIRED]: 0,
    [OpsAssetStatus.DISPOSED]: 0,
  };
  for (const row of assetsByStatus) {
    assetStatus[row.status] = row._count._all;
  }

  return {
    overdueTasks: {
      count: overdueTasks.length,
      items: overdueTasks,
    },
    projectProgress: {
      count: projects.length,
      items: projects.map((p) => ({
        ...p,
        budgetAmount: Number(p.budgetAmount),
        actualCost: Number(p.actualCost),
      })),
    },
    assetStatus,
    maintenance: {
      openRequests: maintenanceOpen,
      dueSchedules: maintenanceDue,
    },
    generatedAt: now.toISOString(),
  };
}
