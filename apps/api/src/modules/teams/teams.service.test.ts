/**
 * The teams of a team Tournament: what each write sends, and each refusal.
 *
 * The story: "Team Longsword" (Tournament A) holds Lyon Blades. Club B's "Team Sabre"
 * (Tournament B) holds Paris Sabres. The controller checks the caller on the Tournament of the
 * URL only, so a request for Tournament A that names Paris Sabres' id must find no team: the
 * cross-Tournament cases read simulated tables (`{ rows }`), which apply the `.eq` filters, so they
 * go red without the Tournament filter.
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  scopedTo,
  selectsFor,
  writesTo,
  type ChainResult,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { TeamsService } from './teams.service';

const T_A = '55555555-5555-4555-8555-555555555555';
const T_B = '66666666-6666-4666-8666-666666666666';
const LYON = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PARIS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEAM_COLUMNS = 'id, tournament_id, name, slug, size, seed, color, logo_url';

const lyon = {
  id: LYON,
  tournament_id: T_A,
  name: 'Lyon Blades',
  slug: 'lyon-blades',
  size: 3,
  seed: 1,
  color: 'red',
  logo_url: null,
};
const paris = { ...lyon, id: PARIS, tournament_id: T_B, name: 'Paris Sabres', slug: 'paris' };

const tournaments = {
  rows: [
    { id: T_A, max_participants: null, team_default_size: 3, entrant_kind: 'team' },
    { id: T_B, max_participants: null, team_default_size: 5, entrant_kind: 'team' },
  ],
};

/** A bout of `team` as red, in `status`. */
const bout = (team: string, status: string) => ({
  id: `m-${status}`,
  red_team_id: team,
  blue_team_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  status,
});

function storageDouble() {
  const upload = vi.fn(async () => ({ error: null }));
  const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: `https://cdn/${path}` } }));
  return {
    upload,
    storage: {
      getBucket: vi.fn(async () => ({ data: { id: 'event-assets' }, error: null })),
      createBucket: vi.fn(),
      from: vi.fn(() => ({ upload, getPublicUrl })),
    },
  };
}

function setup(seeds: Record<string, TableSeed> = {}) {
  const db = mockSupabase({
    tournaments,
    teams: { rows: [paris, lyon] },
    matches: { rows: [] },
    bracket_slots: { rows: [] },
    ...seeds,
  });
  const files = storageDouble();
  const supabase = { service: { ...db.service, storage: files.storage } };
  return { db, files, teams: new TeamsService(supabase as never) };
}

async function refusalOf(promise: Promise<unknown>, kind: new (...args: never[]) => Error) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(kind);
  return (error as ConflictException).getResponse();
}

const PNG = { buffer: Buffer.from([1, 2, 3]), filename: 'Lyon Logo.PNG', mimetype: 'image/png' };

describe('list', () => {
  it("answers the Tournament's own teams, by seed then name, in the screen's shape", async () => {
    const { db, teams } = setup();
    expect(await teams.list(T_A)).toEqual([
      {
        id: LYON,
        tournamentId: T_A,
        name: 'Lyon Blades',
        slug: 'lyon-blades',
        size: 3,
        seed: 1,
        color: 'red',
        logoUrl: null,
      },
    ]);
    expect(selectsFor(db.from, 'teams')).toEqual([TEAM_COLUMNS]);
  });

  it('puts the seeded teams first, then the rest by name', async () => {
    const unseeded = (id: string, name: string) => ({ ...lyon, id, name, seed: null });
    const { teams } = setup({
      teams: {
        rows: [unseeded('z', 'Zurich'), unseeded('a', 'Annecy'), { ...lyon, seed: 2 }, paris],
      },
    });
    expect((await teams.list(T_A)).map((team) => team.name)).toEqual([
      'Lyon Blades',
      'Annecy',
      'Zurich',
    ]);
  });
});

