/**
 * apps/api/src/modules/schedule/match-scheduler.ts
 *
 * Match-to-Lice scheduler.
 * ARCHITECTURE.md §11quater: assigns generated matches to Lices respecting
 * per-fighter rest minimums and balancing load across Lices.
 *
 * Pure scheduling logic — no DB access. The caller fetches data and persists results.
 *
 * Algorithm:
 *   1. Build a timeline per Lice (list of scheduled matches with start times).
 *   2. For each unscheduled match, find the earliest Lice slot where:
 *      - Both fighters have had at least minRestMinutes since their last match.
 *      - The Lice is available (previous match has ended).
 *   3. Assign to the Lice with the earliest available slot (greedy, balances load).
 *   4. Return all matches with scheduled_at timestamps.
 */

export interface SchedulerMatch {
  id: string;
  redRegistrationId: string;
  blueRegistrationId: string;
  /** Estimated duration in minutes (default: 5) */
  estimatedDurationMinutes?: number;
  /**
   * Optional pool grouping. When `poolAffinity === 'strict'` (default),
   * every match sharing a `poolId` lands on the same Lice. Bracket /
   * finals matches typically leave this unset.
   */
  poolId?: string | null;
  /**
   * Pool sort_order from the DB (0-indexed). Used together with the
   * lice's sort_order so pool i ends up on lice i — the operator's
   * mental model. Falls back to caller-defined insertion order when
   * unset (legacy behaviour).
   */
  poolSortOrder?: number | null;
  /**
   * Human-readable label like "M1", "M2", "M10". Iteration order
   * within a pool falls back to numeric parse of the trailing digit
   * group so the operator sees M1 → M2 → M3 (not the default string
   * sort that puts M10 before M2). Falls back to insertion order
   * when unset.
   */
  matchNumberLabel?: string | null;
}

export interface SchedulerLice {
  id: string;
  name: string;
  /** Sort order from the DB (0-indexed). The allocator assigns pool
   *  i to the lice with `sortOrder = i mod liceCount`. */
  sortOrder?: number | null;
}

export interface SchedulerOptions {
  /** Minimum rest between matches for a fighter, in minutes (default: 10) */
  minRestMinutes?: number;
  /** Estimated match duration in minutes (default: 5) */
  defaultMatchDurationMinutes?: number;
  /** Start time for the schedule (ISO string, default: now) */
  startTime?: string;
  /** Gap between matches on the same Lice in minutes (default: 2) */
  transitionMinutes?: number;
  /**
   * Pool→Lice grouping rule. `'strict'` (default) keeps every match
   * sharing a `poolId` on the same Lice — fighters stay on one strip
   * for their entire pool. `'off'` falls back to per-match greedy
   * placement (the original bracket-friendly behaviour).
   */
  poolAffinity?: 'strict' | 'off';
}

export interface ScheduledMatch {
  matchId: string;
  liceId: string;
  liceName: string;
  scheduledAt: string; // ISO string
  estimatedEndAt: string; // ISO string
}

