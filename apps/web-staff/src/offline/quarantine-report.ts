/**
 * quarantine-report.ts — what this device is still holding, in a form that is
 * safe to send.
 *
 * The `rejected` store keeps the server's OWN message (`rejectedReason`),
 * because a 400 body carries a real explanation and the operator inbox shows
 * it. That message must not leave the device: a refusal can embed the offending
 * value, and this repo is public (hard rule 7). So the report carries a closed
 * code set derived from the message, never the message.
 *
 * Pure: no fetch, no Dexie, no React — same shape as `failure-kind.ts` beside
 * it, and for the same reason. The mapping is a decision worth testing.
 */

export type QuarantineReasonCode =
  /** The match was already finished when the exchange arrived. */
  | 'match_closed'
  /** The server rejected the shape or values of the exchange. */
  | 'validation'
  /** A sequence collision that survived the one resequence retry. */
  | 'sequence'
  /** Anything unmapped. Deliberately present rather than dropped. */
  | 'other';

/**
 * Map a server refusal to a code.
 *
 * Substring matching against the API's real messages rather than a status code,
 * because every quarantined exchange is a 400 by construction — the drain only
 * quarantines on that branch. Unrecognised text buckets to 'other' instead of
 * being guessed at; a wrong code is worse than an honest unknown.
 */
export function classifyQuarantineReason(reason: string): QuarantineReasonCode {
  const text = reason.toLowerCase();
  if (text.includes('already completed') || text.includes('already closed')) return 'match_closed';
  if (text.includes('sequence')) return 'sequence';
  if (text.includes('validation') || text.includes('invalid') || text.includes('expected')) {
    return 'validation';
  }
  return 'other';
}

/** The minimum a rejected entry has to expose to be summarised. */
export interface QuarantinedForReport {
  rejectedReason: string;
  rejectedAt: number;
}

export interface QuarantineSummary {
  quarantinedCount: number;
  /** Distinct codes present, sorted so the payload is stable across syncs. */
  reasonCodes: QuarantineReasonCode[];
  /** ISO timestamp of the oldest still-held exchange, or null when none are. */
  oldestQuarantinedAt: string | null;
}

/**
 * Summarise the held exchanges. An EMPTY store still produces a summary — the
 * report doubles as a heartbeat, and a device that only spoke up when something
 * was wrong would make silence and health indistinguishable.
 */
export function summariseQuarantine(entries: QuarantinedForReport[]): QuarantineSummary {
  if (entries.length === 0) {
    return { quarantinedCount: 0, reasonCodes: [], oldestQuarantinedAt: null };
  }
  const codes = new Set<QuarantineReasonCode>();
  let oldest = entries[0]!.rejectedAt;
  for (const entry of entries) {
    codes.add(classifyQuarantineReason(entry.rejectedReason));
    if (entry.rejectedAt < oldest) oldest = entry.rejectedAt;
  }
  return {
    quarantinedCount: entries.length,
    reasonCodes: [...codes].sort(),
    oldestQuarantinedAt: new Date(oldest).toISOString(),
  };
}
