import { describe, expect, it } from 'vitest';
import { StaffService } from './staff.service';
import { mockSupabase, selectsFor, type SupabaseRow } from '../../common/testing/supabase-chain';

/**
 * The two public bout reads: the spectator display payload, and the prev/next
 * tiles on the scoring pad. Neither takes a session.
 *
 * The original bug: the SELECT string requested a column named
 * `ruleset_config_json` from `tournaments`, but the canonical column
 * (see `packages/db/src/schema/tournaments.ts`) is `ruleset_config`.
 * The PostgREST gateway returned `400 column tournaments_2.ruleset_config_json
 * does not exist`, surfacing as "Could not load scoreboard data (400)"
 * when a referee clicked into a pool match.
 *
 * Every fixture here is ONE seeded `matches` table rather than a chain that
 * answers by call order. `getPublicMatchDisplay` reads `matches` three times —
 * the bout, its pool siblings, the next bout on the piste — and a call-counting
 * double pins the fixture to the order those reads happen to fire in, so adding
 * a query anywhere upstream hands every later read someone else's answer while
 * the suite stays green. Seeding the table instead makes the three reads narrow
 * the same rows, which is both what the database does and what lets each
 * `.eq()` in the service decide something.
 *
 * Decoys are seeded FIRST throughout: the single-row reads end in `maybeSingle`,
 * which takes the first surviving row, so a decoy behind the wanted one could
 * never come back and would guard nothing.
 */

const LICE = 'lice-1';
const OTHER_LICE = 'lice-2';
const POOL = 'pool-1';
const OTHER_POOL = 'pool-2';

/** Distinct instants, so `scheduled_at` decides an order instead of tying. */
const at = (hour: number) => `2026-05-05T${String(hour).padStart(2, '0')}:00:00.000Z`;

function serviceOn(rows: readonly SupabaseRow[]) {
  const supabase = mockSupabase({ matches: { rows } });
  const service = new StaffService(supabase as never, {} as never, {} as never, {} as never);
  return { service, from: supabase.from };
}

/** One side of a bout, with the embeds the display payload reads. */
function side(
  registrationId: string,
  given: string,
  extra: { club?: { name: string; logo_url: string | null }; photo?: string } = {},
) {
  return {
    id: registrationId,
    persons: {
      id: `p-${registrationId}`,
      given_name: given,
      family_name: 'X',
      club_id: extra.club ? 'club-lyon' : null,
      clubs: extra.club ?? null,
      global_persons: extra.photo ? { photo_url: extra.photo } : null,
    },
  };
}

/** A bout in the shape `mapDisplayMatch` unwraps. */
function displayRow(id: string, overrides: SupabaseRow = {}): SupabaseRow {
  return {
    id,
    status: 'scheduled',
    red_score: 0,
    blue_score: 0,
    red_registration_id: 'reg-r',
    blue_registration_id: 'reg-b',
    match_number_label: '1',
    pool_id: null,
    lice_id: null,
    scheduled_at: null,
    lices: { id: LICE, name: 'Lice 1', events: null },
    pools: null,
    red: side('reg-r', 'A'),
    blue: side('reg-b', 'B'),
    phases: {
      tournaments: {
        id: 't-1',
        name: 'Longsword Open',
        weapon: 'longsword',
        scoring_config_json: null,
        ruleset_config: null,
      },
    },
    bracket_slots: null,
    ...overrides,
  };
}

