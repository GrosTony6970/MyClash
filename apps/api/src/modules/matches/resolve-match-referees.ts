/**
 * Resolve which referees officiate a given match from the event's
 * `referee_assignments`, by scope precedence: a match-scope assignment wins;
 * otherwise the match's pool-scope assignment; otherwise its lice-scope one.
 * Returns the (deduped, non-empty) referee names for the winning tier.
 *
 * Pure: the caller fetches the rows (+ resolves person_id → name) and feeds
 * them in. No I/O here.
 */

export interface RefereeAssignmentRow {
  /** 'match' | 'pool' | 'lice'. */
  scopeType: string;
  matchId: string | null;
  poolId: string | null;
  liceId: string | null;
  /** Resolved display name (from global_persons). */
  name: string;
}

export interface MatchRefereeTarget {
  matchId: string;
  poolId: string | null;
  liceId: string | null;
}

function uniqueNames(rows: RefereeAssignmentRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const name = r.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function resolveMatchReferees(
  rows: RefereeAssignmentRow[],
  target: MatchRefereeTarget,
): string[] {
  const matchScope = rows.filter((r) => r.scopeType === 'match' && r.matchId === target.matchId);
  if (matchScope.length > 0) return uniqueNames(matchScope);

  if (target.poolId) {
    const poolScope = rows.filter((r) => r.scopeType === 'pool' && r.poolId === target.poolId);
    if (poolScope.length > 0) return uniqueNames(poolScope);
  }

  if (target.liceId) {
    const liceScope = rows.filter((r) => r.scopeType === 'lice' && r.liceId === target.liceId);
    if (liceScope.length > 0) return uniqueNames(liceScope);
  }

  return [];
}
