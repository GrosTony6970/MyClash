/**
 * Two names that slug alike, saved at once: "Lyon Blades" is saved between a create of
 * "Lyon-Blades" reading the Tournament's slugs and inserting. The insert loses the slug
 * (`teams_tournament_slug_key`, 23505); the create reads the slugs again and inserts once more.
 * Split from `teams.service.test.ts` for its line budget.
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  writesTo,
  type ChainResult,
} from '../../common/testing/supabase-chain';
import { TeamsService } from './teams.service';

const T_A = '55555555-5555-4555-8555-555555555555';
const TEAM_COLUMNS = 'id, tournament_id, name, slug, size, seed, color, logo_url';

const slugRace: ChainResult = {
  data: null,
  error: {
    code: '23505',
    message: 'duplicate key value violates unique constraint "teams_tournament_slug_key"',
  } as never,
};

/** `teams` answers in call order: the slugs, the insert, the slugs again, the insert again. */
function setup(teamAnswers: ChainResult[]) {
  const db = mockSupabase({
    tournaments: {
      rows: [{ id: T_A, max_participants: null, team_default_size: 3, entrant_kind: 'team' }],
    },
    teams: teamAnswers,
  });
  return { db, teams: new TeamsService({ service: db.service } as never) };
}

const slugsOfInserts = (db: ReturnType<typeof mockSupabase>) =>
  writesTo(db, 'teams').map((write) => (write.row as { slug: string }).slug);

describe('a create that loses its slug to a team saved meanwhile', () => {
  it('reads the slugs again and inserts once more, with the slug left free', async () => {
    const stored = {
      id: 'new-team',
      tournament_id: T_A,
      name: 'Lyon-Blades',
      slug: 'lyon-blades-2',
      size: 3,
      seed: null,
      color: null,
      logo_url: null,
    };
    const { db, teams } = setup([
      { data: [], error: null },
      slugRace,
      { data: [{ slug: 'lyon-blades' }], error: null },
      { data: stored, error: null },
    ]);
    const team = await teams.create(T_A, { name: 'Lyon-Blades' });
    expect(slugsOfInserts(db)).toEqual(['lyon-blades', 'lyon-blades-2']);
    expect(team).toMatchObject({ id: 'new-team', slug: 'lyon-blades-2' });
    expect(selectsFor(db.from, 'teams')).toEqual(['slug', TEAM_COLUMNS, 'slug', TEAM_COLUMNS]);
  });

  it('tries once only: a slug lost twice is a 400 with its text', async () => {
    const { db, teams } = setup([
      { data: [], error: null },
      slugRace,
      { data: [], error: null },
      slugRace,
    ]);
    await expect(teams.create(T_A, { name: 'Lyon-Blades' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(writesTo(db, 'teams')).toHaveLength(2);
  });
});
