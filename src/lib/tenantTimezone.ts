import { prisma } from "./prisma.js";

const DEFAULT_TZ = "Africa/Cairo";

/** Resolve tenant business timezone (system config overrides org). */
export async function resolveTenantTimezone(tenantId: string): Promise<string> {
  const [config, org] = await Promise.all([
    prisma.tenantSystemConfig.findUnique({
      where: { organizationId: tenantId },
      select: { timezone: true },
    }),
    prisma.organization.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    }),
  ]);
  return config?.timezone || org?.timezone || DEFAULT_TZ;
}

/**
 * Calendar date (UTC midnight) for the civil day of `instant` in `timeZone`.
 * Example: 2026-11-20T22:30Z in Africa/Cairo → 2026-11-21.
 */
export function workDateInTimezone(instant: Date, timeZone: string): Date {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || DEFAULT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  const parts = formatted.split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(Date.UTC(y, m - 1, d));
}

/** Parse an explicit calendar date string (YYYY-MM-DD or ISO) as a UTC date-only. */
export function parseWorkDateInput(value: string): Date {
  const day = value.trim().slice(0, 10);
  const parts = day.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return new Date(Date.UTC(NaN, 0, 1));
  return new Date(Date.UTC(y, m - 1, d));
}
