/**
 * A referee's career stats count only bouts of public Tournaments of public Events (ruling 163, the
 * bar of 129): Anna refereed a completed bout in the Spring Open's public Longsword, one in its
 * draft Longsword Secret, and one in the draft Autumn Cup. Her public referee stats — and her own,
 * read by the same function — count the first alone, as if the others did not exist. A row read
 * without a Tournament or Event status counts as hidden: it fails closed.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { FightersService } from './fighters.service';

const SPRING = { id: 'e-spring', name: 'Spring Open', event_kind: 'standard', status: 'published' };
const AUTUMN = { id: 'e-autumn', name: 'Autumn Cup', event_kind: 'standard', status: 'draft' };

// A completed bout she refereed, embedded as the stats read asks for it.
const duty = (matchId: string, tournamentStatus: string, event: object) => ({
  match_id: matchId,
  person_id: 'gp-anna',
  role: 'arbitre_declarant',
  scope_type: 'match',
  matches: {
    id: matchId,
    status: 'completed',
    scheduled_at: null,
    pool_id: null,
    bracket_slot_id: null,
    pools: null,
    bracket_slots: null,
    phases: {
      type: 'pool',
      config_json: null,
      tournaments: {
        id: `t-${matchId}`,
        name: 'Longsword',
        weapon: 'longsword',
        scoring_config_json: null,
        status: tournamentStatus,
        events: event,
      },
    },
  },
});

const OPEN = duty('m-open', 'published', SPRING);
const DUTIES = [OPEN, duty('m-secret', 'draft', SPRING), duty('m-autumn', 'published', AUTUMN)];

function tables(duties: object[]): Record<string, TableSeed> {
  return {
    // Made by a super admin: her page stands on its own, so no roster row is read.
    global_persons: { rows: [{ id: 'gp-anna', slug: 'anna', made_outside_roster: true }] },
    referee_assignments: { rows: duties as never },
    matches: {
      rows: DUTIES.map((d) => ({ id: d.match_id, duration_active_ms: 60_000, match_events: [] })),
    },
    match_penalties: { rows: [] },
  };
}

let db: ReturnType<typeof mockSupabase>;
const stats = () => new FightersService(db as never, {} as never).getRefereeStatsBySlug('anna');

beforeEach(() => {
  db = mockSupabase(tables(DUTIES));
});

describe("a referee's stats count only public bouts (ruling 163)", () => {
  it('counts her public bout alone', async () => {
    expect(await stats()).toMatchObject({ totalMatches: 1, eventsWorked: 1 });
  });

  it('answers exactly as if the hidden bouts did not exist', async () => {
    const shown = await stats();
    db = mockSupabase(tables([OPEN]));
    expect(await stats()).toEqual(shown);
  });

  it("reads each bout's Tournament and Event status, and asks nothing more of a hidden bout", async () => {
    await stats();
    const embed =
      'tournaments(id, name, weapon, scoring_config_json, status, events(id, name, event_kind, status))';
    const selects = selectsFor(db.from, 'referee_assignments');
    expect(selects).toHaveLength(2);
    for (const select of selects) expect(select).toContain(embed);
    expect(filtersFor(db.from, 'matches', 'in')).toEqual([['id', ['m-open']]]);
  });

  it('counts a bout read without its statuses as hidden: it fails closed', async () => {
    const tournament = OPEN.matches.phases.tournaments;
    const unread = {
      ...OPEN,
      matches: {
        ...OPEN.matches,
        phases: {
          ...OPEN.matches.phases,
          tournaments: {
            ...tournament,
            status: undefined,
            events: { ...SPRING, status: undefined },
          },
        },
      },
    };
    db = mockSupabase(tables([unread]));
    expect(await stats()).toMatchObject({ totalMatches: 0 });
  });
});
