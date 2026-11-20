import { OpsTaskPriority, OpsTaskStatus } from "@prisma/client";
import { nextDocumentNumber } from "../../lib/documentNumber.js";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

const taskInclude = {
  assignees: {
    include: {
      employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
    },
  },
  comments: { orderBy: { createdAt: "asc" as const } },
  events: { orderBy: { at: "asc" as const } },
  project: { select: { id: true, code: true, name: true } },
  milestone: { select: { id: true, code: true, name: true } },
};

async function addEvent(
  tid: string,
  taskId: string,
  action: string,
  actorUserId?: string | null,
  note?: string | null
) {
  await prisma.opsTaskEvent.create({
    data: { organizationId: tid, taskId, action, actorUserId, note },
  });
}

export async function listTasks(
  tenantId: TenantId,
  opts?: { status?: string; projectId?: string; employeeId?: string; overdue?: boolean }
) {
  const tid = requireTenantId(tenantId);
  return prisma.opsTask.findMany({
    where: {
      organizationId: tid,
      ...(opts?.status ? { status: opts.status as OpsTaskStatus } : {}),
      ...(opts?.projectId ? { projectId: opts.projectId } : {}),
      ...(opts?.employeeId ? { assignees: { some: { employeeId: opts.employeeId } } } : {}),
      ...(opts?.overdue
        ? {
            dueAt: { lt: new Date() },
            status: { notIn: [OpsTaskStatus.DONE, OpsTaskStatus.CANCELLED] },
          }
        : {}),
    },
    include: taskInclude,
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
}

export async function getTask(tenantId: TenantId, id: string) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.opsTask.findUnique({ where: { id }, include: taskInclude });
  if (!row) throw new AppError("Task not found", 404);
  assertSameTenant(row.organizationId, tid);
  return row;
}

export async function createTask(
  tenantId: TenantId,
  data: {
    title: string;
    description?: string | null;
    priority?: OpsTaskPriority;
    status?: OpsTaskStatus;
    progressPct?: number;
    dueAt?: string | null;
    projectId?: string | null;
    milestoneId?: string | null;
    assigneeIds?: string[];
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  if (data.projectId) {
    const p = await prisma.opsProject.findFirst({ where: { id: data.projectId, organizationId: tid } });
    if (!p) throw new AppError("Project not found", 404);
  }
  if (data.milestoneId) {
    const m = await prisma.opsMilestone.findFirst({
      where: { id: data.milestoneId, organizationId: tid },
    });
    if (!m) throw new AppError("Milestone not found", 404);
  }

  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, tid, "TASK", "TASK");
    const task = await tx.opsTask.create({
      data: {
        organizationId: tid,
        code,
        title: data.title,
        description: data.description,
        priority: data.priority ?? OpsTaskPriority.MEDIUM,
        status: data.status ?? OpsTaskStatus.TODO,
        progressPct: Math.min(100, Math.max(0, data.progressPct ?? 0)),
        dueAt: data.dueAt ? new Date(data.dueAt) : null,
        projectId: data.projectId,
        milestoneId: data.milestoneId,
        createdByUserId: userId,
      },
    });

    const ids = data.assigneeIds ?? [];
    for (let i = 0; i < ids.length; i++) {
      const employeeId = ids[i]!;
      const emp = await tx.employee.findFirst({ where: { id: employeeId, organizationId: tid } });
      if (!emp) throw new AppError(`Assignee not found: ${employeeId}`, 404);
      await tx.opsTaskAssignee.create({
        data: {
          organizationId: tid,
          taskId: task.id,
          employeeId,
          isPrimary: i === 0,
        },
      });
    }

    await tx.opsTaskEvent.create({
      data: {
        organizationId: tid,
        taskId: task.id,
        action: "CREATED",
        actorUserId: userId,
      },
    });

    return tx.opsTask.findUniqueOrThrow({ where: { id: task.id }, include: taskInclude });
  }).then(async (created) => {
    const userIds = (
      await prisma.employee.findMany({
        where: { id: { in: data.assigneeIds ?? [] }, organizationId: tid, userId: { not: null } },
        select: { userId: true },
      })
    )
      .map((e) => e.userId)
      .filter((x): x is string => Boolean(x));
    if (userIds.length) {
      const { notifyUsers } = await import("../workflow/notifications.service.js");
      const { NotificationType } = await import("@prisma/client");
      await notifyUsers(tid, userIds, {
        type: NotificationType.TASK_ASSIGNED,
        title: `Task assigned: ${created.title}`,
        body: created.code,
        entityType: "OPS_TASK",
        entityId: created.id,
      });
    }
    return created;
  });
}

