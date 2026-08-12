/**
 * "This bout was never played", as a column set.
 *
 * One owner, because the answer has been wrong twice in two different places.
 * `matchSnapshot`/`restoreMatchState` in match-forfeits.service.ts document the
 * first: a column the completion path sets and the revert path does not write
 * stays at whatever the previous fight left it, silently — `end_reason` was
 * exactly that. `resetMatch` had the same hole, plus the durations and the lock.
 *
 * Every field here is load-bearing for something downstream:
 *
 *   status / started_at   `hasStarted` in bracket-match-sync.ts is exactly
 *                         `started_at !== null || status ∈ {running,paused,
 *                         completed}`, and it is the whole gate on whether
 *                         advancement may rewrite the bout's pairing. Miss
 *                         either and a reseed is a silent skip.
 *   end_reason            'max_doubles' is read as a mutual loss by Swiss
 *                         standings and by the HEMA Ratings submission. Left
 *                         stale it makes both fighters lose a bout one of them
 *                         won, in an export that leaves the platform.
 *   duration_*            the clock's `end` writes them; nothing else clears
 *                         them.
 *   lock columns          auto-lock only ever ADDS a lock, and its group gate
 *                         needs every match in the group completed or voided —
 *                         which an unplayed one is not — so it never revisits.
 *                         A lock outliving its result makes the bout
 *                         unscoreable with no route back but a manual unlock.
 *   best-of round state   a stale `rounds_json` re-opens the series mid-way.
 *
 * NOT included, on purpose: `side_order` (the operator's display choice, not a
 * result), `scorekeeper_user_id` (an assignment), `lice_id` / `scheduled_at`
 * (the operator's schedule placement, which a replay must keep).
 *
 * A plain object rather than a write, so callers stay in charge of the where
 * clause and can fold it into an update they are already making.
 */
export function unplayedMatchColumns(now = new Date().toISOString()): Record<string, unknown> {
  return {
    status: 'scheduled',
    red_score: 0,
    blue_score: 0,
    winner_registration_id: null,
    started_at: null,
    ended_at: null,
    end_reason: null,
    duration_active_ms: null,
    duration_total_ms: null,
    locked_at: null,
    locked_by_user_id: null,
    locked_by_staff_account_id: null,
    lock_source: null,
    lock_reason: null,
    current_round: 1,
    red_round_wins: 0,
    blue_round_wins: 0,
    rounds_json: null,
    awaiting_round_advance: false,
    updated_at: now,
  };
}