describe('StaffService.getPublicMatchDisplay', () => {
  const MATCH_FORMAT = { pointCap: 5, doublePenalty: 'none' };

  const CANONICAL_ROWS: SupabaseRow[] = [
    // Answers a lost `.eq('id', …)`, and carries no ruleset_config, so the
    // payload assertion below names the bout that was actually asked for.
    displayRow('match-elsewhere'),
    displayRow('match-1', {
      status: 'pending',
      pools: { sort_order: 0 },
      phases: {
        tournaments: {
          id: 't-1',
          name: 'Open Longsword',
          weapon: 'longsword',
          scoring_config_json: { foo: 'bar' },
          ruleset_config: { matchFormat: MATCH_FORMAT },
        },
      },
    }),
  ];

  it('fetches matchFormat from the canonical ruleset_config column and exposes it on the payload', async () => {
    const { service, from } = serviceOn(CANONICAL_ROWS);

    const payload = (await service.getPublicMatchDisplay('match-1')) as { matchFormat: unknown };

    // Behaviour 1: the request asked for the real column name.
    const asked = selectsFor(from, 'matches').join(' ');
    expect(asked).not.toMatch(/ruleset_config_json/);
    expect(asked).toMatch(/ruleset_config/);
    // Behaviour 2: the payload surfaces the matchFormat the caller will read.
    expect(payload.matchFormat).toEqual(MATCH_FORMAT);
  });

  // External-display redesign: the payload now needs to expose the
  // pool name, fighter position within the pool (Fight 3 / 15), and
  // per-fighter club name + logo so the spectator display can render
  // the redesigned header without a follow-up call.
  describe('display redesign payload extensions', () => {
    /** A pool sibling. Only its id and label are read, to count and place. */
    const sibling = (id: string, poolId: string, label: string): SupabaseRow =>
      displayRow(id, { pool_id: poolId, match_number_label: label });

    /** Every bout of a six-fighter pool except the one under test. */
    const REST_OF_POOL = [
      '01',
      '02',
      '04',
      '05',
      '06',
      '07',
      '08',
      '09',
      '10',
      '11',
      '12',
      '13',
      '14',
      '15',
    ];

    it('returns poolName + fightIndex + totalFightsInPool, and resolves club info per side', async () => {
      // A pool of six fighters is fifteen bouts, so the label carries its zero
      // (L1-PA-M03). That is the whole reason the zero exists: siblings are
      // ordered by `match_number_label` in SQL and Postgres sorts it as TEXT,
      // so an unpadded M10 would land ahead of M2 and this bout would report
      // itself as Fight 10 of 15 rather than Fight 3.
      const rows: SupabaseRow[] = [
        sibling('other-pool-1', OTHER_POOL, 'L1-PB-M01'),
        sibling('other-pool-2', OTHER_POOL, 'L1-PB-M02'),
        displayRow('match-3', {
          status: 'running',
          red_score: 4,
          blue_score: 2,
          match_number_label: 'L1-PA-M03',
          pool_id: POOL,
          lice_id: LICE,
          pools: { id: POOL, name: 'Pool A', sort_order: 0 },
          red: side('reg-r', 'Anthony', {
            club: { name: 'Lyon AMHE', logo_url: 'https://cdn.example/lyon.png' },
            // Photo lives on the linked global identity, not the local person.
            photo: 'https://cdn.example/anthony.jpg',
          }),
          // persons.club_id is populated eagerly by createPerson() and
          // applyGlobalPersonDecision() — no global_persons fallback needed
          // (matches 0081's view simplification). No linked global identity
          // here, so no photo, so the TV falls back to initials.
          blue: side('reg-b', 'Aleksandr', { club: { name: 'Lyon AMHE', logo_url: null } }),
        }),
        ...REST_OF_POOL.map((seq) => sibling(`match-${seq}`, POOL, `L1-PA-M${seq}`)),
      ];
      const { service } = serviceOn(rows);

      const payload = (await service.getPublicMatchDisplay('match-3')) as Record<string, unknown>;

      expect(payload['poolName']).toBe('Pool A');
      expect(payload['fightIndex']).toBe(3);
      expect(payload['totalFightsInPool']).toBe(15);
      expect(payload['redClub']).toEqual({
        name: 'Lyon AMHE',
        logoUrl: 'https://cdn.example/lyon.png',
      });
      expect(payload['blueClub']).toEqual({
        name: 'Lyon AMHE',
        logoUrl: null,
      });
      // Fighter photos resolve from the linked global identity; null when unlinked.
      expect(payload['redFighterPhotoUrl']).toBe('https://cdn.example/anthony.jpg');
      expect(payload['blueFighterPhotoUrl']).toBeNull();
      // Pool matches carry poolName, not a round token.
      expect(payload['roundToken']).toBeNull();
    });

    it('returns null pool fields for bracket matches (no pool_id)', async () => {
      const rows = [
        displayRow('pool-decoy', { pool_id: POOL, pools: { id: POOL, name: 'Pool A' } }),
        // Bracket round 4 with no known bracket size → token 'B4' for the TV
        // context line (poolName is null here, so the round takes its slot).
        displayRow('bracket-1', { bracket_slots: { round: 4 } }),
      ];
      const { service } = serviceOn(rows);

      const payload = (await service.getPublicMatchDisplay('bracket-1')) as Record<string, unknown>;

      expect(payload['poolName']).toBeNull();
      expect(payload['fightIndex']).toBeNull();
      expect(payload['totalFightsInPool']).toBeNull();
      expect(payload['redClub']).toBeNull();
      expect(payload['blueClub']).toBeNull();
      expect(payload['roundToken']).toBe('B4');
      expect(payload['redFighterPhotoUrl']).toBeNull();
      expect(payload['blueFighterPhotoUrl']).toBeNull();
    });

    it('names a Swiss round, which has neither a pool nor a bracket slot', async () => {
      // Regression: both slots were null, so the TV context line read
      // "Longsword Open · Lice 1" — a Swiss bout named no phase at all.
      const { service } = serviceOn([
        displayRow('swiss-decoy', { swiss_rounds: { round_number: 9 } }),
        displayRow('swiss-1', { swiss_rounds: { round_number: 3 } }),
      ]);

      const payload = (await service.getPublicMatchDisplay('swiss-1')) as Record<string, unknown>;

      expect(payload['poolName']).toBeNull();
      expect(payload['roundToken']).toBe('S3');
    });

    it('distinguishes the three double-elim rounds a single-elim label calls F', async () => {
      // Regression: this read bracketRoundLabel() without wbRounds/lbRounds —
      // already in scope and passed to the round CODE one line below — so the
      // winners final, grand final and grand final reset all displayed as 'F'.
      const tokenForRound = async (round: number) => {
        const base = displayRow('de-1', { bracket_slots: { round } });
        const rows = [
          displayRow('de-decoy', { bracket_slots: { round: 1 } }),
          {
            ...base,
            phases: {
              ...(base['phases'] as Record<string, unknown>),
              config_json: { bracketSize: 8, wbRounds: 3, lbRounds: 4 },
            },
          },
        ];
        const { service } = serviceOn(rows);
        const payload = (await service.getPublicMatchDisplay('de-1')) as Record<string, unknown>;
        return payload['roundToken'];
      };

      expect(await tokenForRound(3)).toBe('WBF');
      expect(await tokenForRound(8)).toBe('GF');
      expect(await tokenForRound(9)).toBe('GFR');
    });
  });

  /**
   * The TV's auto-rollover reads this: five seconds after MATCH ENDED it
   * navigates to `nextMatchId`. Picking the wrong bout sends every spectator
   * screen in the hall to a bout that is not being fought.
   *
   * The query ranks by `status` BEFORE time, so the decoys below differ from
   * the wanted bout on exactly one axis each — one is on another piste, one is
   * already fought — and both are timed to sort ahead of it.
   */
  describe('the next bout on the same piste', () => {
    const NEXT_ROWS: SupabaseRow[] = [
      displayRow('already-fought', { lice_id: LICE, status: 'completed', scheduled_at: at(8) }),
      displayRow('other-piste', { lice_id: OTHER_LICE, status: 'scheduled', scheduled_at: at(8) }),
      displayRow('current', { lice_id: LICE, status: 'running', scheduled_at: at(9) }),
      displayRow('up-next', { lice_id: LICE, status: 'scheduled', scheduled_at: at(10) }),
    ];

    it('names the next bout on this piste, skipping the one being fought', async () => {
      const { service } = serviceOn(NEXT_ROWS);

      const payload = (await service.getPublicMatchDisplay('current')) as Record<string, unknown>;

      expect(payload['id']).toBe('current');
      expect(payload['nextMatchId']).toBe('up-next');
      expect((payload['nextMatch'] as { id: string }).id).toBe('up-next');
    });

    it('reports no next bout when this is the last one on the piste', async () => {
      const { service } = serviceOn([
        displayRow('other-piste', {
          lice_id: OTHER_LICE,
          status: 'scheduled',
          scheduled_at: at(8),
        }),
        displayRow('last', { lice_id: LICE, status: 'running', scheduled_at: at(9) }),
      ]);

      const payload = (await service.getPublicMatchDisplay('last')) as Record<string, unknown>;

      expect(payload['nextMatchId']).toBeNull();
      expect(payload['nextMatch']).toBeNull();
    });

    it('reports no next bout for a match that is on no piste at all', async () => {
      const { service } = serviceOn([displayRow('unplaced', { lice_id: null })]);

      const payload = (await service.getPublicMatchDisplay('unplaced')) as Record<string, unknown>;

      expect(payload['nextMatchId']).toBeNull();
    });
  });
});