describe('create', () => {
  it('writes the slug from the name and the size of the Tournament', async () => {
    const { db, teams } = setup({
      teams: { rows: [lyon], returning: { id: 'new-team', logo_url: null } },
    });
    const team = await teams.create(T_A, { name: 'Lyon Blades', color: 'amber' });
    expect(writesTo(db, 'teams')[0]?.row).toEqual({
      tournament_id: T_A,
      name: 'Lyon Blades',
      slug: 'lyon-blades-2',
      size: 3,
      color: 'amber',
      seed: null,
    });
    expect(team).toMatchObject({ id: 'new-team', slug: 'lyon-blades-2', size: 3 });
    expect(selectsFor(db.from, 'tournaments')).toEqual([
      'max_participants, team_default_size, entrant_kind',
    ]);
    expect(selectsFor(db.from, 'teams')).toEqual(['slug', TEAM_COLUMNS]);
  });

  it('falls back to team-N for a name that slugs to one character, and takes the size sent', async () => {
    const { db, teams } = setup({ teams: { rows: [lyon], returning: { id: 'new-team' } } });
    await teams.create(T_A, { name: 'A', size: 2, seed: 4 });
    expect(writesTo(db, 'teams')[0]?.row).toMatchObject({ slug: 'team-1', size: 2, seed: 4 });
  });

  it('counts only its own Tournament against the cap', async () => {
    const { db, teams } = setup({
      tournaments: { rows: [{ ...tournaments.rows[0], max_participants: 2 }] },
      teams: { rows: [lyon, paris, { ...paris, id: 'p2', slug: 'p2' }], returning: { id: 'n' } },
    });
    await teams.create(T_A, { name: 'Grenoble' });
    expect(writesTo(db, 'teams')).toHaveLength(1);
  });

  it('refuses 409 tournament_full once the Tournament holds max_participants teams', async () => {
    const { db, teams } = setup({
      tournaments: { rows: [{ ...tournaments.rows[0], max_participants: 1 }] },
    });
    expect(await refusalOf(teams.create(T_A, { name: 'Grenoble' }), ConflictException)).toEqual({
      reason: 'tournament_full',
      message: 'This Tournament has its maximum number of teams.',
      teamCount: 1,
      maxParticipants: 1,
    });
    expect(writesTo(db, 'teams')).toEqual([]);
  });

  it('refuses 400 when no size is sent and the Tournament has no default', async () => {
    const { db, teams } = setup({
      tournaments: { rows: [{ ...tournaments.rows[0], team_default_size: null }] },
    });
    expect(
      await refusalOf(teams.create(T_A, { name: 'Grenoble' }), BadRequestException),
    ).toMatchObject({ code: 'team_size_required' });
    expect(writesTo(db, 'teams')).toEqual([]);
  });

  // An individual Tournament has no team size either: the kind is the cause, said first.
  it('refuses an individual Tournament as 409 entrant_kind_mismatch before its missing size', async () => {
    const individual = { id: T_A, max_participants: null, team_default_size: null };
    const { db, teams } = setup({
      tournaments: { rows: [{ ...individual, entrant_kind: 'individual' }] },
    });
    expect(await refusalOf(teams.create(T_A, { name: 'Grenoble' }), ConflictException)).toEqual({
      reason: 'entrant_kind_mismatch',
      message:
        'This Tournament takes the other kind of entrant: a team Tournament takes teams, an individual one takes Fighters.',
    });
    expect(writesTo(db, 'teams')).toEqual([]);
  });

  it('refuses a Tournament read without its kind, not as an individual one', async () => {
    const { teams } = setup({
      tournaments: { rows: [{ id: T_A, max_participants: null, team_default_size: 3 }] },
    });
    await expect(teams.create(T_A, { name: 'Grenoble' })).rejects.toThrow(
      "The Tournament's kind was not read",
    );
  });

  it('answers a name taken in the Tournament as 409 team_name_taken', async () => {
    const taken: ChainResult = {
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "teams_tournament_name_key"',
      } as never,
    };
    const { db, teams } = setup({ teams: [{ data: [], error: null }, taken] });
    expect(
      await refusalOf(teams.create(T_A, { name: 'lyon blades' }), ConflictException),
    ).toMatchObject({ reason: 'team_name_taken' });
    // A name taken is not a slug lost: no second try.
    expect(writesTo(db, 'teams')).toHaveLength(1);
  });

  // A slug lost to a team saved at the same moment: `teams.slug-race.test.ts`.

  it('answers an individual Tournament as 409 entrant_kind_mismatch (the kind trigger)', async () => {
    const refused: ChainResult = {
      data: null,
      error: {
        code: '23514',
        message: 'entrant_kind_holds: a individual Tournament holds no teams row',
      } as never,
    };
    const { teams } = setup({ teams: [{ data: [], error: null }, refused] });
    expect(
      await refusalOf(teams.create(T_A, { name: 'Lyon', size: 3 }), ConflictException),
    ).toMatchObject({ reason: 'entrant_kind_mismatch' });
  });
});

