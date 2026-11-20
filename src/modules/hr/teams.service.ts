import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";

export async function listTeams(tenantId: TenantId, departmentId?: string) {
  return prisma.team.findMany({
    where: {
      organizationId: requireTenantId(tenantId),
      isActive: true,
      ...(departmentId ? { departmentId } : {}),
    },
    include: {
      department: true,
      members: {
        include: {
          employee: {
            select: {
              id: true,
              employeeNumber: true,
              firstName: true,
              lastName: true,
              status: true,
            },
          },
        },
      },
    },
    orderBy: { code: "asc" },
  });
}

export async function createTeam(
  tenantId: TenantId,
  data: {
    code: string;
    name: string;
    nameAr?: string | null;
    departmentId?: string | null;
  }
) {
  const tid = requireTenantId(tenantId);
  if (data.departmentId) {
    const d = await prisma.department.findFirst({
      where: { id: data.departmentId, organizationId: tid },
    });
    if (!d) throw new AppError("Department not found", 404);
  }
  try {
    return await prisma.team.create({
      data: {
        organizationId: tid,
        code: data.code,
        name: data.name,
        nameAr: data.nameAr,
        departmentId: data.departmentId,
      },
    });
  } catch {
    throw new AppError("Duplicate team code", 409);
  }
}

export async function updateTeam(
  tenantId: TenantId,
  id: string,
  data: Partial<{
    name: string;
    nameAr: string | null;
    departmentId: string | null;
    isActive: boolean;
  }>
) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.team.findUnique({ where: { id } });
  if (!row) throw new AppError("Team not found", 404);
  assertSameTenant(row.organizationId, tid);
  return prisma.team.update({ where: { id }, data });
}

export async function addTeamMember(
  tenantId: TenantId,
  teamId: string,
  data: { employeeId: string; roleLabel?: string | null; isLead?: boolean }
) {
  const tid = requireTenantId(tenantId);
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) throw new AppError("Team not found", 404);
  assertSameTenant(team.organizationId, tid);

  const emp = await prisma.employee.findFirst({
    where: { id: data.employeeId, organizationId: tid },
  });
  if (!emp) throw new AppError("Employee not found", 404);

  try {
    return await prisma.teamMember.create({
      data: {
        organizationId: tid,
        teamId,
        employeeId: data.employeeId,
        roleLabel: data.roleLabel,
        isLead: Boolean(data.isLead),
      },
      include: { employee: true, team: true },
    });
  } catch {
    throw new AppError("Employee already on this team", 409);
  }
}

export async function removeTeamMember(tenantId: TenantId, teamId: string, employeeId: string) {
  const tid = requireTenantId(tenantId);
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_employeeId: { teamId, employeeId } },
  });
  if (!membership) throw new AppError("Team membership not found", 404);
  assertSameTenant(membership.organizationId, tid);
  await prisma.teamMember.delete({ where: { id: membership.id } });
  return { removed: true };
}
