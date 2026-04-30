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
}

export interface SchedulerLice {
  id: string;
  name: string;
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

  // Track when each Lice is next free (ms timestamp)
  const liceNextFree: Record<string, number> = {};
  for (const lice of lices) {
    liceNextFree[lice.id] = startTime;
  }

  // Track when each fighter is next available (ms timestamp)
  const fighterNextFree: Record<string, number> = {};

  const scheduledMatches: ScheduledMatch[] = [];
  const unscheduled: string[] = [];

  for (const match of matches) {
    const duration = (match.estimatedDurationMinutes ?? 0) * 60_000 || defaultDuration;

    // Find the earliest slot across all Lices
    let bestLice: SchedulerLice | null = null;
    let bestStart = Infinity;

    for (const lice of lices) {
      const liceFree = liceNextFree[lice.id] ?? startTime;
      const redFree = fighterNextFree[match.redRegistrationId] ?? startTime;
      const blueFree = fighterNextFree[match.blueRegistrationId] ?? startTime;

      // Earliest this match can start on this Lice
      const earliestStart = Math.max(liceFree, redFree, blueFree);

      if (earliestStart < bestStart) {
        bestStart = earliestStart;
        bestLice = lice;
      }
    }

    if (!bestLice) {
      unscheduled.push(match.id);
      continue;
    }

    const matchEnd = bestStart + duration;

    // Schedule the match
    scheduledMatches.push({
      matchId: match.id,
      liceId: bestLice.id,
      liceName: bestLice.name,
      scheduledAt: new Date(bestStart).toISOString(),
      estimatedEndAt: new Date(matchEnd).toISOString(),
    });

    // Update Lice availability (add transition gap)
    liceNextFree[bestLice.id] = matchEnd + transition;

    // Update fighter availability (add rest period)
    fighterNextFree[match.redRegistrationId] = matchEnd + minRest;
    fighterNextFree[match.blueRegistrationId] = matchEnd + minRest;
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
