/**
 * The public Pool reads name a team side (slice 1b-2, call 6).
 *
 * `…/pools-with-matches` read a bout's sides through their Registrations only, and the Pool
 * composition of `…/standings` read its seats the same way: a team Pool showed every bout and
 * every seat with no name. Both now read the team side too and name it through `sideLabel`. The
 * Registration ids stay beside the new side keys: the public Pool page marks the reader's own
 * bouts by them.
 *
 * These run the real EventsService over seeded tables, through the controller.
 */
import 'reflect-metadata';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

const EVENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const LYON = {
  id: 'team-lyon',
  name: 'Lyon Blades',
  color: 'teal',
  logo_url: 'https://cdn/lyon.png',
};
const NANTES = { id: 'team-nantes', name: 'Nantes Edge', color: 'amber', logo_url: null };

const person = (given: string, family: string, club: { name: string; abbreviation: string }) => ({
  id: `person-${given}`,
  given_name: given,
  family_name: family,
  clubs: { id: `club-${club.abbreviation}`, ...club },
});
const ANNA = {
  id: 'reg-anna',
  persons: person('Anna', 'Roux', { name: 'Lyon AMHE', abbreviation: 'LYA' }),
};
const BRUNO = {
  id: 'reg-bruno',
  persons: person('Bruno', 'Morel', { name: 'Nantes HEMA', abbreviation: 'NAH' }),
};

const LICE = { id: 'lice-1', name: 'Piste 1', color_hex: '#123456' };

const bout = (id: string, pool: string, sides: Record<string, unknown>) => ({
  id,
  phase_id: `phase-${pool}`,
  pool_id: pool,
  status: 'completed',
  scheduled_at: '2026-12-05T09:00:00Z',
  match_number_label: 'L1-P1-M1',
  red_score: 3,
  blue_score: 5,
  lice_id: LICE.id,
  lices: LICE,
  red: null,
  blue: null,
  red_team: null,
  blue_team: null,
  winner_registration_id: null,
  winner_team_id: null,
  ...sides,
});

const tournament = (slug: string, pool: string) => ({
  id: `id-${slug}`,
  event_id: EVENT,
  slug,
  name: slug,
  status: 'running',
  weapon: 'longsword',
  ruleset_code: 'TF_v1',
  ruleset_version: '1',
  logo_url: null,
  color: null,
  scoring_config_json: null,
  pool,
});

let db: ReturnType<typeof mockSupabase>;
let controller: EventsController;

beforeEach(() => {
  db = mockSupabase({
    events: {
      rows: [
        {
          id: EVENT,
          slug: 'open',
          status: 'published',
          organization_id: 'org-a',
          event_kind: 'standard',
          timezone: 'Europe/Paris',
        },
      ],
    },
    tournaments: { rows: [tournament('teams', 'pool-t'), tournament('solo', 'pool-s')] },
    custom_rulesets: { rows: [] },
    tournament_ruleset_repins: { rows: [] },
    registrations: { rows: [] },
    referee_assignments: { rows: [] },
    phases: {
      rows: [
        { id: 'phase-pool-t', tournament_id: 'id-teams', type: 'pool', config_json: {} },
        { id: 'phase-pool-s', tournament_id: 'id-solo', type: 'pool', config_json: {} },
      ],
    },
    pools: {
      rows: [
        {
          id: 'pool-t',
          phase_id: 'phase-pool-t',
          name: 'Pool A',
          sort_order: 0,
          pool_members: [
            { registration_id: null, team_id: LYON.id, seed: 1, registrations: null, teams: LYON },
            {
              registration_id: null,
              team_id: NANTES.id,
              seed: 2,
              registrations: null,
              teams: NANTES,
            },
          ],
        },
        {
          id: 'pool-s',
          phase_id: 'phase-pool-s',
          name: 'Pool A',
          sort_order: 0,
          pool_members: [
            { registration_id: ANNA.id, team_id: null, seed: 1, registrations: ANNA, teams: null },
          ],
        },
      ],
    },
    matches: {
      rows: [
        bout('team-bout', 'pool-t', {
          red_team: LYON,
          blue_team: NANTES,
          winner_team_id: NANTES.id,
        }),
        bout('solo-bout', 'pool-s', { red: ANNA, blue: BRUNO, winner_registration_id: BRUNO.id }),
      ],
    },
  });
  const orgs = new OrganizationsService(db as never);
  const events = new EventsService(db as never, orgs, {} as never, { has: () => false } as never);
  controller = new EventsController(
    events,
    db as never,
    {} as never,
    {} as never,
    orgs,
    {} as never,
  );
});

const ANON = {
  headers: {},
  cookies: {},
  identity: { kind: 'anonymous' },
  staffSession: null,
} as never;

