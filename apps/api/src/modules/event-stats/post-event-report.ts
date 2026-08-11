/**
 * post-event-report.ts — what actually happened, once the day is over.
 *
 * Pure: every rule lives here and the service beside it only gathers, the same
 * split as `event-readiness.ts` and `clock-reconciliation.ts`.
 *
 * ── What is deliberately NOT in here ────────────────────────────────────────
 *
 * Swallowed query errors (`query_error_events`, migration 0180) carry no
 * event_id — the table is aggregated by a fingerprint of the sanitised request,
 * platform-wide by design, so a row cannot be attributed to one event. Slicing
 * it by the event's dates would present unrelated platform noise as this
 * event's findings, which is worse than the gap. It stays on the super-admin
 * platform log where it means what it says.
 *
 * Clock drift is not recomputed either: `ClockReconciliationService` already
 * produces that report, with its own admin surface. This one carries the count
 * and points at it rather than deriving a second, subtly different answer.
 */

export type ReportSeverity = 'ok' | 'attention';

export interface ReportSection {
  key: string;
  severity: ReportSeverity;
  /** Primary figure. Rendered by the client with its own i18n. */
  count: number;
  /** Supporting detail lines, already free of ids and personal data. */
  details: string[];
}

export interface DeviceSyncRow {
  deviceLabel: string | null;
  deviceId: string;
  peakQuarantinedCount: number;
  quarantinedCount: number;
  reasonCodes: string[];
  lastReportedAt: string;
}

export interface OverrideRow {
  /** `match_forfeits.end_reason` or the override reason. */
  reason: string | null;
  voided: boolean;
}

export interface ArrivalRow {
  via: string;
  reversed: boolean;
}

export interface PostEventInput {
  devices: DeviceSyncRow[];
  overrides: OverrideRow[];
  arrivals: ArrivalRow[];
  /** Rows the clock reconciliation flagged; the detail lives on its own page. */
  clockFlaggedCount: number;
}

export interface PostEventReport {
  sections: ReportSection[];
  /** True when any section needs attention — drives the page's headline. */
  needsAttention: boolean;
}

function countBy<T>(rows: T[], pick: (row: T) => string): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = pick(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k}: ${n}`);
}

/**
 * Devices that ever held a refused exchange.
 *
 * Reads `peakQuarantinedCount`, never the current count: a tablet that was
 * stuck at 14:00 and drained by 17:00 reports 0 now, and the exchanges a
 * referee scored and had refused are exactly what this report exists to
 * surface. A device is named by its label when it has one, because a raw device
 * id tells an organiser nothing.
 */
function deviceSection(devices: DeviceSyncRow[]): ReportSection {
  const troubled = devices.filter((device) => device.peakQuarantinedCount > 0);
  const details = troubled.map((device) => {
    const name = device.deviceLabel?.trim() || 'unlabelled device';
    const held = device.quarantinedCount > 0 ? `, ${device.quarantinedCount} still held` : '';
    const why = device.reasonCodes.length > 0 ? ` (${device.reasonCodes.join(', ')})` : '';
    return `${name}: ${device.peakQuarantinedCount} refused${held}${why}`;
  });
  return {
    key: 'refusedExchanges',
    // Any refusal at all is worth attention: it means a scored hit did not land.
    severity: troubled.length > 0 ? 'attention' : 'ok',
    count: troubled.reduce((sum, device) => sum + device.peakQuarantinedCount, 0),
    details,
  };
}

/**
 * Devices that stopped reporting entirely.
 *
 * Separate from the section above ON PURPOSE: a device holding refused
 * exchanges is a known problem, while a device that went silent is an unknown
 * one — it may have been holding anything when it stopped talking. Collapsing
 * them would hide the worse case inside the better one.
 */
function silentDeviceSection(devices: DeviceSyncRow[], cutoffIso: string): ReportSection {
  const cutoff = new Date(cutoffIso).getTime();
  const silent = devices.filter((device) => new Date(device.lastReportedAt).getTime() < cutoff);
  return {
    key: 'silentDevices',
    severity: silent.length > 0 ? 'attention' : 'ok',
    count: silent.length,
    details: silent.map((device) => device.deviceLabel?.trim() || 'unlabelled device'),
  };
}

export function buildPostEventReport(
  input: PostEventInput,
  /** Devices last heard from before this stamp count as silent. */
  silenceCutoffIso: string,
): PostEventReport {
  const overridesLive = input.overrides.filter((row) => !row.voided);
  const sections: ReportSection[] = [
    deviceSection(input.devices),
    silentDeviceSection(input.devices, silenceCutoffIso),
    {
      key: 'overrides',
      // Overrides are a legitimate tool, not a fault — recorded, never flagged.
      severity: 'ok',
      count: overridesLive.length,
      details: countBy(overridesLive, (row) => row.reason ?? 'unspecified'),
    },
    {
      key: 'voidedOverrides',
      severity: 'ok',
      count: input.overrides.length - overridesLive.length,
      details: [],
    },
    {
      key: 'arrivals',
      severity: 'ok',
      count: input.arrivals.filter((row) => !row.reversed).length,
      details: countBy(
        input.arrivals.filter((row) => !row.reversed),
        (row) => row.via,
      ),
    },
    {
      key: 'clockDrift',
      severity: input.clockFlaggedCount > 0 ? 'attention' : 'ok',
      count: input.clockFlaggedCount,
      details: [],
    },
  ];

  return {
    sections,
    needsAttention: sections.some((section) => section.severity === 'attention'),
  };
}
