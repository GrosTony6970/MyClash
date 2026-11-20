import type { PayloadLabel } from '../../../src/components/PayloadCell';

/** One audit row as the API lists it (`AuditLogRow`, `admin-audit-log.service.ts`). */
export interface AuditLogEntry {
  id: string;
  actor_user_id: string | null;
  /** Backend-resolved actor display name / email. Null when unresolved. */
  actorName?: string | null;
  actorEmail?: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  payload_json: unknown;
  created_at: string;
  /** Backend-resolved human label per entity_type. Null when the
   *  underlying record was hard-deleted or the type isn't in the
   *  resolver switch — the FE still shows the raw UUID below. */
  entityLabel?: string | null;
  /** RFC 6901 JSON Pointer into payload_json → label for the id at that spot.
   *  Absent pointers just mean "render the raw value". */
  payloadLabels?: Record<string, PayloadLabel>;
  /** How a system action ended; null when the row records none (ruling 914). */
  outcome: AuditOutcome | null;
}

export type AuditOutcome = 'succeeded' | 'failed' | 'started';

/** The status chip of each outcome: green, red, grey. */
export const OUTCOME_SEMANTIC = {
  succeeded: 'done',
  failed: 'danger',
  started: 'pending',
} as const satisfies Record<AuditOutcome, string>;

/** The exit code and the timeout a system action recorded, when it recorded them. */
export function outcomeFacts(payload: unknown): { exitCode: number | null; timedOut: boolean } {
  const record =
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  return {
    exitCode: typeof record['exitCode'] === 'number' ? record['exitCode'] : null,
    timedOut: record['timedOut'] === true,
  };
}
