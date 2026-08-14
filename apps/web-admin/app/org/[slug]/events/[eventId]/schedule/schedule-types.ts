/**
 * The shapes the schedule workspace reads off the API, in one place.
 *
 * These used to be declared inside `grid.tsx` above the component. They are
 * lifted here because the split gives them more than one reader: the panel, the
 * two views and the data hook all name them, and a type that lives inside the
 * component it is being extracted from cannot be imported by its own children.
 *
 * They are deliberately the API's shape, not a domain model — `ProgrammeBlockRow`
 * carries `startTime`/`endTime` as HH:MM strings on a day index because that is
 * what `/events/:eventId/programme` returns.
 */

export interface Lice {
  id: string;
  name: string;
  sortOrder: number;
  /**
   * Slice 8 of the venues feature: when a lice is attached to an
   * org-level venue, the schedule grid groups consecutive same-venue
   * lice columns under a single venue header row. Backend projects
   * this via `venues(id, name)` on /events/:eventId/lices.
   */
  venues?: { id: string; name: string } | null;
  /**
   * The sub-room of that venue, when the hall is split into named areas
   * (migration 0169). The grid's venue band ignores it — it only groups by
   * hall — but the placement editor round-trips it, and the public display
   * picker headings it.
   */
  venue_areas?: { id: string; name: string } | null;
}

/**
 * Slice 7: non-fight programme blocks rendered on the grid.
 * `dayIndex` indexes into the event's `days` array (computed from the event
 * start/end). `startTime` / `endTime` are HH:MM strings on that day.
 */
export interface ProgrammeBlockRow {
  id: string;
  dayIndex: number;
  blockType: 'admin' | 'competition' | 'workshop' | 'break';
  label: string;
  startTime: string;
  endTime: string;
  colorHex?: string | null;
}

/**
 * One reversible grid-block deletion, surfaced as an Undo toast:
 *  - `unschedule` — a pool/bracket/other run was unscheduled; restore each
 *    match to the position it held before.
 *  - `delete-block` — an admin/break bar was deleted; re-create it from the
 *    captured payload (matches that were inside its window stay in the
 *    Unscheduled list, recoverable on their own).
 */
export type GridUndo =
  | {
      kind: 'unschedule';
      label: string;
      matches: Array<{ id: string; liceId: string | null; scheduledAt: string | null }>;
    }
  | {
      kind: 'delete-block';
      label: string;
      block: {
        dayIndex: number;
        blockType: ProgrammeBlockRow['blockType'];
        label: string;
        startTime: string;
        endTime: string;
      };
    };

/**
 * A pool whose fights are ALL still unscheduled, so the left panel offers it as
 * one draggable block instead of a chip per fight. The moment the operator
 * places one of them by hand the pool loses its block and the rest fall back to
 * individual chips — the grouping is a convenience, never a constraint.
 */
export interface UnscheduledPool {
  poolId: string;
  poolName: string;
  tournamentName: string | null;
  matchIds: string[];
}

/**
 * The bracket analogue: unscheduled bracket fights grouped by phase round
 * (Play-ins / Round of 16 / …). The key carries the tournament name so two
 * same-weapon tournaments do not merge their rounds; `order` sorts play-ins
 * before the final rather than alphabetically.
 */
export interface UnscheduledBracketRound {
  key: string;
  label: string;
  order: number;
  tournamentName: string | null;
  matchIds: string[];
}

export interface ScheduleMatch {
  id: string;
  matchNumberLabel: string;
  /** Canonical match code (LSW-P1-M1 for pools, LSW-B-QF-M1 for brackets).
   *  Backend computes it via formatRoundCode; the sidebar + grid use it as the
   *  display label, falling back to matchNumberLabel for legacy payloads. */
  roundCode?: string;
  status: string;
  liceId: string | null;
  scheduledAt: string | null;
  /** Actual run timing — drives the per-lice drift indicator. */
  startedAt: string | null;
  endedAt: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  redRegistrationId: string;
  blueRegistrationId: string;
  tournamentName: string | null;
  /** Parent tournament's identity color (ColorToken string). Drives
   *  the card tint so every card from the same tournament reads as
   *  one family. Null falls back to the default token via the tint
   *  helpers in @myclash/ui. */
  tournamentColor: string | null;
  durationMinutes: number;
  phaseType: string | null;
  /** Populated for pool-type matches; drives the per-pool colour tint
   *  on the grid card. Null for bracket / finals matches. */
  poolId: string | null;
  poolName: string | null;
}
