/**
 * "Is this piste free at that time?", as pure interval arithmetic.
 *
 * A piste (`lices` row) runs one bout at a time. Nothing enforced that: three
 * write paths set `lice_id` and `scheduled_at` together, none of them looked at
 * what was already there, and there is no unique index or EXCLUDE constraint
 * behind them. Two fights from different tournaments could sit on one strip at
 * one minute and the only thing that noticed was the crew standing in front of
 * it.
 *
 * The schedule grid's conflict banner looked like the safety net and is not: it
 * requires the two bouts to SHARE A FIGHTER before it tests the clock, so two
 * tournaments on one piste — no shared registration — report nothing.
 *
 * HALF-OPEN INTERVALS. `[start, start + duration)`, so a bout that ends exactly
 * as the next begins does not collide. That matches `detect-overlaps.ts` and
 * `conflict-detection.ts` on the web-admin side, and it has to: a back-to-back
 * pair on one piste is the normal case, not a clash.
 *
 * Pure — no Supabase, no Nest. The caller fetches the occupants and supplies the
 * placements; this decides. That is the part worth testing, and it keeps the
 * three service call sites down to a query plus a throw.
 */
import { DEFAULT_MATCH_DURATION_MINUTES } from '../schedule/select-programme-block';

/** A placement: where a bout is being put, or already sits. */
export interface LicePlacement {
  matchId: string;
  liceId: string | null;
  scheduledAt: string | null;
  /** Defaults to {@link DEFAULT_MATCH_DURATION_MINUTES} when absent. */
  durationMinutes?: number;
}

export interface LiceCollision {
  liceId: string;
  /** The placement being made. */
  matchId: string;
  /** What it lands on — another proposed placement, or an existing occupant. */
  conflictingMatchId: string;
}

interface Interval {
  matchId: string;
  liceId: string;
  start: number;
  end: number;
}

/**
 * A placement only occupies a piste when it names both a piste AND a time.
 * Clearing either releases the strip, which is why `setPoolLice(null)` and an
 * unscheduled bout can never collide.
 */
function toInterval(placement: LicePlacement): Interval | null {
  if (!placement.liceId || !placement.scheduledAt) return null;
  const start = new Date(placement.scheduledAt).getTime();
  if (Number.isNaN(start)) return null;
  const minutes = placement.durationMinutes ?? DEFAULT_MATCH_DURATION_MINUTES;
  return {
    matchId: placement.matchId,
    liceId: placement.liceId,
    start,
    end: start + minutes * 60_000,
  };
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.liceId === b.liceId && a.start < b.end && b.start < a.end;
}

/**
 * Every collision `proposed` would create, against `occupants` and against
 * itself.
 *
 * Both halves matter. A pool being re-timed onto one piste has to be checked
 * against the bouts already there AND against its own siblings, because a
 * multi-row write that only looked outward could still land two of its own rows
 * on the same slot.
 *
 * The caller is responsible for keeping the rows being MOVED out of
 * `occupants` — otherwise a bout collides with its own former placement and
 * every re-save refuses.
 */
export function findLiceCollisions(
  proposed: readonly LicePlacement[],
  occupants: readonly LicePlacement[],
): LiceCollision[] {
  const wanted = proposed.map(toInterval).filter((i): i is Interval => i !== null);
  if (wanted.length === 0) return [];

  const taken = occupants.map(toInterval).filter((i): i is Interval => i !== null);
  const collisions: LiceCollision[] = [];

  for (let i = 0; i < wanted.length; i++) {
    const placement = wanted[i]!;
    for (const occupant of taken) {
      if (occupant.matchId === placement.matchId) continue;
      if (overlaps(placement, occupant)) {
        collisions.push({
          liceId: placement.liceId,
          matchId: placement.matchId,
          conflictingMatchId: occupant.matchId,
        });
      }
    }
    // Only forward, so a colliding pair is reported once rather than twice.
    for (let j = i + 1; j < wanted.length; j++) {
      const sibling = wanted[j]!;
      if (overlaps(placement, sibling)) {
        collisions.push({
          liceId: placement.liceId,
          matchId: placement.matchId,
          conflictingMatchId: sibling.matchId,
        });
      }
    }
  }

  return collisions;
}

/**
 * The 409 body. Names the piste and the bouts, because "piste is busy" sends an
 * organiser hunting through a grid for the row that refused.
 */
export function liceCollisionMessage(collisions: readonly LiceCollision[]): string {
  const first = collisions[0];
  if (!first) return 'This placement double-books a piste.';
  const more =
    collisions.length > 1 ? ` (and ${collisions.length - 1} more on this placement)` : '';
  return (
    `Piste already busy: this bout overlaps match ${first.conflictingMatchId} ` +
    `on the same piste at the same time${more}. Move one of them, or clear the piste first.`
  );
}