export async function updateTask(
  tenantId: TenantId,
  id: string,
  data: Partial<{
    title: string;
    description: string | null;
    priority: OpsTaskPriority;
    status: OpsTaskStatus;
    progressPct: number;
    dueAt: string | null;
    projectId: string | null;
    milestoneId: string | null;
  }>,
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const existing = await prisma.opsTask.findUnique({ where: { id } });
  if (!existing) throw new AppError("Task not found", 404);
  assertSameTenant(existing.organizationId, tid);

  const updated = await prisma.opsTask.update({
    where: { id },
    data: {
      title: data.title,
      description: data.description,
      priority: data.priority,
      status: data.status,
      progressPct:
        data.progressPct !== undefined
          ? Math.min(100, Math.max(0, data.progressPct))
          : undefined,
      dueAt: data.dueAt === undefined ? undefined : data.dueAt ? new Date(data.dueAt) : null,
      projectId: data.projectId,
      milestoneId: data.milestoneId,
    },
    include: taskInclude,
  });

  if (data.status && data.status !== existing.status) {
    await addEvent(tid, id, "STATUS_CHANGED", userId, `${existing.status} → ${data.status}`);
  }
  if (data.progressPct !== undefined && data.progressPct !== existing.progressPct) {
    await addEvent(tid, id, "PROGRESS_UPDATED", userId, `${data.progressPct}%`);
  }

  return updated;
}

export async function setAssignees(
  tenantId: TenantId,
  taskId: string,
  assigneeIds: string[],
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  const task = await prisma.opsTask.findUnique({ where: { id: taskId } });
  if (!task) throw new AppError("Task not found", 404);
  assertSameTenant(task.organizationId, tid);

  await prisma.$transaction(async (tx) => {
    await tx.opsTaskAssignee.deleteMany({ where: { taskId } });
    for (let i = 0; i < assigneeIds.length; i++) {
      const employeeId = assigneeIds[i]!;
      const emp = await tx.employee.findFirst({
        where: { id: employeeId, organizationId: tid },
      });
      if (!emp) throw new AppError(`Assignee not found: ${employeeId}`, 404);
      await tx.opsTaskAssignee.create({
        data: {
          organizationId: tid,
          taskId,
          employeeId,
          isPrimary: i === 0,
        },
      });
    }
  });
  await addEvent(tid, taskId, "ASSIGNEES_UPDATED", userId, assigneeIds.join(","));
  return getTask(tid, taskId);
}

export async function addComment(
  tenantId: TenantId,
  taskId: string,
  body: string,
  userId?: string,
  employeeId?: string | null
) {
  const tid = requireTenantId(tenantId);
  const task = await prisma.opsTask.findUnique({ where: { id: taskId } });
  if (!task) throw new AppError("Task not found", 404);
  assertSameTenant(task.organizationId, tid);
  if (!body.trim()) throw new AppError("Comment body required", 400);
  if (employeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId: tid },
    });
    if (!emp) throw new AppError("Employee not found", 404);
  }

  const comment = await prisma.opsTaskComment.create({
    data: {
      organizationId: tid,
      taskId,
      body: body.trim(),
      authorUserId: userId,
      employeeId: employeeId ?? null,
    },
  });
  await addEvent(tid, taskId, "COMMENTED", userId);
  return comment;
}
