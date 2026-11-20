import type { AuthEventType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

export async function recordAuthEvent(input: {
  type: AuthEventType;
  userId?: string | null;
  organizationId?: string | null;
  emailAttempt?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  meta?: Prisma.InputJsonValue;
}) {
  return prisma.authEvent.create({
    data: {
      type: input.type,
      userId: input.userId ?? undefined,
      organizationId: input.organizationId ?? undefined,
      emailAttempt: input.emailAttempt ?? undefined,
      ipAddress: input.ipAddress ?? undefined,
      userAgent: input.userAgent ?? undefined,
      meta: input.meta,
    },
  });
}
