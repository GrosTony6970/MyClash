/**
 * Pure helper that resolves "which pools are mine" on the personal-space Pool
 * List, from the public standings payload + the viewer's own `/me/events`
 * assignments. No `'use client'`, no i18n, no React — structurally typed so it
 * stays decoupled from the API/me types and is trivially unit-testable.
 *
 * The viewer's identity is matched by the same stable display fields the
 * fighter overlay already uses (no extra public IDs):
 *   - fighter pool: a pool whose members include `highlightRegistrationId`.
 *   - referee pool/row: a `refereeOf` entry whose `tournamentName` + `poolName`
 *     resolve to a pool here; the footer row matches on `role`.
 */

interface RefereeAssignmentLike {
  tournamentName: string | null;
  poolName: string | null;
  role: string | null;
}

interface PoolLike {
  id: string;
  name: string;
  members: { registrationId: string }[];
}

export interface SelfPoolHighlightInput {
  refereeOf: RefereeAssignmentLike[];
  /** Display name of the tournament being viewed (scopes `refereeOf`). */
  tournamentName: string;
  pools: PoolLike[];
  /** The viewer's registration id for this tournament; null when referee-only. */
  highlightRegistrationId: string | null;
}

export interface SelfPoolHighlight {
  /** Pool ids to ring: the fighting pool ∪ every refereed pool (deduped). */
  ringPoolIds: string[];
  /** `${poolId}::${role ?? ''}` keys identifying the viewer's referee footer rows. */
  refereeRowKeys: string[];
  /** Scroll target on landing: the fighting pool first, else the first refereed pool. */
  scrollTargetPoolId: string | null;
}

/** Build the Pool List self-highlight from the viewer's roles in this tournament. */
export function buildSelfPoolHighlight(input: SelfPoolHighlightInput): SelfPoolHighlight {
  const { refereeOf, tournamentName, pools, highlightRegistrationId } = input;

  // Fighting pool — the (first) pool whose members include the viewer's reg id.
  const fighterPoolId = highlightRegistrationId
    ? (pools.find((p) => p.members.some((m) => m.registrationId === highlightRegistrationId))?.id ??
      null)
    : null;

  // Refereed pools — scope `refereeOf` to this tournament, resolve each to a
  // pool here by name (pool names are unique within a tournament), in pool
  // display order so the scroll target is deterministic.
  const myRefRoles = new Map<string, Set<string>>(); // poolName -> roles
  for (const r of refereeOf) {
    if (r.tournamentName !== tournamentName || !r.poolName) continue;
    const set = myRefRoles.get(r.poolName) ?? new Set<string>();
    set.add(r.role ?? '');
    myRefRoles.set(r.poolName, set);
  }

  const refereePoolIds: string[] = [];
  const refereeRowKeys: string[] = [];
  for (const pool of pools) {
    const roles = myRefRoles.get(pool.name);
    if (!roles) continue;
    refereePoolIds.push(pool.id);
    for (const role of roles) refereeRowKeys.push(`${pool.id}::${role}`);
  }

  // Ring set = fighting pool ∪ refereed pools (deduped, fighter first).
  const ringPoolIds = [...new Set([...(fighterPoolId ? [fighterPoolId] : []), ...refereePoolIds])];

  const scrollTargetPoolId = fighterPoolId ?? refereePoolIds[0] ?? null;

  return { ringPoolIds, refereeRowKeys, scrollTargetPoolId };
}