const boutsOf = async (slug: string) => {
  const answer = await controller.getPublicTournamentPoolsWithMatches('open', slug, ANON);
  return answer.pools[0]!.matches;
};
const membersOf = async (slug: string) => {
  const answer = await controller.getPublicTournamentStandings('open', slug, ANON);
  return (answer.pools[0] as { members: unknown[] }).members;
};

describe('the public Pool bouts', () => {
  it('reads both kinds of side and the team winner', async () => {
    await boutsOf('teams');

    expect(selectsFor(db.from, 'matches')).toEqual([
      'id, status, scheduled_at, match_number_label, red_score, blue_score, winner_registration_id, winner_team_id, pool_id, lice_id, ' +
        'red:registrations!matches_red_registration_id_fkey(id, persons(given_name, family_name, clubs(name, abbreviation))), ' +
        'blue:registrations!matches_blue_registration_id_fkey(id, persons(given_name, family_name, clubs(name, abbreviation))), ' +
        'red_team:teams!matches_red_team_id_fkey(id,name,color,logo_url),' +
        'blue_team:teams!matches_blue_team_id_fkey(id,name,color,logo_url), ' +
        'lices(id, name, color_hex)',
    ]);
  });

  it("names a team side by its team, with its key, colour and logo, and the winner's key", async () => {
    expect(await boutsOf('teams')).toEqual([
      {
        matchId: 'team-bout',
        roundCode: expect.any(String),
        status: 'completed',
        scheduledAt: '2026-12-05T09:00:00Z',
        redFighterName: 'Lyon Blades',
        redClubAbbrev: null,
        redRegistrationId: null,
        redSideId: 'team-lyon',
        redColour: 'teal',
        redLogoUrl: 'https://cdn/lyon.png',
        blueFighterName: 'Nantes Edge',
        blueClubAbbrev: null,
        blueRegistrationId: null,
        blueSideId: 'team-nantes',
        blueColour: 'amber',
        blueLogoUrl: null,
        winnerRegistrationId: null,
        winnerSideId: 'team-nantes',
        redScore: 3,
        blueScore: 5,
        liceName: 'Piste 1',
        liceColorHex: '#123456',
      },
    ]);
  });

  it("keeps a Fighter's bout as it was, and only adds the side keys and the empty team fields", async () => {
    const before = {
      matchId: 'solo-bout',
      roundCode: expect.any(String),
      status: 'completed',
      scheduledAt: '2026-12-05T09:00:00Z',
      redFighterName: 'Anna Roux',
      redClubAbbrev: 'LYA',
      redRegistrationId: 'reg-anna',
      redScore: 3,
      blueFighterName: 'Bruno Morel',
      blueClubAbbrev: 'NAH',
      blueRegistrationId: 'reg-bruno',
      blueScore: 5,
      winnerRegistrationId: 'reg-bruno',
      liceName: 'Piste 1',
      liceColorHex: '#123456',
    };
    const added = {
      redSideId: 'reg-anna',
      redColour: null,
      redLogoUrl: null,
      blueSideId: 'reg-bruno',
      blueColour: null,
      blueLogoUrl: null,
      winnerSideId: 'reg-bruno',
    };

    expect(await boutsOf('solo')).toEqual([{ ...before, ...added }]);
  });
});

describe('the public Pool composition', () => {
  it('reads both kinds of seat', async () => {
    await membersOf('teams');

    expect(selectsFor(db.from, 'pools')).toEqual([
      'id, name, pool_members(registration_id, team_id, seed, registrations(id, persons(id, given_name, family_name, clubs(id, name, abbreviation))), teams(id, name, color, logo_url))',
    ]);
  });

  it('names a team seat by its team, with its key, colour and logo', async () => {
    expect(await membersOf('teams')).toEqual([
      {
        registrationId: null,
        sideId: 'team-lyon',
        kind: 'team',
        fighterName: 'Lyon Blades',
        clubName: null,
        clubAbbreviation: null,
        colour: 'teal',
        logoUrl: 'https://cdn/lyon.png',
        seed: 1,
      },
      {
        registrationId: null,
        sideId: 'team-nantes',
        kind: 'team',
        fighterName: 'Nantes Edge',
        clubName: null,
        clubAbbreviation: null,
        colour: 'amber',
        logoUrl: null,
        seed: 2,
      },
    ]);
  });

  it("keeps a Fighter's seat as it was, and only adds the side key, the kind and the empty team fields", async () => {
    const before = {
      registrationId: 'reg-anna',
      fighterName: 'Anna Roux',
      clubName: 'Lyon AMHE',
      clubAbbreviation: 'LYA',
      seed: 1,
    };
    const added = { sideId: 'reg-anna', kind: 'individual', colour: null, logoUrl: null };

    expect(await membersOf('solo')).toEqual([{ ...before, ...added }]);
  });
});