export interface ScheduleResult {
  scheduledMatches: ScheduledMatch[];
  /** Load per Lice: { liceId → matchCount } */
  liceLoad: Record<string, number>;
  /** Max load imbalance as a percentage (0 = perfectly balanced) */
  imbalancePercent: number;
  /** Any matches that could not be scheduled (should be empty) */
  unscheduled: string[];
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function scheduleMatches(
  matches: SchedulerMatch[],
  lices: SchedulerLice[],
  options: SchedulerOptions = {},
): ScheduleResult {
  if (lices.length === 0) throw new Error('At least one Lice is required');
  if (matches.length === 0) {
    return { scheduledMatches: [], liceLoad: {}, imbalancePercent: 0, unscheduled: [] };
  }

  const minRest = (options.minRestMinutes ?? 10) * 60_000; // ms
  const defaultDuration = (options.defaultMatchDurationMinutes ?? 5) * 60_000; // ms
  const transition = (options.transitionMinutes ?? 2) * 60_000; // ms
  const startTime = options.startTime ? new Date(options.startTime).getTime() : Date.now();
  const poolAffinity = options.poolAffinity ?? 'strict';

  // Track when each Lice is next free (ms timestamp)
  const liceNextFree: Record<string, number> = {};
  for (const lice of lices) {
    liceNextFree[lice.id] = startTime;
  }

  // Track when each fighter is next available (ms timestamp)
  const fighterNextFree: Record<string, number> = {};

  const scheduledMatches: ScheduledMatch[] = [];
  const unscheduled: string[] = [];

  // Group input into "units" that must land on a single Lice together.
  // With strict affinity, matches sharing a poolId form one unit;
  // matches without a poolId stay as single-match units.
  // With affinity off, every match is its own unit (legacy behaviour).
  type Unit = { poolId: string | null; sortOrder: number; matches: SchedulerMatch[] };
  const units: Unit[] = [];

  if (poolAffinity === 'strict') {
    const byPool = new Map<string, SchedulerMatch[]>();
    for (const m of matches) {
      if (m.poolId) {
        const arr = byPool.get(m.poolId) ?? [];
        arr.push(m);
        byPool.set(m.poolId, arr);
      } else {
        // Unpooled (bracket / finals) matches stay as single-match
        // units. They run after all pools — high sort order sentinel
        // sinks them past every real pool.
        units.push({ poolId: null, sortOrder: Number.POSITIVE_INFINITY, matches: [m] });
      }
    }
    for (const [poolId, ms] of byPool) {
      const sortOrder = ms.find((m) => m.poolSortOrder != null)?.poolSortOrder ?? 0;
      units.push({ poolId, sortOrder, matches: ms });
    }
    // Pools land on lices in operator-visible order: Pool 1 → Lice 1,
    // Pool 2 → Lice 2, … (modulo wrap when pools > lices). Stable
    // sort: ties on sortOrder fall back to poolId for determinism.
    units.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return (a.poolId ?? '').localeCompare(b.poolId ?? '');
    });
  } else {
    for (const m of matches) units.push({ poolId: null, sortOrder: 0, matches: [m] });
  }

  // Pre-sort lices by sortOrder so index assignment matches what the
  // operator sees in the FE (Lice 1 first). Stable on ties.
  const liceByIndex = [...lices].sort((a, b) => {
    const sa = a.sortOrder ?? 0;
    const sb = b.sortOrder ?? 0;
    return sa - sb;
  });

  // Numeric label parse: extracts the trailing integer from a label
  // like "M1", "L1-PA-M19", "P2-M28". Lets us iterate matches as M1
  // → M2 → M3 instead of the default string sort M1 → M10 → M2.
  // Falls back to Infinity so unlabelled matches sink to the end.
  function matchNumericOrder(m: SchedulerMatch): number {
    const match = /(\d+)$/.exec(m.matchNumberLabel ?? '');
    return match ? Number.parseInt(match[1]!, 10) : Number.POSITIVE_INFINITY;
  }

  for (let unitIdx = 0; unitIdx < units.length; unitIdx++) {
    const unit = units[unitIdx]!;
    if (liceByIndex.length === 0) {
      for (const m of unit.matches) unscheduled.push(m.id);
      continue;
    }

    // Pool index → Lice index. Wrap modulo so surplus pools queue on
    // top of earlier lices (preserves balance rather than piling
    // everything on the last lice).
    const assignedLice = liceByIndex[unitIdx % liceByIndex.length]!;
    const liceStart = liceNextFree[assignedLice.id] ?? startTime;

    // Schedule every match in this unit sequentially on the assigned
    // Lice — iterating in numeric label order so rest constraints
    // catch back-to-back appearances of the same fighter.
    const orderedMatches = [...unit.matches].sort(
      (a, b) => matchNumericOrder(a) - matchNumericOrder(b),
    );

    let cursor = liceStart;
    for (const match of orderedMatches) {
      const duration = (match.estimatedDurationMinutes ?? 0) * 60_000 || defaultDuration;
      const redFree = fighterNextFree[match.redRegistrationId] ?? startTime;
      const blueFree = fighterNextFree[match.blueRegistrationId] ?? startTime;
      // Respect fighter rest minimums — if a fighter isn't ready, the
      // Lice sits idle until they are.
      const start = Math.max(cursor, redFree, blueFree);
      const end = start + duration;

      scheduledMatches.push({
        matchId: match.id,
        liceId: assignedLice.id,
        liceName: assignedLice.name,
        scheduledAt: new Date(start).toISOString(),
        estimatedEndAt: new Date(end).toISOString(),
      });

      cursor = end + transition;
      fighterNextFree[match.redRegistrationId] = end + minRest;
      fighterNextFree[match.blueRegistrationId] = end + minRest;
    }
    liceNextFree[assignedLice.id] = cursor;
  }

  // Compute load balance
  const liceLoad: Record<string, number> = {};
  for (const lice of lices) liceLoad[lice.id] = 0;
  for (const sm of scheduledMatches) {
    liceLoad[sm.liceId] = (liceLoad[sm.liceId] ?? 0) + 1;
  }

  const loads = Object.values(liceLoad);
  const maxLoad = Math.max(...loads);
  const minLoad = Math.min(...loads);
  const imbalancePercent = maxLoad > 0 ? Math.round(((maxLoad - minLoad) / maxLoad) * 100) : 0;

  return { scheduledMatches, liceLoad, imbalancePercent, unscheduled };
}