describe('update', () => {
  it('saves the fields sent, a null logo included, scoped to the team and its Tournament', async () => {
    const { db, teams } = setup();
    await teams.update(T_A, LYON, { name: 'Lyon Blades II', seed: null, logoUrl: null });
    const [write] = writesTo(db, 'teams');
    expect(write?.row).toEqual({
      name: 'Lyon Blades II',
      seed: null,
      logo_url: null,
      updated_at: expect.any(String),
    });
    expect(scopedTo(write, 'id')).toBe(LYON);
    expect(scopedTo(write, 'tournament_id')).toBe(T_A);
    expect(selectsFor(db.from, 'teams')).toEqual([TEAM_COLUMNS, TEAM_COLUMNS]);
  });

  it("answers 404 for another Tournament's team, and writes nothing", async () => {
    const { db, teams } = setup();
    await refusalOf(teams.update(T_A, PARIS, { name: 'Taken over' }), NotFoundException);
    expect(writesTo(db, 'teams')).toEqual([]);
  });

  it('refuses 409 team_size_locked when a bout of the team has started', async () => {
    for (const status of ['running', 'paused', 'completed']) {
      const { db, teams } = setup({ matches: { rows: [bout(LYON, status)] } });
      expect(
        await refusalOf(teams.update(T_A, LYON, { size: 4 }), ConflictException),
        status,
      ).toMatchObject({ reason: 'team_size_locked' });
      expect(writesTo(db, 'teams')).toEqual([]);
      expect(selectsFor(db.from, 'matches')).toEqual(['id']);
    }
  });

  it('reads the team as blue too', async () => {
    const blue = { ...bout('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'running'), blue_team_id: LYON };
    const { teams } = setup({ matches: { rows: [blue] } });
    await refusalOf(teams.update(T_A, LYON, { size: 4 }), ConflictException);
  });

  it('changes the size while its bouts are scheduled or voided, or another team has started', async () => {
    const { db, teams } = setup({
      matches: {
        rows: [bout(LYON, 'scheduled'), bout(LYON, 'voided'), bout(PARIS, 'running')],
      },
    });
    await teams.update(T_A, LYON, { size: 4 });
    expect(writesTo(db, 'teams')[0]?.row).toMatchObject({ size: 4 });
  });

  it('reads no bout when the size sent is the size it has', async () => {
    const { db, teams } = setup({ matches: { rows: [bout(LYON, 'running')] } });
    await teams.update(T_A, LYON, { size: 3, color: null });
    expect(selectsFor(db.from, 'matches')).toEqual([]);
    expect(writesTo(db, 'teams')[0]?.row).toMatchObject({ size: 3, color: null });
  });

  it('answers a rename onto a name taken as 409 team_name_taken', async () => {
    const taken: ChainResult = {
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "teams_tournament_name_key"',
      } as never,
    };
    const { teams } = setup({ teams: [{ data: lyon, error: null }, taken] });
    expect(
      await refusalOf(teams.update(T_A, LYON, { name: 'Grenoble' }), ConflictException),
    ).toMatchObject({ reason: 'team_name_taken' });
  });
});

describe('remove', () => {
  it('deletes the team, scoped to its Tournament', async () => {
    const { db, teams } = setup();
    await teams.remove(T_A, LYON);
    const [write] = writesTo(db, 'teams');
    expect(write?.op).toBe('delete');
    expect(scopedTo(write, 'id')).toBe(LYON);
    expect(scopedTo(write, 'tournament_id')).toBe(T_A);
  });

  it("answers 404 for another Tournament's team, and deletes nothing", async () => {
    const { db, teams } = setup();
    await refusalOf(teams.remove(T_A, PARIS), NotFoundException);
    expect(writesTo(db, 'teams')).toEqual([]);
  });

  it('refuses 409 team_in_bouts while any bout names it, a scheduled one included', async () => {
    for (const named of [
      bout(LYON, 'scheduled'),
      { ...bout(PARIS, 'voided'), blue_team_id: LYON },
    ]) {
      const { db, teams } = setup({ matches: { rows: [named] } });
      expect(await refusalOf(teams.remove(T_A, LYON), ConflictException)).toMatchObject({
        reason: 'team_in_bouts',
      });
      expect(writesTo(db, 'teams')).toEqual([]);
      expect(selectsFor(db.from, 'matches')).toEqual(['id']);
    }
  });

  it('answers the key checked at commit (23503) with the same 409', async () => {
    const atCommit: ChainResult = {
      data: null,
      error: {
        code: '23503',
        message:
          'update or delete on table "teams" violates foreign key constraint "matches_red_team_id_fkey" on table "matches"',
      } as never,
    };
    const { teams } = setup({ teams: [{ data: lyon, error: null }, atCommit] });
    expect(await refusalOf(teams.remove(T_A, LYON), ConflictException)).toMatchObject({
      reason: 'team_in_bouts',
    });
  });
});

describe('uploadLogo', () => {
  it('stores the file under teams/{id}/ and writes its link onto the team', async () => {
    const { db, files, teams } = setup();
    const { url } = await teams.uploadLogo(T_A, LYON, PNG);
    expect(url).toMatch(new RegExp(`^https://cdn/teams/${LYON}/logo-\\d+-lyon-logo\\.png$`));
    expect(files.upload).toHaveBeenCalledWith(url.replace('https://cdn/', ''), PNG.buffer, {
      contentType: 'image/png',
      upsert: true,
    });
    const [write] = writesTo(db, 'teams');
    expect(write?.row).toEqual({ logo_url: url, updated_at: expect.any(String) });
    expect(scopedTo(write, 'id')).toBe(LYON);
    expect(scopedTo(write, 'tournament_id')).toBe(T_A);
    expect(selectsFor(db.from, 'teams')).toEqual([TEAM_COLUMNS, 'id']);
  });

  it("answers 404 for another Tournament's team, and stores nothing", async () => {
    const { db, files, teams } = setup();
    await refusalOf(teams.uploadLogo(T_A, PARIS, PNG), NotFoundException);
    expect(files.upload).not.toHaveBeenCalled();
    expect(writesTo(db, 'teams')).toEqual([]);
  });

  it('refuses a file that is not PNG, JPEG or WebP', async () => {
    const { db, files, teams } = setup();
    const svg = { ...PNG, filename: 'logo.svg', mimetype: 'image/svg+xml' };
    expect(await refusalOf(teams.uploadLogo(T_A, LYON, svg), BadRequestException)).toMatchObject({
      message: 'Logo upload must be a PNG, JPEG, or WebP image.',
    });
    expect(files.upload).not.toHaveBeenCalled();
    expect(writesTo(db, 'teams')).toEqual([]);
  });

  it('refuses no file', async () => {
    const { files, teams } = setup();
    await refusalOf(
      teams.uploadLogo(T_A, LYON, { buffer: Buffer.alloc(0), filename: '', mimetype: '' }),
      BadRequestException,
    );
    expect(files.upload).not.toHaveBeenCalled();
  });
});
