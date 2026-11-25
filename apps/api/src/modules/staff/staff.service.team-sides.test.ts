import { describe, expect, it } from 'vitest';
import { selectsFor, type SupabaseRow } from '../../common/testing/supabase-chain';
import { LICE_MATCH_SELECT } from './lice-matches';
import { ANON, LICE, at, displayRow, serviceOn } from './staff.service.display.fixtures';
import { EVENT, bout, build } from './staff.service.public-lice.fixtures';

/**
 * Call 6 of slice 1b-2: every screen that names a Fighter names a team side by its team, with its
 * colour chip; the TV and the public bout page also show the team's logo where a Fighter's photo
 * is. A side not known yet (a bracket placeholder) keeps a null name, never '', so each screen's
 * own "Red" / "Blue" fallback still fires.
 */

const LYON = {
  id: 'team-lyon',
  name: 'Lyon Blades',
  color: 'teal',
  logo_url: 'https://cdn.example/lyon.png',
};
const NANTES = { id: 'team-nantes', name: 'Nantes Edge', color: 'amber', logo_url: null };

/** A team bout: no Registration on either side, a team on each. */
const teamSides = (winner: string | null = null): SupabaseRow => ({
  red_registration_id: null,
  blue_registration_id: null,
  red_team_id: LYON.id,
  blue_team_id: NANTES.id,
  winner_team_id: winner,
  red: null,
  blue: null,
  red_team: LYON,
  blue_team: NANTES,
});

const TEAM_EMBEDS =
  'red_team:teams!matches_red_team_id_fkey(id,name,color,logo_url),' +
  'blue_team:teams!matches_blue_team_id_fkey(id,name,color,logo_url)';

describe('StaffService.getPublicMatchDisplay: the sides of the TV payload', () => {
  it("gives a team side its key, name, colour and logo, and the winner's key", async () => {
    const { service } = serviceOn([displayRow('team-bout', teamSides(LYON.id))]);

    const payload = await service.getPublicMatchDisplay('team-bout', ANON);

    expect(payload).toMatchObject({
      redSideId: 'team-lyon',
      blueSideId: 'team-nantes',
      winnerSideId: 'team-lyon',
      redFighterName: 'Lyon Blades',
      blueFighterName: 'Nantes Edge',
      redColour: 'teal',
      blueColour: 'amber',
      redLogoUrl: 'https://cdn.example/lyon.png',
      blueLogoUrl: null,
      redFighterPhotoUrl: null,
      redClub: null,
    });
  });

  it("keys a Fighter's side by her Registration, with no colour and no logo", async () => {
    const { service } = serviceOn([displayRow('solo', { winner_registration_id: 'reg-b' })]);

    expect(await service.getPublicMatchDisplay('solo', ANON)).toMatchObject({
      redSideId: 'reg-r',
      blueSideId: 'reg-b',
      winnerSideId: 'reg-b',
      redFighterName: 'A X',
      redColour: null,
      blueColour: null,
      redLogoUrl: null,
      blueLogoUrl: null,
    });
  });

  it('gives a side not known yet no key, no name and no winner', async () => {
    const { service } = serviceOn([
      displayRow('placeholder', { red_registration_id: null, red: null }),
    ]);

    expect(await service.getPublicMatchDisplay('placeholder', ANON)).toMatchObject({
      redSideId: null,
      redFighterName: null,
      blueFighterName: 'B X',
      winnerSideId: null,
    });
  });

  it('reads both kinds of side, for the bout and for the next bout', async () => {
    const { service, from } = serviceOn([
      displayRow('current', { lice_id: LICE, status: 'running', scheduled_at: at(9) }),
      displayRow('next', { ...teamSides(), lice_id: LICE, scheduled_at: at(10) }),
    ]);

    const payload = await service.getPublicMatchDisplay('current', ANON);

    expect(payload.nextMatch).toMatchObject({
      id: 'next',
      redFighterName: 'Lyon Blades',
      blueFighterName: 'Nantes Edge',
      redColour: 'teal',
      blueColour: 'amber',
    });
    expect(selectsFor(from, 'matches')).toEqual([
      '*,lices(id,name,events(id,slug,name,status)),red:registrations!matches_red_registration_id_fkey(id,persons(given_name,family_name,club_id,clubs(name,logo_url),global_persons(photo_url))),blue:registrations!matches_blue_registration_id_fkey(id,persons(given_name,family_name,club_id,clubs(name,logo_url),global_persons(photo_url))),phases(type,config_json,tournaments(id,name,weapon,scoring_config_json)),pools(id,name,sort_order),bracket_slots(round),swiss_rounds(round_number),match_rules(ruleset_config),' +
        TEAM_EMBEDS,
      'id,status,scheduled_at,match_number_label,red:registrations!matches_red_registration_id_fkey(id,persons(given_name,family_name)),blue:registrations!matches_blue_registration_id_fkey(id,persons(given_name,family_name)),phases!inner(config_json,tournaments!inner(weapon,status)),pools(sort_order),bracket_slots(round),swiss_rounds(round_number),' +
        TEAM_EMBEDS,
    ]);
  });
});

describe("StaffService.getMatchNeighbors: the pad's prev/next tiles", () => {
  it('names a team tile by its team, with its colour and no club, and a placeholder by null', async () => {
    const { service, from } = serviceOn([
      displayRow('before', { ...teamSides(), lice_id: LICE, scheduled_at: at(9) }),
      displayRow('current', { lice_id: LICE, scheduled_at: at(10) }),
      displayRow('after', { lice_id: LICE, scheduled_at: at(11), red: null }),
    ]);

    const tiles = await service.getMatchNeighbors('current', ANON);

    expect(tiles.previous).toMatchObject({
      redFighterName: 'Lyon Blades',
      blueFighterName: 'Nantes Edge',
      redColour: 'teal',
      blueColour: 'amber',
      redClub: null,
      blueClub: null,
    });
    expect(tiles.next).toMatchObject({ redFighterName: null, redColour: null });
    expect(selectsFor(from, 'matches')).toEqual([
      'id,lice_id',
      'id,status,scheduled_at,match_number_label,red:registrations!matches_red_registration_id_fkey(id,persons(given_name,family_name,clubs(name))),blue:registrations!matches_blue_registration_id_fkey(id,persons(given_name,family_name,clubs(name))),phases!inner(config_json,tournaments!inner(weapon,status)),pools(sort_order),bracket_slots(round),swiss_rounds(round_number),' +
        TEAM_EMBEDS,
    ]);
  });
});

describe('StaffService.getPublicLiceCurrent: the bout on a piste and its queue', () => {
  it('names a team bout by its teams, with their colours', async () => {
    const team = { ...bout('team-now', 'running', '2026-08-08T09:00:00Z'), ...teamSides() };
    const next = { ...bout('placeholder', 'scheduled', '2026-08-08T10:00:00Z'), red: null };
    const { service, supabase } = build([team, next]);

    const board = (await service.getPublicLiceCurrent(`slug-${EVENT}`, 'Piste 1', ANON)) as {
      current: Record<string, unknown> | null;
      queue: Array<Record<string, unknown>>;
    };

    expect(board.current).toMatchObject({
      redFighterName: 'Lyon Blades',
      blueFighterName: 'Nantes Edge',
      redColour: 'teal',
      blueColour: 'amber',
    });
    expect(board.queue[0]).toMatchObject({ redFighterName: null, redColour: null });
    expect(selectsFor(supabase.from, 'matches')).toEqual([LICE_MATCH_SELECT]);
  });
});
