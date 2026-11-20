import { FollowUpStatus, OpportunityStage, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertSameTenant, requireTenantId } from "../../lib/tenantDb.js";
import { AppError } from "../../utils/AppError.js";
import type { TenantId } from "../../types/tenant.js";
import { getCustomer } from "./customers.service.js";

async function assertCustomer(tenantId: string, customerId: string) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new AppError("Customer not found", 404);
  assertSameTenant(customer.organizationId, tenantId);
  return customer;
}

export async function addNote(
  tenantId: TenantId,
  customerId: string,
  body: string,
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  await assertCustomer(tid, customerId);
  return prisma.customerNote.create({
    data: { organizationId: tid, customerId, body, createdByUserId: userId },
  });
}

export async function listNotes(tenantId: TenantId, customerId: string) {
  const tid = requireTenantId(tenantId);
  await assertCustomer(tid, customerId);
  return prisma.customerNote.findMany({
    where: { organizationId: tid, customerId },
    orderBy: { createdAt: "desc" },
  });
}

export async function addInteraction(
  tenantId: TenantId,
  customerId: string,
  data: {
    channel?: string;
    subject?: string | null;
    body?: string | null;
    interactedAt?: string;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  await assertCustomer(tid, customerId);
  return prisma.customerInteraction.create({
    data: {
      organizationId: tid,
      customerId,
      channel: data.channel || "OTHER",
      subject: data.subject,
      body: data.body,
      interactedAt: data.interactedAt ? new Date(data.interactedAt) : new Date(),
      createdByUserId: userId,
    },
  });
}

export async function listInteractions(tenantId: TenantId, customerId: string) {
  const tid = requireTenantId(tenantId);
  await assertCustomer(tid, customerId);
  return prisma.customerInteraction.findMany({
    where: { organizationId: tid, customerId },
    orderBy: { interactedAt: "desc" },
  });
}

export async function addFollowUp(
  tenantId: TenantId,
  customerId: string,
  data: {
    title: string;
    description?: string | null;
    dueAt?: string | null;
    status?: FollowUpStatus;
    assignedToUserId?: string | null;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  await assertCustomer(tid, customerId);
  return prisma.customerFollowUp.create({
    data: {
      organizationId: tid,
      customerId,
      title: data.title,
      description: data.description,
      dueAt: data.dueAt ? new Date(data.dueAt) : null,
      status: data.status || FollowUpStatus.OPEN,
      assignedToUserId: data.assignedToUserId,
      createdByUserId: userId,
    },
  });
}

export async function updateFollowUp(
  tenantId: TenantId,
  followUpId: string,
  data: Record<string, unknown>
) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.customerFollowUp.findUnique({ where: { id: followUpId } });
  if (!row) throw new AppError("Follow-up not found", 404);
  assertSameTenant(row.organizationId, tid);
  const payload: Prisma.CustomerFollowUpUpdateInput = {};
  if (typeof data.title === "string") payload.title = data.title;
  if (data.description !== undefined) payload.description = data.description as string | null;
  if (data.status !== undefined) payload.status = data.status as FollowUpStatus;
  if (data.assignedToUserId !== undefined) {
    payload.assignedToUserId = data.assignedToUserId as string | null;
  }
  if (data.dueAt !== undefined) {
    payload.dueAt = data.dueAt ? new Date(String(data.dueAt)) : null;
  }
  return prisma.customerFollowUp.update({ where: { id: followUpId }, data: payload });
}

export async function listFollowUps(tenantId: TenantId, customerId: string) {
  const tid = requireTenantId(tenantId);
  await assertCustomer(tid, customerId);
  return prisma.customerFollowUp.findMany({
    where: { organizationId: tid, customerId },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
  });
}

export async function addOpportunity(
  tenantId: TenantId,
  customerId: string,
  data: {
    title: string;
    description?: string | null;
    amount?: number | null;
    stage?: OpportunityStage;
    expectedCloseAt?: string | null;
  },
  userId?: string
) {
  const tid = requireTenantId(tenantId);
  await assertCustomer(tid, customerId);
  return prisma.salesOpportunity.create({
    data: {
      organizationId: tid,
      customerId,
      title: data.title,
      description: data.description,
      amount: data.amount == null ? null : new Prisma.Decimal(data.amount),
      stage: data.stage || OpportunityStage.NEW,
      expectedCloseAt: data.expectedCloseAt ? new Date(data.expectedCloseAt) : null,
      createdByUserId: userId,
    },
  });
}

export async function updateOpportunity(
  tenantId: TenantId,
  opportunityId: string,
  data: Record<string, unknown>
) {
  const tid = requireTenantId(tenantId);
  const row = await prisma.salesOpportunity.findUnique({ where: { id: opportunityId } });
  if (!row) throw new AppError("Opportunity not found", 404);
  assertSameTenant(row.organizationId, tid);
  const payload: Prisma.SalesOpportunityUpdateInput = {};
  if (typeof data.title === "string") payload.title = data.title;
  if (data.description !== undefined) payload.description = data.description as string | null;
  if (typeof data.amount === "number") payload.amount = new Prisma.Decimal(data.amount);
  if (data.amount === null) payload.amount = null;
  if (data.stage !== undefined) payload.stage = data.stage as OpportunityStage;
  if (data.expectedCloseAt !== undefined) {
    payload.expectedCloseAt = data.expectedCloseAt
      ? new Date(String(data.expectedCloseAt))
      : null;
  }
  return prisma.salesOpportunity.update({ where: { id: opportunityId }, data: payload });
}

export async function listOpportunities(tenantId: TenantId, customerId: string) {
  const tid = requireTenantId(tenantId);
  await assertCustomer(tid, customerId);
  return prisma.salesOpportunity.findMany({
    where: { organizationId: tid, customerId },
    orderBy: { updatedAt: "desc" },
  });
}

/** Unified CRM activity timeline */
export async function getTimeline(tenantId: TenantId, customerId: string) {
  const tid = requireTenantId(tenantId);
  await getCustomer(tid, customerId);

  const [notes, interactions, followUps, opportunities, ledger] = await Promise.all([
    prisma.customerNote.findMany({ where: { organizationId: tid, customerId } }),
    prisma.customerInteraction.findMany({ where: { organizationId: tid, customerId } }),
    prisma.customerFollowUp.findMany({ where: { organizationId: tid, customerId } }),
    prisma.salesOpportunity.findMany({ where: { organizationId: tid, customerId } }),
    prisma.customerLedgerEntry.findMany({ where: { organizationId: tid, customerId } }),
  ]);

  const timeline = [
    ...notes.map((n) => ({
      kind: "NOTE" as const,
      id: n.id,
      at: n.createdAt.toISOString(),
      title: "Note",
      summary: n.body.slice(0, 160),
      data: n,
    })),
    ...interactions.map((i) => ({
      kind: "INTERACTION" as const,
      id: i.id,
      at: i.interactedAt.toISOString(),
      title: i.subject || i.channel,
      summary: i.body?.slice(0, 160) || null,
      data: i,
    })),
    ...followUps.map((f) => ({
      kind: "FOLLOW_UP" as const,
      id: f.id,
      at: (f.dueAt || f.createdAt).toISOString(),
      title: f.title,
      summary: f.status,
      data: f,
    })),
    ...opportunities.map((o) => ({
      kind: "OPPORTUNITY" as const,
      id: o.id,
      at: o.updatedAt.toISOString(),
      title: o.title,
      summary: o.stage,
      data: o,
    })),
    ...ledger.map((l) => ({
      kind: "LEDGER" as const,
      id: l.id,
      at: l.entryDate.toISOString(),
      title: l.type,
      summary: `${l.direction} ${l.amount}`,
      data: l,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return { timeline };
}
