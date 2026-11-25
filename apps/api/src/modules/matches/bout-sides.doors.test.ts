import type { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  writesTo,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';
import { PenaltiesService } from '../penalties/penalties.service';
import { BOUT_COLUMNS } from './clock.service';
import {
  BOUT,
  IDLE,
  NOW,
  PRESS,
  press,
  row,
  setup as clockSetup,
  wroteNothing,
} from './clock-late-press.fixtures';
import { fighterStatusDouble } from './fighter-status.fixtures';
import { MatchesService } from './matches.service';

/**
 * Each door a bout waiting for a Fighter must not pass (operator, 2026-11-24): a hit, a card of
 * the queue, a direct card, a Start sent at once, a Start sent late, and the colour swap.
 *
 * The final's blue side is the winner of a semi-final still running. Léa's pad sends a Start, a
 * hit and a card for it. Each is refused with the code `bout_side_missing`, and nothing is
 * written. A team bout (slice 1b) has no Registration on either side and a team on each: it is
 * never refused. A press, a hit or a card the server already holds is still answered "saved":
 * the replay probe runs before the guard.
 */
const SCORER = 'a0000000-0000-4000-8000-000000000001';
const AFTER = '2026-11-24T10:01:00.000Z';
const SAVED_HIT = { id: 'ex-1', client_uuid: 'uuid-saved', match_id: 'm1', sequence: 3 };
const SAVED_CARD = { id: 'card-1', client_uuid: 'uuid-saved', match_id: 'm1' };
const HIT = { sequence: 4, type: 'no_exchange' };
const CARD = { sequence: 4, registrationId: 'reg-red', reason: 'late on the piste' };
const QUEUED = { rulesetEntryId: 'entry-1' };
const DIRECT = { directCard: 'yellow' };

/** A side waits: no blue Fighter yet. */
const WAITING = { red_registration_id: 'reg-red', blue_registration_id: null };
/** Both sides are teams (slice 1b): no Registration, and nothing waits. */
const TEAMS = {
  red_registration_id: null,
  blue_registration_id: null,
  red_team_id: 'team-red',
  blue_team_id: 'team-blue',
};

/** The selects the guard widens, whole: a mock ignores the projection. */
const ROUND_READ =
  'status, current_round, awaiting_round_advance, ' +
  'red_registration_id, blue_registration_id, red_team_id, blue_team_id';
const CARD_READ =
  'id, status, red_registration_id, blue_registration_id, red_team_id, blue_team_id, ' +
  'phase_id, locked_at, current_round, awaiting_round_advance, match_rules(penalty_ruleset_id)';
const LOCK_READ =
  'id, red_registration_id, blue_registration_id, red_team_id, blue_team_id, side_order, locked_at';
const CLOCK_READ =
  'id, status, locked_at, started_at, match_rules_id, earlier_rules_ids, rounds_json, current_round, ' +
  'red_registration_id, blue_registration_id, red_team_id, blue_team_id, winner_registration_id, ' +
  'winner_team_id, red_score, blue_score, match_number_label, awaiting_round_advance, ' +
  'back_in_play_at, phases(type, tournaments(events(status))), ' +
  'match_rules(ruleset_code, ruleset_version, ruleset_config, scoring_config_json)';

/** The code and the status of a refusal, or null when the door answered. */
async function refusalOf(attempt: Promise<unknown>) {
  const thrown = await attempt.then(
    () => null,
    (error: unknown) => error as HttpException,
  );
  if (!thrown) return null;
  const body = thrown.getResponse?.() as { code?: string } | undefined;
  return { status: thrown.getStatus?.(), code: body?.code };
}
const SIDE_MISSING = { status: 409, code: 'bout_side_missing' };

/** The bout of the hit, card and swap doors: running, never reset, its sides set by the story. */
const RUNNING = {
  id: 'm1',
  status: 'running',
  phase_id: 'phase-1',
  locked_at: null,
  side_order: 'red_left',
  current_round: 1,
  awaiting_round_advance: false,
  red_team_id: null,
  blue_team_id: null,
  match_rules: { penalty_ruleset_id: null },
};

function scoringSetup(sides: SupabaseRow) {
  const db = mockSupabase({
    exchanges: { rows: [SAVED_HIT] },
    match_penalties: { rows: [SAVED_CARD] },
    matches: { rows: [{ ...RUNNING, ...sides }] },
    match_events: { rows: [] },
    phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1' }] },
    tournaments: { rows: [{ id: 'tournament-1', event_id: 'event-1', penalty_ruleset_id: null }] },
    events: { rows: [{ id: 'event-1', organization_id: 'org-1', penalty_ruleset_id: null }] },
    penalty_rulesets: { rows: [] },
  });
  const scoring = { recomputeMatchScore: vi.fn(), assertNoRecordHolds: vi.fn() };
  const matches = new MatchesService(
    db as never,
    scoring as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const penalties = new PenaltiesService(
    db as never,
    scoring as never,
    undefined,
    undefined,
    undefined,
    undefined,
    fighterStatusDouble(),
  );
  const hit = (clientUuid = 'uuid-new') =>
    matches.createExchange('m1', { ...HIT, clientUuid, occurredAt: AFTER } as never);
  const card = (kind: object, clientUuid = 'uuid-new') =>
    penalties.createPenalty('m1', { ...CARD, ...kind, clientUuid, occurredAt: AFTER } as never, {
      userId: SCORER,
      staffAccountId: 'pad-1',
    });
  const swap = () => matches.swapFighterColor('m1');
  return { db, scoring, hit, card, swap };
}

describe('a hit for a bout waiting for a Fighter', () => {
  it('is refused with a code, and nothing is written', async () => {
    const { db, scoring, hit } = scoringSetup(WAITING);

    expect(await refusalOf(hit())).toEqual(SIDE_MISSING);

    expect(db.writes).toEqual([]);
    expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
    expect(selectsFor(db.from, 'matches')).toEqual([ROUND_READ]);
  });

  it('is taken on a team bout', async () => {
    const { db, hit } = scoringSetup(TEAMS);

    expect(await refusalOf(hit())).toBeNull();
    expect(writesTo(db, 'exchanges').map((write) => write.op)).toEqual(['insert']);
  });

  it('a hit the server holds is still answered with the saved row', async () => {
    const { db, hit } = scoringSetup(WAITING);

    await expect(hit('uuid-saved')).resolves.toEqual(SAVED_HIT);
    expect(db.writes).toEqual([]);
  });
});

describe('a card for a bout waiting for a Fighter', () => {
  it.each<[string, object]>([
    ['of the queue', QUEUED],
    ['given at once', DIRECT],
  ])('a card %s is refused with a code, and nothing is written', async (_kind, kind) => {
    const { db, scoring, card } = scoringSetup(WAITING);

    expect(await refusalOf(card(kind))).toEqual(SIDE_MISSING);

    expect(db.writes).toEqual([]);
    expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
    expect(selectsFor(db.from, 'matches')).toEqual([CARD_READ]);
  });

  // Its Fighter is a member of a team: the card meets the rules after the sides, not this one.
  it.each<[string, object]>([
    ['of the queue', QUEUED],
    ['given at once', DIRECT],
  ])('a card %s passes the sides of a team bout', async (_kind, kind) => {
    const { card } = scoringSetup(TEAMS);

    expect(await refusalOf(card(kind))).not.toEqual(SIDE_MISSING);
  });

  it('a card the server holds is still answered with the saved row', async () => {
    const { db, card } = scoringSetup(WAITING);

    await expect(card(QUEUED, 'uuid-saved')).resolves.toEqual(SAVED_CARD);
    expect(db.writes).toEqual([]);
  });
});

describe('the colour swap of a bout waiting for a Fighter', () => {
  it('is refused with a code, and nothing is written', async () => {
    const { db, scoring, swap } = scoringSetup(WAITING);

    expect(await refusalOf(swap())).toEqual(SIDE_MISSING);

    expect(db.writes).toEqual([]);
    expect(scoring.assertNoRecordHolds).not.toHaveBeenCalled();
    expect(selectsFor(db.from, 'matches')).toEqual([LOCK_READ]);
  });

  it('passes on a team bout', async () => {
    const { db, swap } = scoringSetup(TEAMS);

    expect(await refusalOf(swap())).toBeNull();
    expect(writesTo(db, 'matches').map((write) => write.op)).toEqual(['update']);
  });
});

describe('a Start for a bout waiting for a Fighter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(NOW) });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const SCHEDULED = { status: 'scheduled', started_at: null };

  it('sent at once, is refused with a code, and nothing is written', async () => {
    const { db, clock } = clockSetup(IDLE, { ...SCHEDULED, ...WAITING });

    expect(await refusalOf(clock.clockAction(BOUT, 'start'))).toEqual(SIDE_MISSING);

    wroteNothing(db);
    expect(selectsFor(db.service.from, 'matches')).toEqual([CLOCK_READ]);
    expect(BOUT_COLUMNS).toBe(CLOCK_READ);
  });

  it('sent at once, is taken on a team bout', async () => {
    const { db, clock } = clockSetup(IDLE, { ...SCHEDULED, ...TEAMS });

    await clock.clockAction(BOUT, 'start');

    expect(writesTo(db, 'match_events')).toHaveLength(1);
  });

  // The late door has coded refusals of its own: the code is this one, exactly.
  it('sent late, is refused with a code, and nothing is written', async () => {
    const { db, clock } = clockSetup(IDLE, { ...SCHEDULED, ...WAITING });

    expect(await refusalOf(clock.latePress(BOUT, 'start', press('10:59:00')))).toEqual(
      SIDE_MISSING,
    );

    wroteNothing(db);
  });

  it('sent late, is taken on a team bout', async () => {
    const { db, clock } = clockSetup(IDLE, { ...SCHEDULED, ...TEAMS });

    await clock.latePress(BOUT, 'start', press('10:59:00'));

    expect(writesTo(db, 'match_events')).toHaveLength(1);
  });

  // The Start was saved, then the blue side was cleared: its resend is answered, never refused.
  it('sent again, once saved, is answered with the clock', async () => {
    const saved = [row(1, 'start', '10:00:00', { client_uuid: PRESS })];
    const { db, clock } = clockSetup(saved, WAITING);

    await expect(clock.latePress(BOUT, 'start', press('10:00:00'))).resolves.toMatchObject({
      status: 'running',
    });
    wroteNothing(db);
  });
});
