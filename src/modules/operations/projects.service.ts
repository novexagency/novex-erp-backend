import { OpsProjectStatus, Prisma } from "@prisma/client";
import { nextDocumentNumber } from "../../lib/documentNumber.js";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

const projectInclude = {
  manager: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
  members: {
    include: {
      employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
    },
  },
  milestones: { orderBy: { dueAt: "asc" as const } },
  tasks: {
    select: { id: true, code: true, title: true, status: true, progressPct: true, dueAt: true },
  },
};

export async function listProjects(tenantId: TenantId, status?: string) {
  return prisma.opsProject.findMany({
    where: {
      organizationId: requireTenantId(tenantId),
      ...(status ? { status: status as OpsProjectStatus } : {}),
    },
    include: projectInclude,
    orderBy: { createdAt: "desc" },
  });
}

export async function getProject(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.opsProject.findUnique({ where: { id }, include: projectInclude });
  if (!row) throw new AppError("Project not found", 404);
  assertSameTenant(row.organizationId, tid);
  return row;
}

export async function createProject(
  tenantId: TenantId,
  data: {
    name: string;
    nameAr?: string | null;
    description?: string | null;
    status?: OpsProjectStatus;
    managerEmployeeId?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    budgetAmount?: number;
    currency?: string;
    memberIds?: string[];
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  if (data.managerEmployeeId) {
    const m = await prisma.employee.findFirst({
      where: { id: data.managerEmployeeId, organizationId: tid },
    });
    if (!m) throw new AppError("Manager employee not found", 404);
  }

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "PRJ", "PRJ");
    const project = await tx.opsProject.create({
      data: {
        organizationId: tid,
        code,
        name: data.name,
        nameAr: data.nameAr,
        description: data.description,
        status: data.status ?? OpsProjectStatus.PLANNING,
        managerEmployeeId: data.managerEmployeeId,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        budgetAmount: new Prisma.Decimal(data.budgetAmount ?? 0),
        currency: data.currency || "EGP",
        createdByUserId: userId,
      },
    });

    for (const employeeId of data.memberIds ?? []) {
      const emp = await tx.employee.findFirst({ where: { id: employeeId, organizationId: tid } });
      if (!emp) throw new AppError(`Project member not found: ${employeeId}`, 404);
      await tx.opsProjectMember.create({
        data: { organizationId: tid, projectId: project.id, employeeId },
      });
    }

    return tx.opsProject.findUniqueOrThrow({ where: { id: project.id }, include: projectInclude });
  });
}

export async function updateProject(
  tenantId: TenantId,
  id: string,
  data: Partial<{
    name: string;
    nameAr: string | null;
    description: string | null;
    status: OpsProjectStatus;
    managerEmployeeId: string | null;
    startDate: string | null;
    endDate: string | null;
    budgetAmount: number;
    actualCost: number;
    progressPct: number;
  }>
) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.opsProject.findUnique({ where: { id } });
  if (!row) throw new AppError("Project not found", 404);
  assertSameTenant(row.organizationId, tid);

  return prisma.opsProject.update({
    where: { id },
    data: {
      name: data.name,
      nameAr: data.nameAr,
      description: data.description,
      status: data.status,
      managerEmployeeId: data.managerEmployeeId,
      startDate:
        data.startDate === undefined
          ? undefined
          : data.startDate
            ? new Date(data.startDate)
            : null,
      endDate:
        data.endDate === undefined ? undefined : data.endDate ? new Date(data.endDate) : null,
      budgetAmount:
        data.budgetAmount !== undefined ? new Prisma.Decimal(data.budgetAmount) : undefined,
      actualCost: data.actualCost !== undefined ? new Prisma.Decimal(data.actualCost) : undefined,
      progressPct:
        data.progressPct !== undefined
          ? Math.min(100, Math.max(0, data.progressPct))
          : undefined,
    },
    include: projectInclude,
  });
}

export async function addProjectMember(
  tenantId: TenantId,
  projectId: string,
  employeeId: string,
  roleLabel?: string | null
) {
  const tid = requireTenantId(tenantId);
  const project = await prisma.opsProject.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError("Project not found", 404);
  assertSameTenant(project.organizationId, tid);
  const emp = await prisma.employee.findFirst({ where: { id: employeeId, organizationId: tid } });
  if (!emp) throw new AppError("Employee not found", 404);

  try {
    return await prisma.opsProjectMember.create({
      data: { organizationId: tid, projectId, employeeId, roleLabel },
      include: { employee: true },
    });
  } catch {
    throw new AppError("Employee already on project", 409);
  }
}

export async function createMilestone(
  tenantId: TenantId,
  projectId: string,
  data: { code: string; name: string; dueAt?: string | null; progressPct?: number }
) {
  const tid = requireTenantId(tenantId);
  const project = await prisma.opsProject.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError("Project not found", 404);
  assertSameTenant(project.organizationId, tid);

  return prisma.opsMilestone.create({
    data: {
      organizationId: tid,
      projectId,
      code: data.code,
      name: data.name,
      dueAt: data.dueAt ? new Date(data.dueAt) : null,
      progressPct: data.progressPct ?? 0,
    },
  });
}

export async function projectReport(tenantId: TenantId, projectId: string) {
  const project = await getProject(tenantId, projectId);
  const tasks = project.tasks;
  const byStatus: Record<string, number> = {
    TODO: 0,
    IN_PROGRESS: 0,
    BLOCKED: 0,
    DONE: 0,
    CANCELLED: 0,
  };
  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  }
  const done = byStatus.DONE ?? 0;
  const total = tasks.length;
  const taskProgress =
    total === 0 ? project.progressPct : Math.round((done / total) * 100);
  const budget = Number(project.budgetAmount);
  const cost = Number(project.actualCost);
  return {
    project: {
      id: project.id,
      code: project.code,
      name: project.name,
      status: project.status,
      manager: project.manager,
      progressPct: project.progressPct,
    },
    tasks: {
      total,
      done,
      open: total - done - (byStatus.CANCELLED ?? 0),
      progressPct: taskProgress,
      byStatus,
    },
    milestones: project.milestones.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      dueAt: m.dueAt,
      completedAt: m.completedAt,
      progressPct: m.progressPct,
    })),
    budget: {
      budgetAmount: budget,
      actualCost: cost,
      remaining: Number((budget - cost).toFixed(4)),
      utilizationPct: budget > 0 ? Number(((cost / budget) * 100).toFixed(2)) : 0,
    },
    members: project.members.length,
  };
}
