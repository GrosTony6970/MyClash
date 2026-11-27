/**
 * The public bracket names each side of a slot, typed (slice 1c-1, call 6).
 *
 * `getPublishedBracket` read a slot's sides through their Registrations only: a team bracket
 * showed every slot with no name. It now reads the team side too, names it through `sideLabel`,
 * and sends each side's key, kind and colour, and the key of the recorded winner. The fields sent
 * before stay, with the same values: on a team side the Registration ids are null.
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

const LYON = { id: 'team-lyon', name: 'Lyon Blades', color: 'teal', logo_url: null };
const NANTES = { id: 'team-nantes', name: 'Nantes Edge', color: 'amber', logo_url: null };

const ANNA = {
  id: 'reg-anna',
  persons: {
    given_name: 'Anna',
    family_name: 'Roux',
    clubs: { name: 'Lyon AMHE', abbreviation: 'LYA' },
  },
};
const BRUNO = {
  id: 'reg-bruno',
  persons: {
    given_name: 'Bruno',
    family_name: 'Morel',
    clubs: { name: 'Nantes HEMA', abbreviation: null },
  },
};

const tournament = (slug: string) => ({
  id: `id-${slug}`,
  event_id: EVENT,
  slug,
  name: slug,
  status: 'running',
  entrant_kind: slug === 'teams' ? 'team' : 'individual',
  weapon: 'longsword',
  ruleset_code: 'TF_v1',
  ruleset_version: '1',
  logo_url: null,
  color: null,
  scoring_config_json: null,
});

const slot = (slug: string, sides: Record<string, unknown>) => ({
  id: `slot-${slug}`,
  phase_id: `phase-${slug}`,
  round: 1,
  position: 1,
  source_a_ref: 'seed 1',
  source_b_ref: 'seed 2',
  registration_a_id: null,
  registration_b_id: null,
  team_a: null,
  team_b: null,
  ...sides,
});

/** The bout of a slot, won on a forfeit with the lower score. */
const bout = (slug: string, winner: Record<string, unknown>) => ({
  id: `bout-${slug}`,
  bracket_slot_id: `slot-${slug}`,
  status: 'completed',
  red_score: 5,
  blue_score: 2,
  winner_registration_id: null,
  winner_team_id: null,
  match_number_label: 'F1',
  lice_id: 'lice-1',
  lices: { name: 'Piste 1' },
  ...winner,
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
    tournaments: { rows: [tournament('teams'), tournament('solo')] },
    custom_rulesets: { rows: [] },
    tournament_ruleset_repins: { rows: [] },
    registrations: { rows: [ANNA, BRUNO] },
    referee_assignments: { rows: [] },
    phases: {
      rows: [
        { id: 'phase-teams', tournament_id: 'id-teams', type: 'single_elim', config_json: {} },
        { id: 'phase-solo', tournament_id: 'id-solo', type: 'single_elim', config_json: {} },
      ],
    },
    bracket_slots: {
      rows: [
        slot('teams', { team_a: LYON, team_b: NANTES }),
        slot('solo', { registration_a_id: ANNA.id, registration_b_id: BRUNO.id }),
      ],
    },
    matches: {
      rows: [
        bout('teams', { winner_team_id: NANTES.id }),
        bout('solo', { winner_registration_id: BRUNO.id }),
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

const slotsOf = async (slug: string) => {
  const answer = await controller.getPublicTournamentStandings('open', slug, ANON);
  return answer.bracketSlots;
};

describe('the public bracket', () => {
  it('reads both kinds of each slot side and the team winner', async () => {
    await slotsOf('teams');

    expect(selectsFor(db.from, 'bracket_slots')).toEqual([
      'id, round, position, source_a_ref, source_b_ref, registration_a_id, registration_b_id, ' +
        'team_a:teams!bracket_slots_team_a_id_fkey(id,name,color,logo_url),' +
        'team_b:teams!bracket_slots_team_b_id_fkey(id,name,color,logo_url)',
    ]);
    expect(selectsFor(db.from, 'matches')).toContain(
      'id, bracket_slot_id, status, red_score, blue_score, winner_registration_id, winner_team_id, match_number_label, lice_id, lices(name)',
    );
  });

  it('names both teams with their colours and side keys, and keys the recorded winner', async () => {
    expect(await slotsOf('teams')).toEqual([
      {
        id: 'slot-teams',
        round: 1,
        position: 1,
        redFighterName: 'Lyon Blades',
        blueFighterName: 'Nantes Edge',
        redClubAbbrev: null,
        blueClubAbbrev: null,
        redScore: 5,
        blueScore: 2,
        winnerRegistrationId: null,
        status: 'completed',
        matchId: 'bout-teams',
        redRegistrationId: null,
        blueRegistrationId: null,
        source_a_ref: 'seed 1',
        source_b_ref: 'seed 2',
        liceName: 'Piste 1',
        referees: [],
        redSideId: LYON.id,
        blueSideId: NANTES.id,
        winnerSideId: NANTES.id,
        red: {
          sideId: LYON.id,
          kind: 'team',
          registrationId: null,
          teamId: LYON.id,
          name: 'Lyon Blades',
          clubAbbrev: null,
          colour: 'teal',
        },
        blue: {
          sideId: NANTES.id,
          kind: 'team',
          registrationId: null,
          teamId: NANTES.id,
          name: 'Nantes Edge',
          clubAbbrev: null,
          colour: 'amber',
        },
      },
    ]);
  });

  it("keeps a Fighter's slot as it was, and only adds the typed sides", async () => {
    const before = {
      id: 'slot-solo',
      round: 1,
      position: 1,
      redFighterName: 'Anna Roux',
      blueFighterName: 'Bruno Morel',
      // The abbreviation, or the club's name when it has none.
      redClubAbbrev: 'LYA',
      blueClubAbbrev: 'Nantes HEMA',
      redScore: 5,
      blueScore: 2,
      winnerRegistrationId: BRUNO.id,
      status: 'completed',
      matchId: 'bout-solo',
      redRegistrationId: ANNA.id,
      blueRegistrationId: BRUNO.id,
      source_a_ref: 'seed 1',
      source_b_ref: 'seed 2',
      liceName: 'Piste 1',
      referees: [],
    };
    const added = {
      redSideId: ANNA.id,
      blueSideId: BRUNO.id,
      winnerSideId: BRUNO.id,
      red: {
        sideId: ANNA.id,
        kind: 'individual',
        registrationId: ANNA.id,
        teamId: null,
        name: 'Anna Roux',
        clubAbbrev: 'LYA',
        colour: null,
      },
      blue: {
        sideId: BRUNO.id,
        kind: 'individual',
        registrationId: BRUNO.id,
        teamId: null,
        name: 'Bruno Morel',
        clubAbbrev: 'Nantes HEMA',
        colour: null,
      },
    };

    expect(await slotsOf('solo')).toEqual([{ ...before, ...added }]);
  });
});
