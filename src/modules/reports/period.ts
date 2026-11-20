/** Inclusive calendar-day period helpers for reports. */

export type DateRange = { from: Date; to: Date };

export function parseRange(from?: string, to?: string): { from?: Date; to?: Date } {
  return {
    ...(from ? { from: new Date(from) } : {}),
    ...(to ? { to: new Date(to) } : {}),
  };
}

/** Previous period of equal length ending the day before `from`. */
export function previousPeriod(from: Date, to: Date): DateRange {
  const ms = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - ms);
  return { from: prevFrom, to: prevTo };
}

export function growthPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Number((((current - previous) / Math.abs(previous)) * 100).toFixed(2));
}

export function n(v: unknown) {
  return Number(v ?? 0);
}

export function round4(v: number) {
  return Number(v.toFixed(4));
}

export function iso(d: Date) {
  return d.toISOString();
}
