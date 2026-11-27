/**
 * The kind triggers' refusals as a 409 a screen can name (`entrant-kind-refusal.ts`).
 *
 * The messages below are the triggers' own text (0281, 0287, 0288 and 0289, `raise exception`), as
 * PostgREST passes it on with the SQLSTATE; the cascade probe proves each prefix on a real database
 * (`scripts/lib/team-kind-race.mjs`).
 */
import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  entrantKindMismatch,
  entrantKindRefusal,
  teamTournamentLeague,
  teamTournamentNotSupported,
} from './entrant-kind-refusal';

const HOLDS = {
  code: '23514',
  message: 'entrant_kind_holds: a team Tournament holds no registrations row',
};
const SETTLED = {
  code: '23514',
  message: 'entrant_kind_is_settled: Tournament 0b8f… has entrants, so its kind stays individual',
};
// 0288's refusal (ruling 989), as its `raise exception` writes it.
const PHASED = {
  code: '23514',
  message:
    'entrant_kind_set_before_phases: Tournament 0b8f… has a phase, so its kind stays individual',
};
// 0289's refusal (rulings 996 and 1007), as its `raise exception` writes it.
const PHASE_FITS = {
  code: '23514',
  message:
    'phase_fits_entrant_kind: a team Tournament takes no double_elim phase, and Tournament 0b8f… is a team one',
};
// 0287's two League refusals, as its `raise exception` writes them.
const LEAGUE_LINK = {
  code: '23514',
  message:
    'league_link_individual_only: a League takes individual Tournaments only, and Tournament 0b8f… is a team one',
};
const LINK_BLOCKS = {
  code: '23514',
  message:
    'league_link_blocks_team: Tournament 0b8f… has a live League link, so it stays individual',
};

describe('entrantKindRefusal', () => {
  it('names a Registration in a team Tournament, or a team in an individual one, a mismatch', () => {
    const refusal = entrantKindRefusal(HOLDS);
    expect(refusal).toBeInstanceOf(ConflictException);
    expect(refusal?.getStatus()).toBe(409);
    expect(refusal?.getResponse()).toEqual({
      reason: 'entrant_kind_mismatch',
      message:
        'This Tournament takes the other kind of entrant: a team Tournament takes teams, an individual one takes Fighters.',
    });
  });

  it('names a change of kind of a Tournament with entrants settled', () => {
    expect(entrantKindRefusal(SETTLED)?.getResponse()).toEqual({
      reason: 'entrant_kind_settled',
      message: 'This Tournament already has entrants, so its kind cannot change.',
    });
  });

  it('names a change of kind of a Tournament with a phase locked by it (ruling 989)', () => {
    const refusal = entrantKindRefusal(PHASED);
    expect(refusal?.getStatus()).toBe(409);
    expect(refusal?.getResponse()).toEqual({
      reason: 'kind_locked_by_phase',
      message:
        'Delete the Pools and the bracket first: a Tournament keeps its kind once it has Pools or a bracket.',
    });
  });

  it('names a double elimination or Swiss phase on a team Tournament as the phase doors do (ruling 996)', () => {
    const refusal = entrantKindRefusal(PHASE_FITS);
    expect(refusal?.getStatus()).toBe(409);
    expect(refusal?.getResponse()).toEqual({
      reason: 'team_tournament_not_supported',
      message: 'A team Tournament takes no double elimination and no Swiss phase yet.',
    });
  });

  it('names a live League link to a team Tournament as the League door does', () => {
    const refusal = entrantKindRefusal(LEAGUE_LINK);
    expect(refusal?.getStatus()).toBe(409);
    expect(refusal?.getResponse()).toEqual({
      reason: 'team_tournament_league',
      message: 'A League takes individual Tournaments only: League points belong to persons.',
    });
  });

  it('names a switch to team under a live League link', () => {
    const refusal = entrantKindRefusal(LINK_BLOCKS);
    expect(refusal?.getStatus()).toBe(409);
    expect(refusal?.getResponse()).toEqual({
      reason: 'league_link_blocks_team',
      message: 'Remove the League link first: League points belong to persons.',
    });
  });

  it('leaves another check violation to its caller', () => {
    expect(
      entrantKindRefusal({ code: '23514', message: 'new row violates check "teams_size_range"' }),
    ).toBeNull();
  });

  it('reads the prefix only at the start of the message', () => {
    expect(
      entrantKindRefusal({ code: '23514', message: 'not entrant_kind_holds: a quote' }),
    ).toBeNull();
  });

  it('leaves the same text under another SQLSTATE to its caller', () => {
    expect(entrantKindRefusal({ ...HOLDS, code: 'P0001' })).toBeNull();
    expect(entrantKindRefusal({ message: HOLDS.message })).toBeNull();
  });

  it('answers null for no error', () => {
    expect(entrantKindRefusal(null)).toBeNull();
    expect(entrantKindRefusal(undefined)).toBeNull();
  });
});

describe('the refusals a door says before the database', () => {
  it('says the mismatch as the trigger does', () => {
    expect(entrantKindMismatch().getResponse()).toEqual(entrantKindRefusal(HOLDS)?.getResponse());
    expect(entrantKindMismatch().getResponse()).toMatchObject({ reason: 'entrant_kind_mismatch' });
  });

  it('says a phase a team Tournament does not take as the trigger does', () => {
    expect(teamTournamentNotSupported().getResponse()).toEqual(
      entrantKindRefusal(PHASE_FITS)?.getResponse(),
    );
    expect(teamTournamentNotSupported('Its own sentence.').getResponse()).toEqual({
      reason: 'team_tournament_not_supported',
      message: 'Its own sentence.',
    });
  });

  it('says a League link to a team Tournament as the trigger does', () => {
    expect(teamTournamentLeague().getResponse()).toEqual(
      entrantKindRefusal(LEAGUE_LINK)?.getResponse(),
    );
    expect(teamTournamentLeague().getResponse()).toMatchObject({
      reason: 'team_tournament_league',
    });
  });
});
