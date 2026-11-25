import { describe, expect, it } from 'vitest';
import { ANONYMOUS_USER_ID } from '../../common/auth/request-user';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { LiveStateService } from './live-state.service';

/**
 * The hall's live board names the bout on each piste and the next one. Call 6 of slice 1b-2: a team
 * side is named by its team, with its colour chip. A side not known yet keeps a null name, never
 * '', so each screen's own fallback still fires.
 */

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const LICE_ID = '22222222-2222-4222-8222-222222222222';

const LYON = { id: 'team-lyon', name: 'Lyon Blades', color: 'teal', logo_url: null };
const NANTES = { id: 'team-nantes', name: 'Nantes Edge', color: null, logo_url: null };

const bout = (id: string, status: string, sides: Record<string, unknown>) => ({
  id,
  status,
  scheduled_at: null,
  match_number_label: id,
  lice_id: LICE_ID,
  red_score: 0,
  blue_score: 0,
  phases: { config_json: null, tournaments: { id: 't-1', name: 'Team Open', status: 'running' } },
  // The flat key a dotted filter reads on a seeded row (`onlyPublicTournaments`).
  'phases.tournaments.status': 'running',
  ...sides,
});

function board() {
  const db = mockSupabase({
    events: {
      rows: [
        {
          id: EVENT_ID,
          start_date: new Date().toISOString(),
          timezone: 'Europe/Paris',
          status: 'published',
          organization_id: 'org-1',
        },
      ],
    },
    lices: { rows: [{ id: LICE_ID, event_id: EVENT_ID, name: 'Piste 1', sort_order: 0 }] },
    event_programme_blocks: { rows: [] },
    matches: {
      rows: [
        bout('team-now', 'running', { red: null, blue: null, red_team: LYON, blue_team: NANTES }),
        bout('placeholder-next', 'scheduled', {
          red: null,
          red_team: null,
          blue: { id: 'reg-anna', persons: { given_name: 'Anna', family_name: 'Roux' } },
          blue_team: null,
        }),
      ],
    },
  });
  const live = new LiveStateService(db as never, new OrganizationsService(db as never));
  return {
    read: () => live.getLiveState(EVENT_ID, { userId: ANONYMOUS_USER_ID, staff: null }),
    db,
  };
}

describe('LiveStateService: the sides of a bout on the hall board', () => {
  it('names a team side by its team, with its colour', async () => {
    const [piste] = (await board().read()).lices;

    expect(piste?.runningMatch).toMatchObject({
      redFighterName: 'Lyon Blades',
      blueFighterName: 'Nantes Edge',
      redColour: 'teal',
      blueColour: null,
    });
  });

  it('gives a side not known yet a null name and no colour', async () => {
    const [piste] = (await board().read()).lices;

    expect(piste?.nextMatch).toMatchObject({
      redFighterName: null,
      redColour: null,
      blueFighterName: 'Anna Roux',
    });
  });

  it('reads each side as a Registration or a team', async () => {
    const { read, db } = board();
    await read();

    expect(selectsFor(db.from, 'matches')).toEqual([
      'id,status,scheduled_at,match_number_label,lice_id,red_score,blue_score,' +
        'red:registrations!matches_red_registration_id_fkey(id,persons(given_name,family_name)),' +
        'blue:registrations!matches_blue_registration_id_fkey(id,persons(given_name,family_name)),' +
        'red_team:teams!matches_red_team_id_fkey(id,name,color,logo_url),' +
        'blue_team:teams!matches_blue_team_id_fkey(id,name,color,logo_url),' +
        'phases!inner(config_json,tournaments!inner(id,name,status,weapon)),' +
        'pools(sort_order),bracket_slots(round),swiss_rounds(round_number)',
    ]);
  });
});
