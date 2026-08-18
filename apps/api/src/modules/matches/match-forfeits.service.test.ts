import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MatchForfeitsService } from './match-forfeits.service';
import { seededTableChain } from '../../common/testing/supabase-chain-seeded';
import {
  mockSupabase,
  scopedTo,
  writesTo,
  type RecordedWrite,
  type SeededTable,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';

/**
 * Views over the shared double's write log.
 *
 * The log is one list per table in call order, every verb together — so the
 * kind has to be named. `createForfeit` inserts a record and then UPDATES it as
 * the cascade resolves, and a reader that took every write to `match_forfeits`
 * as an insert would see three phantom rows with no `match_id`.
 *
 * `idsWritten` is the one that matters most: an update or a delete names its
 * row only through the filters that scoped it. The double is a fixture, not a
 * database, so the written row alone cannot tell a restore of the two bouts one
 * record closed from a restore of every bout in the event.
 */
type Writes = { writes: RecordedWrite[] };

const writesOf = (supabase: Writes, table: string, op: RecordedWrite['op']): RecordedWrite[] =>
  writesTo(supabase, table).filter((write) => write.op === op);

const rowsOf = (supabase: Writes, table: string, op: RecordedWrite['op']): SupabaseRow[] =>
  writesOf(supabase, table, op).map((write) => write.row as SupabaseRow);

const idsWritten = (
  supabase: Writes,
  table: string,
  op: RecordedWrite['op'] = 'update',
): unknown[] => writesOf(supabase, table, op).map((write) => scopedTo(write, 'id'));

describe('MatchForfeitsService', () => {
  it('records a voluntary forfeit as a 0-6 match loss and asks continuation through canContinue', async () => {
    // `registrations` is declared because `createForfeit` reads it on EVERY
    // call — `previous_registration_state` is the fighter's status before the
    // forfeit, so the record can restore it. The local double answered that
    // read with silence, and the snapshot was empty in every test here.
    const supabase = mockSupabase({
      matches: { rows: [matchRow({ phaseType: 'pool', status: 'running' })] },
      match_forfeits: { rows: [], returning: { id: 'forfeit-1' } },
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(rowsOf(supabase, 'match_forfeits', 'insert')[0]).toMatchObject({
      previous_registration_state: { id: 'reg-red', status: 'checked_in' },
      match_id: 'match-1',
      forfeiting_registration_id: 'reg-red',
      winner_registration_id: 'reg-blue',
      reason: 'voluntary',
      score_policy: 'fixed_loss',
      forfeiting_score: 0,
      opponent_score: 6,
      can_continue: true,
    });
    expect(rowsOf(supabase, 'matches', 'update')[0]).toMatchObject({
      status: 'completed',
      winner_registration_id: 'reg-blue',
      red_score: 0,
      blue_score: 6,
    });
  });

  it('auto-forfeits later unstarted pool matches when fighter cannot continue', async () => {
    // Withdrawing a fighter closes the bouts they have left IN THIS POOL, and
    // only the ones nobody has fought. The four bouts below the two real ones
    // each match on all but one column: another pool, already finished, and
    // two strangers' bout. Seeded, so which bouts got closed is a fact about
    // the schedule rather than a list the fixture handed back.
    const supabase = mockSupabase({
      matches: {
        rows: [
          matchRow({ phaseType: 'pool', status: 'running' }),
          {
            id: 'later-1',
            pool_id: 'pool-1',
            red_registration_id: 'reg-red',
            blue_registration_id: 'reg-green',
            status: 'scheduled',
          },
          // Halted mid-bout, not fought to a finish — this one closes too.
          {
            id: 'paused-1',
            pool_id: 'pool-1',
            red_registration_id: 'reg-white',
            blue_registration_id: 'reg-red',
            status: 'paused',
          },
          // Their bout in another pool. That pool's schedule is not this
          // withdrawal's to close.
          {
            id: 'other-pool-1',
            pool_id: 'pool-2',
            red_registration_id: 'reg-red',
            blue_registration_id: 'reg-green',
            status: 'scheduled',
          },
          // Already fought. Re-forfeiting it would overwrite a real result.
          {
            id: 'done-1',
            pool_id: 'pool-1',
            red_registration_id: 'reg-red',
            blue_registration_id: 'reg-grey',
            status: 'completed',
          },
          // Two other fighters, in this pool, still to come.
          {
            id: 'strangers-1',
            pool_id: 'pool-1',
            red_registration_id: 'reg-x',
            blue_registration_id: 'reg-y',
            status: 'scheduled',
          },
        ],
      },
      match_forfeits: {
        rows: [],
        returning: (row: SupabaseRow) => ({ id: `ff-${String(row['match_id'])}` }),
      },
      // Declared because the withdrawal lands here. The local double answered
      // an undeclared table with an empty fixture, so this write had no table.
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'injury',
      canContinue: false,
    });

    // Their own bout, then the two they had left. Nothing else.
    expect(rowsOf(supabase, 'match_forfeits', 'insert').map((row) => row['match_id'])).toEqual([
      'match-1',
      'later-1',
      'paused-1',
    ]);
    expect(rowsOf(supabase, 'match_forfeits', 'insert')[1]).toMatchObject({
      match_id: 'later-1',
      forfeiting_registration_id: 'reg-red',
      winner_registration_id: 'reg-green',
      auto_created: true,
    });
    // The winner is read off each bout, so a bout closed from the blue corner
    // hands it to the fighter in red.
    expect(rowsOf(supabase, 'match_forfeits', 'insert')[2]).toMatchObject({
      match_id: 'paused-1',
      winner_registration_id: 'reg-white',
    });
    // Every one of those bouts is completed, and no others are touched.
    expect(idsWritten(supabase, 'matches')).toEqual(['match-1', 'later-1', 'paused-1']);
    // The withdrawal itself lands on the fighter who withdrew.
    expect(rowsOf(supabase, 'registrations', 'update')[0]).toMatchObject({ status: 'withdrawn' });
    expect(idsWritten(supabase, 'registrations')).toEqual(['reg-red']);
  });

  it('rejects void when a downstream dependent match has started', async () => {
    const supabase = mockSupabase({
      match_forfeits: {
        rows: [
          {
            id: 'forfeit-1',
            match_id: 'match-1',
            downstream_match_ids: ['downstream-1'],
            voided_at: null,
          },
        ],
      },
      matches: { rows: [{ id: 'downstream-1', status: 'running' }] },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await expect(service.voidForfeit('forfeit-1')).rejects.toThrow(BadRequestException);
  });

  /**
   * "Forfeit before 1st match → auto-DQ" counts the fighter's OTHER completed
   * bouts, and three filters decide that count: completed only, this bout
   * excluded, and either corner of the bout being theirs. A hardcoded `count`
   * asserted the policy while proving nothing about who was counted — seed
   * `matches` instead and the count is a fact about the rows.
   *
   * The history below is the same in both tests. Only whether the fighter is in
   * it changes, which is the whole question the policy asks.
   */
  const DQ_MATCH = matchRow({
    phaseType: 'pool',
    status: 'running',
    tournamentPolicy: { forfeitFighterBefore1stMatch: true },
  });

  const otherBouts = (mine: Record<string, unknown>[]) => ({
    matches: {
      rows: [
        DQ_MATCH,
        // Completed, but somebody else's bout entirely.
        {
          id: 'other-1',
          status: 'completed',
          red_registration_id: 'reg-x',
          blue_registration_id: 'reg-y',
        },
        // Theirs, but not finished — a scheduled bout is not one they fought.
        {
          id: 'later-1',
          status: 'scheduled',
          red_registration_id: 'reg-red',
          blue_registration_id: 'reg-z',
        },
        ...mine,
      ],
    },
    match_forfeits: { rows: [], returning: { id: 'forfeit-1' } },
    registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
  });

  it("auto-disqualifies a forfeit before the fighter's first match when the policy is on", async () => {
    // Nothing conditioned on match count before this; the per-reason
    // tournamentState ('voluntary' -> 'ask') cannot express it.
    const supabase = mockSupabase(otherBouts([]));
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(rowsOf(supabase, 'registrations', 'update')[0]).toMatchObject({
      status: 'disqualified',
    });
    // On them, and on nobody else in the pool.
    expect(idsWritten(supabase, 'registrations')).toEqual(['reg-red']);
  });

  it('does not auto-disqualify when the fighter has already completed a match', async () => {
    // The only row added is one they actually fought and finished — in the BLUE
    // corner, so a count that only looks at red would still disqualify them.
    const supabase = mockSupabase(
      otherBouts([
        {
          id: 'done-1',
          status: 'completed',
          red_registration_id: 'reg-w',
          blue_registration_id: 'reg-red',
        },
      ]),
    );
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(writesOf(supabase, 'registrations', 'update')).toEqual([]);
  });

  /**
   * "Disqualify after N forfeits" counts this fighter's own live forfeits in
   * this Tournament, and four filters decide which rows those are. A hardcoded
   * `count` asserted the threshold while proving nothing about whose forfeits
   * were counted, or whether a voided one still counted.
   *
   * The history below is one real prior forfeit and four rows that must not
   * count: another fighter's, another Tournament's, one this fighter had voided,
   * and an organiser's score correction, which shares the table but is not a
   * forfeit at all. Seeded, so the count is a fact about rows — and the forfeit being
   * recorded now needs its stored id, which only `returning` can supply.
   */
  const forfeitHistory = (mine: Record<string, unknown>[]) => ({
    rows: [
      {
        id: 'ff-mine',
        tournament_id: 'tournament-1',
        forfeiting_registration_id: 'reg-red',
        reason: 'voluntary',
        voided_at: null,
        match_id: 'match-8',
      },
      {
        id: 'ff-other-fighter',
        tournament_id: 'tournament-1',
        forfeiting_registration_id: 'reg-blue',
        reason: 'voluntary',
        voided_at: null,
        match_id: 'match-7',
      },
      {
        id: 'ff-other-tournament',
        tournament_id: 'tournament-2',
        forfeiting_registration_id: 'reg-red',
        reason: 'voluntary',
        voided_at: null,
        match_id: 'match-6',
      },
      {
        id: 'ff-override',
        tournament_id: 'tournament-1',
        forfeiting_registration_id: 'reg-red',
        // An organiser correcting a score. It shares this table but nobody
        // forfeited, so it must not push anyone toward a disqualification.
        reason: 'admin_correction',
        voided_at: null,
        match_id: 'match-4',
      },
      {
        id: 'ff-voided',
        tournament_id: 'tournament-1',
        forfeiting_registration_id: 'reg-red',
        reason: 'voluntary',
        voided_at: '2026-01-01T00:00:00Z',
        match_id: 'match-5',
      },
      ...mine,
    ],
    returning: { id: 'forfeit-new' },
  });

  it('disqualifies on the Nth forfeit per tournamentPolicy.disqualifyAfter', async () => {
    // "Disqualify after N forfeits" counts FORFEITS, not black cards. The
    // per-reason state and the penalty ruleset's black-card ordinal both key off
    // something else, so nothing in the codebase counted these.
    const supabase = mockSupabase({
      matches: {
        rows: [
          matchRow({
            phaseType: 'pool',
            status: 'running',
            tournamentPolicy: { disqualifyAfter: 2 },
          }),
        ],
      },
      // One live forfeit of their own already; this one makes two.
      match_forfeits: forfeitHistory([]),
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(rowsOf(supabase, 'registrations', 'update')[0]).toMatchObject({
      status: 'disqualified',
    });
  });

  it('does not reach the threshold on rows that are not this fighter’s live forfeits', async () => {
    // The same history with the fighter's one real prior forfeit removed. Four
    // rows still match on some column each, and none of them should count — so
    // a threshold of 2 is not reached and nobody is disqualified.
    const history = forfeitHistory([]);
    const supabase = mockSupabase({
      matches: {
        rows: [
          matchRow({
            phaseType: 'pool',
            status: 'running',
            tournamentPolicy: { disqualifyAfter: 2 },
          }),
        ],
      },
      match_forfeits: {
        ...history,
        rows: history.rows.filter((row) => row['id'] !== 'ff-mine'),
      },
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(writesOf(supabase, 'registrations', 'update')).toEqual([]);
  });

  it('leaves the per-reason state alone when no tournament policy is set', async () => {
    // Both counts are facts about the rows now: the fighter has fought nothing
    // (this bout is the only match) and has no prior forfeit. With no policy
    // set neither number can reach a threshold anyway, which is the point.
    const supabase = mockSupabase({
      matches: { rows: [matchRow({ phaseType: 'pool', status: 'running' })] },
      match_forfeits: { rows: [], returning: { id: 'forfeit-1' } },
      registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(writesOf(supabase, 'registrations', 'update')).toEqual([]);
  });
});

describe('MatchForfeitsService — result overrides', () => {
  it('overrides a COMPLETED match, which a forfeit may not touch', async () => {
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({ phaseType: 'pool', status: 'completed' }),
        update: { id: 'match-1' },
      },
      match_forfeits: { maybeSingle: null, insert: { id: 'override-1' } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'admin_correction',
      explicitScores: { forfeitingScore: 3, opponentScore: 5 },
    });

    expect(supabase.inserted.match_forfeits?.[0]).toMatchObject({
      reason: 'admin_correction',
      score_policy: 'explicit',
      forfeiting_score: 3,
      opponent_score: 5,
      winner_registration_id: 'reg-blue',
    });
    // The stated result, not one derived from the ruleset's per-reason policy.
    expect(supabase.updated.matches?.[0]).toMatchObject({
      status: 'completed',
      red_score: 3,
      blue_score: 5,
      winner_registration_id: 'reg-blue',
      // Never 'forfeit': nobody withdrew, and the pad and the hall screen
      // would announce one.
      end_reason: 'override',
    });
  });

  it('still refuses a FORFEIT on a completed match', async () => {
    const supabase = fakeSupabase({
      matches: { maybeSingle: matchRow({ phaseType: 'pool', status: 'completed' }) },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await expect(
      service.createForfeit('match-1', {
        forfeitingRegistrationId: 'reg-red',
        reason: 'injury',
        canContinue: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not count an override toward tournamentPolicy.disqualifyAfter', async () => {
    // The same shape that disqualifies on a forfeit: a threshold of 1 and
    // five prior rows. A correction is not a forfeit, so nothing escalates.
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({
          phaseType: 'pool',
          status: 'completed',
          tournamentPolicy: { disqualifyAfter: 1, forfeitFighterBefore1stMatch: true },
        }),
        update: { id: 'match-1' },
        count: 0,
      },
      match_forfeits: { maybeSingle: null, insert: { id: 'override-1' }, count: 5 },
      registrations: { maybeSingle: { id: 'reg-red', status: 'checked_in' } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'referee_decision',
      explicitScores: { forfeitingScore: 0, opponentScore: 1 },
    });

    expect(supabase.updated.registrations?.[0]).toBeUndefined();
  });

  it('refuses an override once a dependent match has started', async () => {
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({ phaseType: 'single_elim', status: 'completed' }),
        select: [{ id: 'downstream-1', status: 'running' }],
      },
    });
    const bracketAdvance = {
      findDownstreamMatchIds: vi.fn(async () => ['downstream-1']),
      clearDownstreamOf: vi.fn(async () => {}),
    };
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined as never,
      bracketAdvance as never,
    );

    await expect(
      service.createForfeit('match-1', {
        forfeitingRegistrationId: 'reg-red',
        reason: 'referee_decision',
        explicitScores: { forfeitingScore: 0, opponentScore: 1 },
      }),
    ).rejects.toThrow('Cannot override a result after a dependent match has started');
    expect(supabase.inserted.match_forfeits).toBeUndefined();
  });

  it('clears the downstream slot before re-advancing an overridden bracket match', async () => {
    // Advancement only fills a side that is still null, so without the clear
    // the re-advance is a silent no-op and the bracket keeps the old winner.
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({ phaseType: 'single_elim', status: 'completed' }),
        update: { id: 'match-1' },
        select: [{ id: 'downstream-1', status: 'scheduled' }],
      },
      match_forfeits: { maybeSingle: null, insert: { id: 'override-1' } },
      bracket_slots: { maybeSingle: null },
    });
    const bracketAdvance = {
      findDownstreamMatchIds: vi.fn(async () => ['downstream-1']),
      clearDownstreamOf: vi.fn(async () => {}),
    };
    const matchCompletion = { onMatchCompleted: vi.fn(async () => {}) };
    const service = new MatchForfeitsService(
      supabase as never,
      matchCompletion as never,
      undefined as never,
      bracketAdvance as never,
    );

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'technical_failure',
      explicitScores: { forfeitingScore: 1, opponentScore: 4 },
    });

    expect(bracketAdvance.clearDownstreamOf).toHaveBeenCalledWith('match-1');
    expect(matchCompletion.onMatchCompleted).toHaveBeenCalledWith('match-1');
    // Order is the whole point — clearing after the re-advance would undo it.
    expect(bracketAdvance.clearDownstreamOf.mock.invocationCallOrder[0]).toBeLessThan(
      matchCompletion.onMatchCompleted.mock.invocationCallOrder[0] as number,
    );
  });
});

/**
 * A match row as `loadMatch` reads it back.
 *
 * The phase and the tournament ride along on the row, through the embed the
 * select asks for — this service never queries either table. A fixture entry
 * for `phases` or `tournaments` answers nothing, so there is none.
 */
function matchRow(input: {
  phaseType: string;
  status: string;
  tournamentPolicy?: Record<string, unknown>;
}) {
  return {
    id: 'match-1',
    phase_id: 'phase-1',
    pool_id: input.phaseType === 'pool' ? 'pool-1' : null,
    bracket_slot_id: input.phaseType === 'pool' ? null : 'slot-1',
    red_registration_id: 'reg-red',
    blue_registration_id: 'reg-blue',
    red_score: 2,
    blue_score: 3,
    status: input.status,
    phases: {
      id: 'phase-1',
      type: input.phaseType,
      tournament_id: 'tournament-1',
      config_json: {},
      tournaments: {
        id: 'tournament-1',
        ruleset_config: input.tournamentPolicy ? { tournamentPolicy: input.tournamentPolicy } : {},
      },
    },
  };
}

type TableState = Record<
  string,
  {
    /**
     * A row, or a resolver over the `.eq()` filters that scoped the read.
     *
     * The resolver form exists because one table can be read twice in a single
     * call with different intent — `loadActiveForfeit` keys on `match_id`, the
     * cascade's parent probe keys on `id`. Discriminating on the FILTERS is
     * order-independent; an ordered `mockReturnValueOnce` queue silently
     * desyncs the moment a read is added anywhere upstream.
     */
    maybeSingle?: unknown | ((filters: Array<[string, unknown]>) => unknown);
    select?: unknown[];
    insert?: unknown;
    update?: unknown;
    /** For `.select(col, { count: 'exact', head: true })` lookups. */
    count?: number;
    /**
     * A SIMULATED table: the shared double filters these rows, so `.eq()`,
     * `.in()`, `.or()` and a `count` are facts about the fixture rather than
     * numbers the test asserted into being. Prefer it — the canned keys above
     * hand back the same answer whatever the query asked for.
     */
    rows?: SupabaseRow[];
    /**
     * What the database adds to an inserted row — the id a later write keys on.
     * A `rows:` table whose insert is read back must declare it.
     */
    returning?: SeededTable['returning'];
  }
>;

/**
 * A canned table's `maybeSingle`, resolving the filter-aware form.
 *
 * At module scope only to keep `chain` inside the line budget — the resolver
 * form is the interesting part, and it is documented on TableState.
 */
function cannedMaybeSingle(
  tableState: TableState[string],
  filters: Array<[string, unknown]>,
): { data: unknown; error: null } {
  const seed = tableState.maybeSingle;
  return {
    data:
      typeof seed === 'function'
        ? (seed as (f: typeof filters) => unknown)(filters)
        : (seed ?? null),
    error: null,
  };
}

/**
 * A `rows:` table, handed to the shared double so the real filters narrow it.
 *
 * At module scope only to keep `chain` inside the line budget.
 */
function seededChainFor(
  table: string,
  tableState: TableState[string],
  writes: RecordedWrite[],
  selects: Array<{ table: string; columns: string }>,
) {
  const chain = seededTableChain(
    { rows: tableState.rows ?? [], returning: tableState.returning },
    { table, writes },
  );
  // The shared double does not log projections on purpose — a projection does
  // not scope a write, which is what its log is for. One test here asserts a
  // projection, so record it on the way through and delegate.
  const projected = chain.select;
  chain.select = vi.fn((columns?: unknown, options?: unknown) => {
    if (typeof columns === 'string') selects.push({ table, columns });
    return projected(columns, options);
  });
  return chain;
}

function fakeSupabase(state: TableState) {
  const inserted: Record<string, unknown[]> = {};
  const updated: Record<string, unknown[]> = {};
  /** Updates WITH the filters that scoped them — `updated` alone cannot say
   *  which row was written, which is what a cascade's ordering needs. */
  const mutations: Array<{ table: string; row: unknown; filters: Array<[string, unknown]> }> = [];
  /** The column lists asked for. This double does NOT project — `select()`
   *  hands back the whole fixture row whatever it was asked for — so a column
   *  missing from a projection cannot change behaviour here the way it does
   *  against Postgres. Recording the request is the only way to assert one. */
  const selects: Array<{ table: string; columns: string }> = [];
  /** Writes the shared double records for `rows:` tables, mirrored below. */
  const seededWrites: RecordedWrite[] = [];
  /** Records the projection and hands the chain back, so `select` stays one
   *  line inside `chain` — which is already at its length budget. */
  const recordSelect = (table: string, columns: unknown, api: unknown) => {
    if (typeof columns === 'string') selects.push({ table, columns });
    return api;
  };

  function chain(table: string) {
    const tableState = state[table] ?? {};
    // A `rows:` table is handed to the shared seeded double, which narrows on
    // the real filters. Its writes are mirrored into `inserted`/`updated` so a
    // half-migrated fixture reads the same either way.
    if (tableState.rows) return seededChainFor(table, tableState, seededWrites, selects);
    // One array per chain, shared BY REFERENCE with the recorded mutation: the
    // `.eq()` calls come after `.update()` in the fluent chain, so they have to
    // be able to land on an entry that was already pushed.
    const filters: Array<[string, unknown]> = [];
    const promise = Promise.resolve({
      data: tableState.select ?? [],
      count: tableState.count ?? 0,
      error: null,
    });
    // Supabase's fluent query builder is both thenable and chainable in the code under test.
    // The test double intentionally mirrors that hybrid shape.
    const api: any = Object.assign(promise, {
      select: vi.fn((columns?: unknown) => recordSelect(table, columns, api)),
      eq: vi.fn((column: string, value: unknown) => {
        filters.push([column, value]);
        return api;
      }),
      neq: vi.fn(() => api),
      is: vi.fn(() => api),
      or: vi.fn(() => api),
      in: vi.fn(() => api),
      not: vi.fn(() => api),
      order: vi.fn(() => api),
      limit: vi.fn(() => api),
      maybeSingle: vi.fn(() => Promise.resolve(cannedMaybeSingle(tableState, filters))),
      single: vi.fn(() =>
        Promise.resolve({ data: tableState.insert ?? tableState.update ?? null, error: null }),
      ),
      insert: vi.fn((row: unknown) => {
        inserted[table] = [...(inserted[table] ?? []), row];
        return api;
      }),
      update: vi.fn((row: unknown) => {
        updated[table] = [...(updated[table] ?? []), row];
        mutations.push({ table, row, filters });
        return api;
      }),
    });
    return api;
  }

  // Mirror the shared double's writes into the same shape the canned tables
  // use, so a fixture can migrate one table at a time without rewriting every
  // assertion in the file.
  const mirrorSeededWrites = () => {
    for (const write of seededWrites) {
      const bucket = write.op === 'insert' ? inserted : updated;
      bucket[write.table] = [...(bucket[write.table] ?? []), write.row];
      if (write.op === 'update') {
        mutations.push({
          table: write.table,
          row: write.row,
          filters: write.filters.map((f) => [String(f.args[0]), f.args[1]] as [string, unknown]),
        });
      }
    }
    seededWrites.length = 0;
  };

  // Getters, because the mirror has to run AFTER the call under test and the
  // tests read these properties directly.
  return {
    get inserted() {
      mirrorSeededWrites();
      return inserted;
    },
    get updated() {
      mirrorSeededWrites();
      return updated;
    },
    get mutations() {
      mirrorSeededWrites();
      return mutations;
    },
    selects,
    service: {
      from: vi.fn((table: string) => chain(table)),
    },
  };
}

/**
 * The rows a call wrote to one table, in order.
 *
 * An update names its row only through the filters that scoped it: this double
 * is a fixture, not a database, so `updated.matches` alone cannot tell a
 * restore of the two bouts one record closed from a restore of every bout in
 * the event.
 */
function writtenIds(
  supabase: { mutations: Array<{ table: string; filters: Array<[string, unknown]> }> },
  table: string,
) {
  return supabase.mutations
    .filter((mutation) => mutation.table === table)
    .map((mutation) => mutation.filters.find(([column]) => column === 'id')?.[1]);
}

/**
 * Each test below pins a defect found by adversarial review of the override
 * slice and reproduced by execution before its fix. The assertion is not
 * "the code does X" but "this specific way of losing an organiser's
 * correction cannot recur".
 */
describe('MatchForfeitsService — override regressions', () => {
  it('refuses a second override with a conflict instead of silently discarding it', async () => {
    // Was: the early return handed back the existing row, the route answered
    // 201, and the admin page reported success while the score never moved.
    // Correcting a mistyped override — or a match closed by a real forfeit,
    // the case migration 0177 exists for — was impossible through any UI.
    const supabase = fakeSupabase({
      matches: { maybeSingle: matchRow({ phaseType: 'pool', status: 'completed' }) },
      match_forfeits: { maybeSingle: { id: 'forfeit-1', match_id: 'match-1', voided_at: null } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await expect(
      service.createForfeit('match-1', {
        forfeitingRegistrationId: 'reg-red',
        reason: 'admin_correction',
        explicitScores: { forfeitingScore: 2, opponentScore: 5 },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(supabase.inserted.match_forfeits).toBeUndefined();
    expect(supabase.updated.matches).toBeUndefined();
  });

  it('keeps a repeated FORFEIT idempotent', async () => {
    // The other half of the same branch: a double-tap on the pad must still
    // return the existing row rather than erroring at the referee.
    const supabase = fakeSupabase({
      matches: { maybeSingle: matchRow({ phaseType: 'pool', status: 'running' }) },
      match_forfeits: { maybeSingle: { id: 'forfeit-1', match_id: 'match-1', voided_at: null } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    const result = await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'injury',
      canContinue: true,
    });

    expect(result).toMatchObject({ id: 'forfeit-1' });
    expect(supabase.inserted.match_forfeits).toBeUndefined();
  });

  /**
   * The bracket as it stands when a round-1 fighter does not show: their own
   * seeded slot, one more slot in the same round, and one in another phase.
   *
   * The reserve hunt reads every slot in THIS phase to learn who is already
   * placed, so the other phase's slot is what proves that scope: it places
   * `reg-spare`, and a lookup that reached it would decide the only reserve in
   * the event is already in the bracket.
   */
  const BRACKET_SLOTS = [
    {
      id: 'slot-1',
      phase_id: 'phase-1',
      round: 1,
      source_a_type: 'seed',
      source_b_type: 'seed',
      registration_a_id: 'reg-red',
      registration_b_id: 'reg-blue',
    },
    {
      id: 'slot-2',
      phase_id: 'phase-1',
      round: 1,
      source_a_type: 'seed',
      source_b_type: 'seed',
      registration_a_id: 'reg-x',
      registration_b_id: 'reg-y',
    },
    {
      id: 'slot-9',
      phase_id: 'phase-2',
      round: 1,
      source_a_type: 'seed',
      source_b_type: 'seed',
      registration_a_id: 'reg-spare',
      registration_b_id: 'reg-z',
    },
  ];

  /**
   * Who is entered, and who could take the empty side.
   *
   * `reg-spare` is the one eligible reserve. The three rows above it each look
   * like a better answer on one column and must not be taken: an unseeded
   * entrant sorts last, a withdrawn one is not available at all, and the
   * lowest seed in the list is entered in a different tournament.
   */
  const ENTRANTS = [
    { id: 'reg-unseeded', tournament_id: 'tournament-1', status: 'checked_in', seed: null },
    { id: 'reg-withdrawn', tournament_id: 'tournament-1', status: 'withdrawn', seed: 2 },
    { id: 'reg-elsewhere', tournament_id: 'tournament-2', status: 'checked_in', seed: 1 },
    { id: 'reg-spare', tournament_id: 'tournament-1', status: 'checked_in', seed: 9 },
    { id: 'reg-red', tournament_id: 'tournament-1', status: 'checked_in', seed: 3 },
    { id: 'reg-blue', tournament_id: 'tournament-1', status: 'checked_in', seed: 4 },
  ];

  it('does not swap a reserve into the bracket when overriding a scheduled match', async () => {
    // Was: applyBracketForfeit read the PRE-write row, so status was still
    // 'scheduled', tryReplaceMainRoundOneFighter fired, and it reset the match
    // to 0-0 with a different fighter — discarding the override just written.
    // Replacing a no-show is a forfeit remedy; an override states a result.
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({ phaseType: 'single_elim', status: 'scheduled' }),
        update: { id: 'match-1' },
      },
      match_forfeits: { maybeSingle: null, insert: { id: 'override-1' } },
      // A round-1 seeded slot AND an unused registration — everything
      // tryReplaceMainRoundOneFighter needs to find a reserve and fire. Without
      // both, this test passes vacuously on the unfixed code.
      bracket_slots: { rows: BRACKET_SLOTS },
      registrations: { rows: ENTRANTS },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'technical_failure',
      explicitScores: { forfeitingScore: 0, opponentScore: 5 },
    });

    expect(supabase.updated.bracket_slots).toBeUndefined();
    // Exactly one write: the override. A second would be the revert to 0-0.
    expect(supabase.updated.matches).toHaveLength(1);
    expect(supabase.updated.matches?.[0]).toMatchObject({
      status: 'completed',
      red_score: 0,
      blue_score: 5,
    });
  });

  it('never completes a bout it is about to hand to a reserve', async () => {
    // THE INVARIANT. The replacement used to be resolved AFTER `completeMatch`,
    // so the row went completed → scheduled/0-0 inside one request: an
    // un-completion that never reached `MatchCompletionService`. Self-inverting,
    // so never data loss, but the un-completion owner now assumes it is the only
    // thing that un-completes a bout, and this contradicted that.
    //
    // Deciding first means the bout is simply never completed, so the only write
    // is the fighter swap.
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({ phaseType: 'single_elim', status: 'scheduled' }),
        update: { id: 'match-1' },
      },
      match_forfeits: { rows: [], returning: { id: 'forfeit-1' } },
      // The registration ids matter here, unlike in the override test above
      // which returns before reading them: they are what decides WHICH side
      // the reserve replaces.
      bracket_slots: { rows: BRACKET_SLOTS },
      registrations: { rows: ENTRANTS },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'injury',
    });

    // The reserve is in, on the slot and on the row.
    expect(supabase.updated.bracket_slots?.[0]).toMatchObject({ registration_a_id: 'reg-spare' });
    expect(supabase.updated.matches).toHaveLength(1);
    expect(supabase.updated.matches?.[0]).toMatchObject({ red_registration_id: 'reg-spare' });
    // Onto the fighter's own slot and their own bout, and no others.
    expect(writtenIds(supabase, 'bracket_slots')).toEqual(['slot-1']);
    expect(writtenIds(supabase, 'matches')).toEqual(['match-1']);
    // The record is stamped twice on the way out — the reserve it named, then
    // the result the bout ended at — and both name the record just written.
    expect(writtenIds(supabase, 'match_forfeits')).toEqual(['forfeit-1', 'forfeit-1']);
    // And it carries the fighter's state as it was, which is the only thing a
    // later void can put them back to.
    expect(supabase.inserted.match_forfeits?.[0]).toMatchObject({
      previous_registration_state: { id: 'reg-red', status: 'checked_in' },
    });
    // And the bout was never completed on the way there — no status write at
    // all, in either direction.
    expect(
      (supabase.updated.matches ?? []).some((row) => 'status' in (row as Record<string, unknown>)),
    ).toBe(false);
  });

  it('records the matches it FEEDS as dependents, never itself', async () => {
    // Was: applyBracketForfeit pushed the match's own id, so voidForfeit —
    // whose started-set includes 'completed' — fired on the very match being
    // voided. Every bracket forfeit and override was permanently unvoidable.
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({ phaseType: 'single_elim', status: 'completed' }),
        update: { id: 'match-1' },
        select: [{ id: 'downstream-9', status: 'scheduled' }],
      },
      match_forfeits: { rows: [], returning: { id: 'override-1' } },
      bracket_slots: { maybeSingle: null },
    });
    const bracketAdvance = {
      findDownstreamMatchIds: vi.fn(async () => ['downstream-9']),
      clearDownstreamOf: vi.fn(async () => {}),
    };
    const service = new MatchForfeitsService(
      supabase as never,
      { onMatchCompleted: vi.fn(async () => {}) } as never,
      undefined as never,
      bracketAdvance as never,
    );

    const result = await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'referee_decision',
      explicitScores: { forfeitingScore: 1, opponentScore: 3 },
    });

    expect(result.downstream_match_ids).toEqual(['downstream-9']);
    expect(result.downstream_match_ids).not.toContain('match-1');
    // Stored on the record just written, and on no other. The list is read by
    // one guard only — "has a dependent started" — so writing it to the wrong
    // record would refuse a void somewhere else in the bracket.
    expect(writtenIds(supabase, 'match_forfeits')).toEqual(['override-1', 'override-1']);
  });

  it('refuses to rewrite a locked match without the override-locked capability', async () => {
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: {
          ...matchRow({ phaseType: 'pool', status: 'completed' }),
          locked_at: '2026-08-10T09:00:00.000Z',
        },
      },
      match_forfeits: { maybeSingle: null },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await expect(
      service.createForfeit(
        'match-1',
        {
          forfeitingRegistrationId: 'reg-red',
          reason: 'admin_correction',
          explicitScores: { forfeitingScore: 1, opponentScore: 2 },
        },
        { staffAccountId: 'staff-1' },
      ),
    ).rejects.toThrow('Match is locked');
    expect(supabase.inserted.match_forfeits).toBeUndefined();
  });

  it('lets an actor holding canOverrideLocked through the lock', async () => {
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: {
          ...matchRow({ phaseType: 'pool', status: 'completed' }),
          locked_at: '2026-08-10T09:00:00.000Z',
        },
        update: { id: 'match-1' },
      },
      match_forfeits: { maybeSingle: null, insert: { id: 'override-1' } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit(
      'match-1',
      {
        forfeitingRegistrationId: 'reg-red',
        reason: 'admin_correction',
        explicitScores: { forfeitingScore: 1, opponentScore: 2 },
      },
      { userId: 'user-1', canOverrideLocked: true },
    );

    expect(supabase.inserted.match_forfeits).toHaveLength(1);
  });

  it('un-advances the bracket when a record is voided', async () => {
    // Void was unreachable until the self-id was removed from
    // downstream_match_ids, which exposed that it restored the match and left
    // the winner it had propagated sitting in the next round. Advancement
    // fills a side only while it is null, so the replayed bout could never
    // correct it — the bracket kept the loser of the replay, silently.
    const supabase = fakeSupabase({
      match_forfeits: {
        rows: [
          {
            id: 'forfeit-1',
            match_id: 'match-1',
            parent_forfeit_id: null,
            downstream_match_ids: ['downstream-9'],
            voided_at: null,
            previous_match_state: { status: 'running', red_score: 2, blue_score: 3 },
          },
        ],
      },
      matches: {
        rows: [
          { id: 'match-1', status: 'completed', locked_at: null },
          { id: 'downstream-9', status: 'scheduled' },
          // A bout fought to a finish that this record does not feed. The
          // dependent check reads the ids it was handed and no others — a wider
          // read would refuse every void in a running event.
          { id: 'match-8', status: 'completed', started_at: '2026-08-12T08:00:00.000Z' },
        ],
      },
    });
    const bracketAdvance = {
      findDownstreamMatchIds: vi.fn(async () => ['downstream-9']),
      clearDownstreamOf: vi.fn(async () => {}),
    };
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined as never,
      bracketAdvance as never,
    );

    await service.voidForfeit('forfeit-1');

    expect(bracketAdvance.clearDownstreamOf).toHaveBeenCalledWith('match-1');
    // Cleared BEFORE the restore: downstreamSlots resolves through the match
    // row, which the restore is about to rewrite.
    expect(bracketAdvance.clearDownstreamOf.mock.invocationCallOrder[0]).toBeLessThan(
      (
        supabase.service.from as unknown as { mock: { invocationCallOrder: number[] } }
      ).mock.invocationCallOrder.at(-1) as number,
    );
  });

  it('voids over a dependent bout that was itself voided', async () => {
    // The dependent check refuses over a bout that has been fought, and reads
    // "fought" partly off `started_at` — which a voided bout keeps from the run
    // it had before someone voided it. A voided bout holds no live result, so
    // it is not a reason to refuse; excluding it at the query is what makes the
    // predicate's stated precondition true.
    const supabase = fakeSupabase({
      match_forfeits: {
        rows: [
          {
            id: 'forfeit-1',
            match_id: 'match-1',
            parent_forfeit_id: null,
            downstream_match_ids: ['downstream-7'],
            voided_at: null,
            previous_match_state: { status: 'running', red_score: 2, blue_score: 3 },
          },
        ],
      },
      matches: {
        rows: [
          { id: 'match-1', status: 'completed', locked_at: null },
          { id: 'downstream-7', status: 'voided', started_at: '2026-08-12T09:00:00.000Z' },
        ],
      },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.voidForfeit('forfeit-1');

    expect(supabase.updated.matches?.[0]).toMatchObject({ status: 'running' });
  });

  /**
   * The void that overwrites a real result.
   *
   * Every guard on this path asks whether the ACTOR may void. None asked whether
   * there is still the same thing to void. `liveMatchIds`' own comment names the
   * three routes that put a forfeited bout back in play with its record active —
   * reset, PATCH /status, the clock's reopen — but a bout taken back through one
   * of them and then fought to a finish is `completed` again, so no status-shaped
   * check sees anything wrong. The restore then writes the pre-forfeit snapshot
   * over a played result and the scores are gone.
   */
  it('refuses to void a record whose match has been replayed since', async () => {
    const supabase = fakeSupabase({
      match_forfeits: {
        maybeSingle: {
          id: 'forfeit-1',
          match_id: 'match-1',
          voided_at: null,
          previous_match_state: { status: 'scheduled', red_score: 0, blue_score: 0 },
          // What the forfeit left: a 0–3 walkover to blue.
          resulting_match_state: {
            status: 'completed',
            red_score: 0,
            blue_score: 3,
            winner_registration_id: 'reg-blue',
            ended_at: '2026-08-12T09:00:00.000Z',
            end_reason: 'forfeit',
          },
        },
        update: { id: 'forfeit-1' },
      },
      matches: {
        // What the bout says now: reset, re-fought, red won it 5–2 on points.
        maybeSingle: {
          locked_at: null,
          status: 'completed',
          red_score: 5,
          blue_score: 2,
          winner_registration_id: 'reg-red',
          ended_at: '2026-08-12T11:00:00.000Z',
          end_reason: 'first_to_points',
        },
      },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await expect(service.voidForfeit('forfeit-1')).rejects.toThrow(BadRequestException);
    // And nothing was written on the way to the refusal.
    expect(supabase.updated.matches).toBeUndefined();
    expect(supabase.updated.match_forfeits).toBeUndefined();
  });

  it('still voids when the match holds exactly the result the record produced', async () => {
    // The normal case, and the reason the guard compares rather than refusing on
    // any completed row: a forfeited bout IS completed, by the forfeit.
    const result = {
      status: 'completed',
      red_score: 0,
      blue_score: 3,
      winner_registration_id: 'reg-blue',
      ended_at: '2026-08-12T09:00:00.000Z',
      end_reason: 'forfeit',
    };
    const supabase = fakeSupabase({
      match_forfeits: {
        maybeSingle: {
          id: 'forfeit-1',
          match_id: 'match-1',
          voided_at: null,
          previous_match_state: { status: 'scheduled', red_score: 0, blue_score: 0 },
          resulting_match_state: result,
        },
        update: { id: 'forfeit-1' },
      },
      matches: { maybeSingle: { locked_at: null, ...result } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.voidForfeit('forfeit-1');

    expect(supabase.updated.matches).toContainEqual(
      expect.objectContaining({ status: 'scheduled' }),
    );
  });

  it('voids a record written before the post-state was captured', async () => {
    // Pre-0186 rows carry `{}`. Refusing on no evidence would make every
    // historical record permanently unvoidable, so the guard abstains and the
    // old status-shaped protection is what remains.
    const supabase = fakeSupabase({
      match_forfeits: {
        maybeSingle: {
          id: 'forfeit-1',
          match_id: 'match-1',
          voided_at: null,
          previous_match_state: { status: 'scheduled', red_score: 0, blue_score: 0 },
          resulting_match_state: {},
        },
        update: { id: 'forfeit-1' },
      },
      matches: {
        maybeSingle: {
          locked_at: null,
          status: 'completed',
          red_score: 5,
          blue_score: 2,
          winner_registration_id: 'reg-red',
          end_reason: 'first_to_points',
        },
      },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.voidForfeit('forfeit-1');

    expect(supabase.updated.matches).toContainEqual(
      expect.objectContaining({ status: 'scheduled' }),
    );
  });

  it('re-advances the bracket when the void restores a decided result', async () => {
    // Voiding an override on a match that had been completed BY PLAY restores a
    // finished result with a winner — and nothing re-advanced it. The clear had
    // already emptied the downstream side, and the usual "replay the bout, let
    // completion advance the real winner" flow never runs on this path, so the
    // bracket stalled on a result it already had.
    const supabase = fakeSupabase({
      match_forfeits: {
        maybeSingle: {
          id: 'override-1',
          match_id: 'match-1',
          downstream_match_ids: ['downstream-9'],
          voided_at: null,
          previous_match_state: {
            status: 'completed',
            red_score: 5,
            blue_score: 3,
            winner_registration_id: 'reg-red',
          },
        },
        update: { id: 'override-1' },
      },
      matches: {
        maybeSingle: { locked_at: null },
        select: [{ id: 'downstream-9', status: 'scheduled' }],
      },
    });
    const matchCompletion = { onMatchCompleted: vi.fn(async () => {}) };
    const service = new MatchForfeitsService(
      supabase as never,
      matchCompletion as never,
      undefined as never,
      {
        findDownstreamMatchIds: vi.fn(async () => []),
        clearDownstreamOf: vi.fn(async () => {}),
      } as never,
    );

    await service.voidForfeit('override-1');

    expect(matchCompletion.onMatchCompleted).toHaveBeenCalledWith('match-1');
  });

  it('does not re-advance when the void restores an unfinished bout', async () => {
    // The normal case: the bout goes back to running and will advance its real
    // winner when it is replayed. Re-advancing here would propagate a winner
    // that the restored row no longer names.
    const supabase = fakeSupabase({
      match_forfeits: {
        maybeSingle: {
          id: 'forfeit-1',
          match_id: 'match-1',
          downstream_match_ids: [],
          voided_at: null,
          previous_match_state: { status: 'running', red_score: 2, blue_score: 3 },
        },
        update: { id: 'forfeit-1' },
      },
      matches: { maybeSingle: { locked_at: null } },
    });
    const matchCompletion = { onMatchCompleted: vi.fn(async () => {}) };
    const service = new MatchForfeitsService(supabase as never, matchCompletion as never);

    await service.voidForfeit('forfeit-1');

    expect(matchCompletion.onMatchCompleted).not.toHaveBeenCalled();
  });

  it('restores end_reason when a record is voided', async () => {
    const supabase = fakeSupabase({
      match_forfeits: {
        maybeSingle: {
          id: 'forfeit-1',
          match_id: 'match-1',
          downstream_match_ids: [],
          voided_at: null,
          previous_match_state: {
            status: 'completed',
            red_score: 0,
            blue_score: 0,
            end_reason: 'max_doubles',
          },
        },
        update: { id: 'forfeit-1' },
      },
      matches: { maybeSingle: { locked_at: null } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.voidForfeit('forfeit-1');

    // Without this the bout keeps end_reason 'override' and is exported to
    // HEMA Ratings as a draw instead of a mutual loss.
    expect(supabase.updated.matches?.[0]).toMatchObject({ end_reason: 'max_doubles' });
  });

  it('refuses to void a result inside a frozen event', async () => {
    // Symmetry: a result an actor may not write is one they may not erase.
    const supabase = fakeSupabase({
      match_forfeits: {
        maybeSingle: { id: 'forfeit-1', match_id: 'match-1', voided_at: null },
      },
      matches: { maybeSingle: { locked_at: null } },
    });
    const frozenResults = {
      assertResultMutationAllowed: vi.fn(async () => {
        throw new ConflictException('Event results are frozen');
      }),
    };
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined as never,
      undefined as never,
      frozenResults as never,
    );

    await expect(service.voidForfeit('forfeit-1', { userId: 'user-1' })).rejects.toThrow(
      'Event results are frozen',
    );
    expect(supabase.updated.matches).toBeUndefined();
  });

  it('refuses to void a locked match without the override-locked capability', async () => {
    const supabase = fakeSupabase({
      match_forfeits: {
        maybeSingle: { id: 'forfeit-1', match_id: 'match-1', voided_at: null },
      },
      // Two bouts, one of them locked. The lock is a property of THIS bout, so
      // a read that cannot say which bout it looked at cannot enforce it.
      matches: {
        rows: [
          { id: 'match-1', status: 'completed', locked_at: '2026-08-10T09:00:00.000Z' },
          { id: 'match-2', status: 'completed', locked_at: null },
        ],
      },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await expect(service.voidForfeit('forfeit-1', { staffAccountId: 'staff-1' })).rejects.toThrow(
      'Match is locked',
    );
    expect(supabase.updated.matches).toBeUndefined();
  });

  it('asks the frozen-results guard before rewriting a result', async () => {
    // A completed event freezes its results; every sibling writer asks, and
    // this one did not — so an override could edit around the exchange-edit
    // review that exists to record exactly such a change.
    const supabase = fakeSupabase({
      matches: { maybeSingle: matchRow({ phaseType: 'pool', status: 'completed' }) },
      match_forfeits: { maybeSingle: null },
    });
    const frozenResults = {
      assertResultMutationAllowed: vi.fn(async () => {
        throw new ConflictException('Event results are frozen');
      }),
    };
    const service = new MatchForfeitsService(
      supabase as never,
      undefined as never,
      undefined as never,
      undefined as never,
      frozenResults as never,
    );

    await expect(
      service.createForfeit(
        'match-1',
        {
          forfeitingRegistrationId: 'reg-red',
          reason: 'admin_correction',
          explicitScores: { forfeitingScore: 1, opponentScore: 2 },
        },
        { userId: 'user-1' },
      ),
    ).rejects.toThrow('Event results are frozen');
    expect(frozenResults.assertResultMutationAllowed).toHaveBeenCalledWith('match-1', 'user-1');
    expect(supabase.inserted.match_forfeits).toBeUndefined();
  });
});

/**
 * The pool half of the defect `applyBracketForfeit` already fixed on the
 * bracket side: `downstream_match_ids` means "dependents that must not have
 * started", and a cascade's children are not dependents — they are effects.
 */
describe('MatchForfeitsService — pool cascade void', () => {
  const PARENT_ROW = {
    id: 'forfeit-1',
    match_id: 'match-1',
    parent_forfeit_id: null,
    forfeiting_registration_id: 'reg-red',
    downstream_match_ids: [],
    voided_at: null,
    previous_match_state: { status: 'running', red_score: 2, blue_score: 3 },
    previous_registration_state: { status: 'checked_in' },
  };

  const CHILD_ROW = {
    id: 'child-1',
    match_id: 'later-1',
    parent_forfeit_id: 'forfeit-1',
    voided_at: null,
    previous_match_state: { status: 'scheduled', red_score: 0, blue_score: 0 },
  };

  /**
   * Two records the cascade must not carry down, and both are near misses.
   *
   * The voided child was dealt with separately — whatever was replayed on that
   * bout afterwards is a real result. The other record is a root of its own on
   * another bout, so a lost `parent_forfeit_id` scope would sweep up a
   * withdrawal nobody asked to undo, and stamp this record twice on the way.
   */
  const DECOY_RECORDS = [
    {
      id: 'child-voided',
      match_id: 'later-2',
      parent_forfeit_id: 'forfeit-1',
      voided_at: '2026-08-10T09:00:00.000Z',
      previous_match_state: { status: 'scheduled', red_score: 0, blue_score: 0 },
    },
    {
      id: 'forfeit-9',
      match_id: 'match-9',
      parent_forfeit_id: null,
      voided_at: null,
      previous_match_state: { status: 'scheduled', red_score: 0, blue_score: 0 },
    },
  ];

  /** The bouts those records cover, plus one live bout that belongs to neither. */
  const matchRows = (childMatchStatus: string): SupabaseRow[] => [
    { id: 'match-1', status: 'completed', locked_at: null },
    { id: 'later-1', status: childMatchStatus },
    { id: 'later-2', status: 'scheduled' },
    // Another bout, mid-fight, that this void has nothing to do with.
    { id: 'match-9', status: 'running' },
  ];

  /** Parent + one active child, the shape every cascade test below reads. */
  function cascadeState(childMatchStatus: string, children: SupabaseRow[] = [CHILD_ROW]) {
    return {
      match_forfeits: { rows: [PARENT_ROW, ...children, ...DECOY_RECORDS] },
      matches: { rows: matchRows(childMatchStatus) },
    };
  }

  it('does not record the auto-forfeited pool matches as dependents', async () => {
    // Was: the child MATCH ids went into `downstream_match_ids`, whose one
    // reader is a started-check whose set includes 'completed' — which is
    // exactly what `createAutoForfeit` had just set every one of them to. The
    // guard therefore fired on matches this forfeit itself closed, and
    // `existingRecord` 409s an override on top, so the record could never be
    // undone by any route the product exposes.
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({ phaseType: 'pool', status: 'running' }),
        update: { id: 'match-1' },
        select: [
          {
            id: 'later-1',
            red_registration_id: 'reg-red',
            blue_registration_id: 'reg-green',
            status: 'scheduled',
          },
        ],
      },
      match_forfeits: { maybeSingle: null, insert: { id: 'forfeit-1' } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    const result = await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'injury',
      canContinue: false,
    });

    expect(result.downstream_match_ids).toEqual([]);
    // The cascade still runs — only its bookkeeping moved to parent_forfeit_id,
    // which is how the void reaches the children now.
    expect(supabase.inserted.match_forfeits).toHaveLength(2);
    expect(supabase.inserted.match_forfeits?.[1]).toMatchObject({
      match_id: 'later-1',
      parent_forfeit_id: 'forfeit-1',
      auto_created: true,
    });
    // Never written at all, so the column keeps its '[]' default. Asserted on
    // the COLUMN, not on the table being untouched: both records now get a
    // `resulting_match_state` stamp, so `match_forfeits` is legitimately
    // written — just never with this column.
    expect(
      (supabase.updated.match_forfeits ?? []).some(
        (row) => 'downstream_match_ids' in (row as Record<string, unknown>),
      ),
    ).toBe(false);
  });

  it('voids the sub-forfeits when the parent record is voided', async () => {
    const supabase = fakeSupabase(cascadeState('completed'));
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    const result = await service.voidForfeit('forfeit-1');

    expect(result.cascaded_forfeit_count).toBe(1);
    expect(supabase.updated.match_forfeits).toHaveLength(2);
    // Off the record AND back on the schedule: standings key on voided_at, but
    // the bout itself has to be playable again.
    expect(supabase.updated.matches).toContainEqual(
      expect.objectContaining({ status: 'scheduled', red_score: 0, blue_score: 0 }),
    );
    // And onto the two bouts this record closed, nothing else. An unscoped
    // restore would put every match in the event back to a snapshot.
    expect(writtenIds(supabase, 'matches')).toEqual(['match-1', 'later-1']);
    // The withdrawal is undone too, on the fighter it withdrew and nobody else.
    expect(supabase.updated.registrations?.[0]).toMatchObject({ status: 'checked_in' });
    expect(writtenIds(supabase, 'registrations')).toEqual(['reg-red']);
  });

  it('stamps the children before the parent, so a crash mid-void converges', async () => {
    // Parent-first would leave the children forfeited with no reachable remedy:
    // once the parent is voided, `existingRecord` no longer blocks a fresh
    // record on the parent match, and nothing points at the orphans.
    const supabase = fakeSupabase(cascadeState('completed'));
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.voidForfeit('forfeit-1');

    expect(writtenIds(supabase, 'match_forfeits')).toEqual(['child-1', 'forfeit-1']);
  });

  it('does not rewrite a child match that is back in play', async () => {
    // `POST /matches/:id/reset`, `PATCH /matches/:id/status` and the clock's
    // `reopen` all put an auto-forfeited match back in play while its forfeit
    // row is still active. Restoring the snapshot over a live bout would wipe
    // its score — but the F must not stand for a bout being fought, so the
    // record still voids.
    const supabase = fakeSupabase(cascadeState('running'));
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.voidForfeit('forfeit-1');

    expect(writtenIds(supabase, 'matches')).toEqual(['match-1']); // the parent restore only
    expect(supabase.updated.match_forfeits).toHaveLength(2);
  });

  it('asks for the column its divergence check reads', async () => {
    // Not a style assertion — the projection IS the bug. `cascadeVoidChildren`
    // selected `id, match_id, previous_match_state` and then asked
    // `recordedResultDiverged` for a verdict computed from
    // `resulting_match_state`. Against Postgres that column reads back
    // undefined, the recorded state is `{}`, and the check answers `null` for
    // every child forever: not strict, INERT. Only `liveMatchIds` was left, and
    // it cannot see a child that was reset and re-fought all the way back to
    // 'completed' — that child got its real result overwritten by the snapshot.
    //
    // Asserted on the request rather than on behaviour because this double does
    // not project: it returns the whole fixture row whatever the select said,
    // so dropping the column again changes nothing it can observe.
    const supabase = fakeSupabase(cascadeState('completed'));
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.voidForfeit('forfeit-1');

    const childQuery = supabase.selects.find(
      (query) => query.table === 'match_forfeits' && query.columns.includes('previous_match_state'),
    );
    expect(childQuery?.columns).toContain('resulting_match_state');
  });

  it('leaves a child that was replayed to a finish, and still voids its record', async () => {
    // The case `liveMatchIds` is blind to: reset, re-fought, `completed` again.
    // Not 'running' or 'paused', so it reads as untouched — the divergence
    // check is the only thing between a real replayed score and the snapshot.
    // The bout below says red won it 5-2 on points; the record says a 0-3
    // walkover. Reading the wrong bout would compare the record against
    // somebody else's result and answer either way by accident.
    const state = cascadeState('completed', [
      {
        ...CHILD_ROW,
        resulting_match_state: {
          status: 'completed',
          winner_registration_id: 'reg-green',
          red_score: 0,
          blue_score: 3,
          end_reason: 'forfeit',
        },
      },
    ]);
    const supabase = fakeSupabase({
      ...state,
      matches: {
        rows: matchRows('completed').map((row) =>
          row['id'] === 'later-1'
            ? {
                ...row,
                winner_registration_id: 'reg-red',
                red_score: 5,
                blue_score: 2,
                end_reason: 'first_to_points',
              }
            : row,
        ),
      },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    const result = await service.voidForfeit('forfeit-1');

    // The parent restore only — the child bout keeps whatever it was replayed to.
    expect(writtenIds(supabase, 'matches')).toEqual(['match-1']);
    // But the F must not stand for a bout somebody actually fought.
    expect(result.cascaded_forfeit_count).toBe(1);
    expect(supabase.updated.match_forfeits).toHaveLength(2);
  });

  it('voids a childless record in a single write', async () => {
    // Passes pre-fix — a guard against the cascade double-stamping the parent
    // or fanning out a query per void on the common case.
    const supabase = fakeSupabase(cascadeState('completed', []));
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    const result = await service.voidForfeit('forfeit-1');

    expect(result.cascaded_forfeit_count).toBe(0);
    expect(supabase.updated.match_forfeits).toHaveLength(1);
  });
});

/**
 * Voiding one cascaded bout is already possible — there was never a lock. What
 * was missing is the THREAD: a fresh forfeit written on that reopened bout used
 * to be a root of its own, so voiding the withdrawal that closed the bout in
 * the first place no longer swept it up, and the fighter came back to the
 * standings carrying an F that named a withdrawal nothing pointed at.
 */
describe('MatchForfeitsService — re-recorded forfeit under a live withdrawal', () => {
  /**
   * The withdrawal this bout belongs under: the fighter's own, in this pool,
   * still on record, and one that actually withdrew them.
   *
   * `pool_id` lives on the match, so the lookup reaches it through an `!inner`
   * embed and the row carries it as the flat key the embed spells.
   */
  const LIVE_ROOT = {
    id: 'root-1',
    match_id: 'match-8',
    tournament_id: 'tournament-1',
    forfeiting_registration_id: 'reg-red',
    parent_forfeit_id: null,
    can_continue: false,
    voided_at: null,
    'matches.pool_id': 'pool-1',
    created_at: '2026-08-12T08:00:00.000Z',
  };

  /**
   * One record per scope the lookup applies, each a near miss on everything
   * else. Every one is NEWER than the withdrawal above, so a lost scope adopts
   * it rather than failing quietly: the lookup takes the most recent match.
   */
  const NEAR_MISSES = [
    // Their withdrawal from a different tournament — long over.
    {
      ...LIVE_ROOT,
      id: 'ff-other-tournament',
      match_id: 'match-2',
      tournament_id: 'tournament-2',
      created_at: '2026-08-12T09:00:00.000Z',
    },
    // Somebody else's withdrawal from this same pool.
    {
      ...LIVE_ROOT,
      id: 'ff-other-fighter',
      match_id: 'match-3',
      forfeiting_registration_id: 'reg-blue',
      created_at: '2026-08-12T09:01:00.000Z',
    },
    // A bout the withdrawal closed. It is an effect of the root, not a root —
    // adopting it would build a tree two deep, which the cascade cannot reach.
    {
      ...LIVE_ROOT,
      id: 'ff-child',
      match_id: 'match-4',
      parent_forfeit_id: 'root-1',
      created_at: '2026-08-12T09:02:00.000Z',
    },
    // A one-bout forfeit: the fighter carried on afterwards, so it withdrew
    // nobody and closed nothing else.
    {
      ...LIVE_ROOT,
      id: 'ff-can-continue',
      match_id: 'match-5',
      can_continue: true,
      created_at: '2026-08-12T09:03:00.000Z',
    },
    // A withdrawal the organiser voided. It names a withdrawal that no longer
    // exists, which is why this lookup reads present state and never history.
    {
      ...LIVE_ROOT,
      id: 'ff-voided',
      match_id: 'match-6',
      voided_at: '2026-08-11T09:00:00.000Z',
      created_at: '2026-08-12T09:04:00.000Z',
    },
    // A withdrawal in another pool. The cascade that leaves this gap only
    // reaches the fighter's remaining bouts in ONE pool, so it never closed
    // this bout.
    {
      ...LIVE_ROOT,
      id: 'ff-other-pool',
      match_id: 'match-7',
      'matches.pool_id': 'pool-2',
      created_at: '2026-08-12T09:05:00.000Z',
    },
  ];

  /**
   * A pool state whose seeded `match_forfeits` answers the root lookup.
   *
   * The id the database stamps is derived from the bout, because a cascading
   * forfeit inserts twice in one call and the second write keys on the first
   * record's id.
   */
  function poolStateWithLiveRoot(
    overrides: {
      status?: string;
      laterMatches?: unknown[];
      records?: SupabaseRow[];
    } = {},
  ) {
    return {
      matches: {
        maybeSingle: matchRow({ phaseType: 'pool', status: overrides.status ?? 'running' }),
        update: { id: 'match-2' },
        select: overrides.laterMatches ?? [],
      },
      match_forfeits: {
        rows: overrides.records ?? [LIVE_ROOT, ...NEAR_MISSES],
        returning: (row: SupabaseRow) => ({ id: `ff-${String(row['match_id'])}` }),
      },
      registrations: { maybeSingle: { id: 'reg-red', status: 'withdrawn' } },
    };
  }

  it('hangs a re-recorded pool forfeit off the live root withdrawal', async () => {
    const supabase = fakeSupabase(poolStateWithLiveRoot());
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(supabase.inserted.match_forfeits?.[0]).toMatchObject({
      match_id: 'match-1',
      parent_forfeit_id: 'root-1',
    });
  });

  it('flattens the tree: the re-recorded record cascades under the ROOT, not itself', async () => {
    // Depth 2 is the failure. `cascadeVoidChildren` is ONE query deep, so
    // voiding the root would stamp this record and leave its own children
    // active — an F standing for a fighter who is back in the tournament.
    const supabase = fakeSupabase(
      poolStateWithLiveRoot({
        laterMatches: [
          {
            id: 'later-1',
            red_registration_id: 'reg-red',
            blue_registration_id: 'reg-green',
            status: 'scheduled',
          },
        ],
      }),
    );
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'injury',
      canContinue: false,
    });

    expect(supabase.inserted.match_forfeits).toHaveLength(2);
    expect(supabase.inserted.match_forfeits?.[1]).toMatchObject({
      match_id: 'later-1',
      auto_created: true,
      parent_forfeit_id: 'root-1',
    });
  });

  it('still roots a forfeit when no live withdrawal covers this fighter', async () => {
    // The ordinary case, and where every near miss earns its place: six records
    // sit in the table, each matching on all but one column, and not one of
    // them is a withdrawal this bout belongs under. A lost scope adopts
    // whichever it stopped excluding.
    const supabase = fakeSupabase(poolStateWithLiveRoot({ records: NEAR_MISSES }));
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'voluntary',
      canContinue: true,
    });

    expect(supabase.inserted.match_forfeits?.[0]).toMatchObject({ parent_forfeit_id: null });
  });

  it('never inherits for an OVERRIDE', async () => {
    // An override asserts the bout was fought and the result was X. Attaching
    // it to a withdrawal would let voiding the withdrawal erase a result an
    // organiser stated — the record would vanish with a cascade it never
    // belonged to.
    const supabase = fakeSupabase(poolStateWithLiveRoot({ status: 'completed' }));
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'admin_correction',
      explicitScores: { forfeitingScore: 3, opponentScore: 5 },
    });

    expect(supabase.inserted.match_forfeits?.[0]).toMatchObject({ parent_forfeit_id: null });
  });

  it('never inherits on a bracket match', async () => {
    // The cascade that creates the gap only reaches the fighter's remaining
    // POOL bouts, so a bracket bout was never closed by that withdrawal. The
    // live root is present in this state on purpose: without the pool scope
    // this bout would adopt it.
    const supabase = fakeSupabase({
      matches: {
        maybeSingle: matchRow({ phaseType: 'single_elim', status: 'scheduled' }),
        update: { id: 'match-1' },
      },
      match_forfeits: {
        rows: [LIVE_ROOT],
        returning: { id: 'ff-match-1' },
      },
      bracket_slots: { maybeSingle: null },
      registrations: { maybeSingle: { id: 'reg-red', status: 'checked_in' } },
    });
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    await service.createForfeit('match-1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'injury',
      canContinue: true,
    });

    expect(supabase.inserted.match_forfeits?.[0]).toMatchObject({ parent_forfeit_id: null });
  });
});

/**
 * `getActiveForfeit` is what the organiser's confirm copy branches on, and none
 * of it can be derived on the frontend: the row says a parent EXISTS, never
 * whether that parent is still on record, and nothing on it counts the children
 * a void would carry down.
 */
describe('MatchForfeitsService — cascade context on the read', () => {
  /**
   * Every record one pool holds, seeded so the three reads this describe makes
   * are facts about rows rather than answers a fixture handed back.
   *
   * The reads are "the live record on this bout", "how many live children would
   * a void reopen" and "is the record that withdrew the fighter still standing".
   * Each decoy below exists for one of the scopes that separates them: a VOIDED
   * record on the same bout, a live record on another bout, and a child the
   * organiser had already voided.
   */
  const RECORDS = [
    // The withdrawal, on the bout where the fighter pulled out.
    { id: 'root-1', match_id: 'match-1', parent_forfeit_id: null, voided_at: null },
    // An earlier record on that same bout, voided — the live-record read must
    // not find it.
    {
      id: 'stale-1',
      match_id: 'match-1',
      parent_forfeit_id: null,
      voided_at: '2026-08-09T09:00:00.000Z',
    },
    // The three bouts the withdrawal closed.
    {
      id: 'child-1',
      match_id: 'match-9',
      parent_forfeit_id: 'root-1',
      auto_created: true,
      voided_at: null,
    },
    {
      id: 'child-2',
      match_id: 'match-10',
      parent_forfeit_id: 'root-1',
      auto_created: true,
      voided_at: null,
    },
    {
      id: 'child-3',
      match_id: 'match-11',
      parent_forfeit_id: 'root-1',
      auto_created: true,
      voided_at: null,
    },
    // A child the organiser already put back on the schedule. Off the record,
    // so it is not a bout this void would reopen.
    {
      id: 'child-voided',
      match_id: 'match-12',
      parent_forfeit_id: 'root-1',
      voided_at: '2026-08-10T09:00:00.000Z',
    },
    // Another voided record, on the bout child-1 covers.
    {
      id: 'stale-9',
      match_id: 'match-9',
      parent_forfeit_id: null,
      voided_at: '2026-08-09T09:00:00.000Z',
    },
    // A child still pointing at a withdrawal that was voided and re-recorded.
    // A re-recorded parent is a DIFFERENT row, so this one names a withdrawal
    // that no longer stands.
    { id: 'orphan-1', match_id: 'match-13', parent_forfeit_id: 'stale-9', voided_at: null },
    // A one-bout forfeit that closed nothing else.
    { id: 'solo-1', match_id: 'match-20', parent_forfeit_id: null, voided_at: null },
  ];

  const readState = () => ({ match_forfeits: { rows: RECORDS } });

  it('reports a child, and whether the record that withdrew the fighter still stands', async () => {
    const supabase = fakeSupabase(readState());
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    const active = await service.getActiveForfeit('match-9');

    expect(active).toMatchObject({
      id: 'child-1',
      cascade: { role: 'child', childCount: 0, parentActive: true },
    });
  });

  it('reports a child whose parent has already been voided', async () => {
    const supabase = fakeSupabase(readState());
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    const active = await service.getActiveForfeit('match-13');

    expect(active).toMatchObject({
      id: 'orphan-1',
      cascade: { role: 'child', parentActive: false },
    });
  });

  it('reports a root with the number of bouts its void would reopen', async () => {
    // Three live children and one the organiser already voided. The count is
    // what the confirm copy quotes, so a voided child counted here would
    // promise the organiser a bout back that is already back.
    const supabase = fakeSupabase(readState());
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    const active = await service.getActiveForfeit('match-1');

    expect(active).toMatchObject({
      id: 'root-1',
      cascade: { role: 'root', childCount: 3, parentActive: false },
    });
  });

  it('reports a standalone record when it closed nothing but its own bout', async () => {
    const supabase = fakeSupabase(readState());
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    const active = await service.getActiveForfeit('match-20');

    expect(active).toMatchObject({
      id: 'solo-1',
      cascade: { role: 'standalone', childCount: 0 },
    });
  });

  it('answers null for a bout whose record was voided, without the extra reads', async () => {
    // match-12 carries a record; it is simply not live. Answering with it would
    // render a void button for a bout that is already back on the schedule.
    const supabase = fakeSupabase(readState());
    const service = new MatchForfeitsService(supabase as never, undefined as never);

    expect(await service.getActiveForfeit('match-12')).toBeNull();
    expect(supabase.service.from).toHaveBeenCalledTimes(1);
  });
});
