/** One row of `GET /events/:eventId/schedule`, as `ScheduleGridService` builds it. */
export interface ScheduleGridMatch {
  id: string;
  matchNumberLabel: string;
  /**
   * Canonical match code via formatRoundCode (LSW-P1-M1 for
   * pools, LSW-B-QF-M1 for brackets). Built per-row in the service
   * so the sidebar + grid both read the same identifier the
   * scoring app and exports already show.
   */
  roundCode: string;
  status: string;
  liceId: string | null;
  scheduledAt: string | null;
  /** Actual run timing — present once the match has started/ended; drives
   *  the schedule's per-lice "running late" drift indicator. */
  startedAt: string | null;
  endedAt: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  redRegistrationId: string;
  blueRegistrationId: string;
  tournamentName: string | null;
  /** Tournament identity colour (ColorToken string). Lets the grid
   *  tint every match card by its parent tournament so the schedule
   *  reads as a horizontal flow of tournaments. Null when the
   *  tournament has no color set; the FE's tint helpers fall back
   *  to the default token. */
  tournamentColor: string | null;
  /** Tournament slug — lets a read-only grid (e.g. the public event
   *  schedule) link a block to its `/e/{slug}/t/{tournamentSlug}` page.
   *  Null when the tournament is missing/unresolved. */
  tournamentSlug: string | null;
  durationMinutes: number;
  /** The run window's typed length, already applied to `durationMinutes`; null when the sheet decides. */
  plannedDurationOverrideMinutes: number | null;
  /** 'pool' / 'single_elim' / 'double_elim' — drives the bracket-vs-pool chip on the grid. */
  phaseType: string | null;
  /** Populated for pool-type matches so the grid can group + colour-tint
   *  matches by pool. Null for bracket / finals matches. */
  poolId: string | null;
  poolName: string | null;
  /**
   * The rest the sheet gives this bout's Pool in its middle, in minutes — the
   * crew's pause the server lays after half the Pool's bouts (`sheetRestFor`,
   * the same number `layRun` and Generate use). The board draws it and keeps
   * the Pool's header in one piece across it. Null outside a Pool.
   */
  poolRestMinutes: number | null;
}
