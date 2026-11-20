/**
 * Future device integration layer (fingerprint / biometric / time-clock).
 * No hardware providers are wired in Phase 14 — this stub accepts normalized
 * punch events so a real adapter can plug in later without changing payroll.
 */

export type DevicePunchEvent = {
  organizationId: string;
  /** External device employee badge / code mapped by caller */
  employeeExternalRef: string;
  punchedAt: Date;
  type: "IN" | "OUT";
  deviceId?: string;
  rawPayload?: unknown;
};

export type DeviceAttendanceAdapter = {
  readonly provider: string;
  ingestPunch(event: DevicePunchEvent): Promise<{ accepted: boolean; reason?: string }>;
};

/** No-op adapter — prepares the contract for future device vendors. */
export class StubDeviceAttendanceAdapter implements DeviceAttendanceAdapter {
  readonly provider = "stub";

  async ingestPunch(event: DevicePunchEvent) {
    if (!event.organizationId || !event.employeeExternalRef) {
      return { accepted: false, reason: "Missing organizationId or employeeExternalRef" };
    }
    // Intentionally does not write attendance — callers use attendance.service APIs.
    return {
      accepted: true,
      reason: "Stub accepted event; map employeeExternalRef and call attendance.service to persist",
    };
  }
}

export const defaultDeviceAdapter: DeviceAttendanceAdapter = new StubDeviceAttendanceAdapter();
