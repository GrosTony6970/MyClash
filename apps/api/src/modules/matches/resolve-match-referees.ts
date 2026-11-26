/**
 * Resolve which referees officiate a given match from the event's
 * `referee_assignments`, by scope precedence: a match-scope assignment wins;
 * otherwise the match's pool-scope assignment; otherwise its lice-scope one.
 * Returns the (deduped, non-empty) referees for the winning tier.
 *
 * Pure: the caller fetches the rows (+ resolves person_id → name and
 * role → skill) and feeds them in. No I/O here.
 */

export interface RefereeAssignmentRow {
  /** 'match' | 'pool' | 'lice'. */
  scopeType: string;
  matchId: string | null;
  poolId: string | null;
  liceId: string | null;
  /** Resolved display name (from global_persons). */
  name: string;
  /** Raw `referee_skills.id` — may be a `custom-…` id. Null on legacy rows. */
  role: string | null;
  /** `referee_skills.name`, or the raw role id when the skill row is gone. */
  roleLabel: string | null;
  /** `referee_skills.color` design token; 'slate' when unresolved. */
  roleColor: string;
  /** `assigned` | `confirmed` | `pending` — the loader already filters to these. */
  status: string;
}

/** One officiating referee, as surfaced to a caller. */
export interface ResolvedReferee {
  name: string;
  role: string | null;
  roleLabel: string | null;
  roleColor: string;
  /**
   * Confirmation state of the assignment. Carried so a surface that colour-codes
   * it (the bracket card's referee dot) can tell a confirmed referee from a
   * pending one; every value here is an ACTIVE state, never a rejection.
   */
  status: string;
}

export interface MatchRefereeTarget {
  matchId: string;
  poolId: string | null;
  liceId: string | null;
}

/**
 * Dedupe on name + role, NOT on name alone.
 *
 * One person can hold two roles on the same match. Keying on the name would
 * silently drop the second — the quiet kind of data loss that reads as a
 * correct screen, so it never gets reported.
 */
function uniqueReferees(rows: RefereeAssignmentRow[]): ResolvedReferee[] {
  const seen = new Set<string>();
  const out: ResolvedReferee[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    const key = `${name}\x00${row.role ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      role: row.role,
      roleLabel: row.roleLabel,
      roleColor: row.roleColor,
      status: row.status,
    });
  }
  return out;
}

/**
 * The `string[]` projection the PUBLIC `GET /matches/:id/summary` has always
 * shipped (rendered verbatim as `referees.join(', ')` on the public match page).
 *
 * Deduping AGAIN by name here is load-bearing, not belt-and-braces:
 * `resolveMatchReferees` keys on (name, role), so one person holding two roles
 * yields two entries. Mapping straight to `.name` would print
 * "Marc Lefevre, Marc Lefevre" on a public page. `Set` keeps first-occurrence
 * order, which is exactly what the old name-keyed dedupe produced — so this
 * array stays byte-identical to what shipped before roles existed.
 */
export function refereeNamesOnly(referees: readonly ResolvedReferee[]): string[] {
  return Array.from(new Set(referees.map((r) => r.name)));
}

/**
 * The scope precedence, once: the rows of the first tier (match, then pool, then lice) that
 * has ANY row for the target — the whole tier wins across roles, not role by role. Generic
 * so a caller whose rows carry more (a person id) keeps it.
 */
export function winningAssignmentRows<
  R extends Pick<RefereeAssignmentRow, 'scopeType' | 'matchId' | 'poolId' | 'liceId'>,
>(rows: readonly R[], target: MatchRefereeTarget): R[] {
  const matchScope = rows.filter((r) => r.scopeType === 'match' && r.matchId === target.matchId);
  if (matchScope.length > 0) return matchScope;

  if (target.poolId) {
    const poolScope = rows.filter((r) => r.scopeType === 'pool' && r.poolId === target.poolId);
    if (poolScope.length > 0) return poolScope;
  }

  if (target.liceId) {
    const liceScope = rows.filter((r) => r.scopeType === 'lice' && r.liceId === target.liceId);
    if (liceScope.length > 0) return liceScope;
  }

  return [];
}

export function resolveMatchReferees(
  rows: RefereeAssignmentRow[],
  target: MatchRefereeTarget,
): ResolvedReferee[] {
  return uniqueReferees(winningAssignmentRows(rows, target));
}