// The scoring pad's prev/next tiles read from this public endpoint (the
// staff lice-queue endpoint 401s for admin sessions). It returns the
// immediate predecessor + successor of a match along its lice's
// schedule-ordered, non-voided match list.
describe('StaffService.getMatchNeighbors', () => {
  const neighbour = (id: string, overrides: SupabaseRow = {}): SupabaseRow => ({
    id,
    lice_id: LICE,
    status: 'scheduled',
    scheduled_at: at(12),
    match_number_label: id,
    red: { persons: { given_name: 'Red', family_name: id } },
    blue: { persons: { given_name: 'Blue', family_name: id } },
    phases: { config_json: null, tournaments: { weapon: 'longsword' } },
    pools: { sort_order: 0 },
    bracket_slots: null,
    ...overrides,
  });

  /**
   * Three bouts on this piste, and three rows that must stay out of the list.
   * `no-piste` also answers the current-match read if its `.eq('id', …)` is
   * lost; the other two are timed at 11:00, between m1 and m2, so whichever
   * filter stops reaching them takes that neighbour slot instead.
   */
  const ROWS: SupabaseRow[] = [
    neighbour('no-piste', { lice_id: null, scheduled_at: at(9) }),
    neighbour('voided-between', { status: 'voided', scheduled_at: at(11) }),
    neighbour('other-piste', { lice_id: OTHER_LICE, scheduled_at: at(11) }),
    neighbour('m1', { scheduled_at: at(10) }),
    neighbour('m2', { scheduled_at: at(12) }),
    neighbour('m3', { scheduled_at: at(14) }),
  ];

  it('returns the immediate previous + next match on the same lice', async () => {
    const { service } = serviceOn(ROWS);

    const result = (await service.getMatchNeighbors('m2')) as {
      previous: { id: string } | null;
      next: { id: string } | null;
    };

    expect(result.previous?.id).toBe('m1');
    expect(result.next?.id).toBe('m3');
  });

  it('returns null at the open ends (first match has no previous)', async () => {
    const { service } = serviceOn(ROWS);

    const result = (await service.getMatchNeighbors('m1')) as {
      previous: { id: string } | null;
      next: { id: string } | null;
    };

    expect(result.previous).toBeNull();
    expect(result.next?.id).toBe('m2');
  });

  it('returns both null when the match has no lice', async () => {
    const { service } = serviceOn(ROWS);

    const result = (await service.getMatchNeighbors('no-piste')) as {
      previous: unknown;
      next: unknown;
    };

    expect(result.previous).toBeNull();
    expect(result.next).toBeNull();
  });
});
