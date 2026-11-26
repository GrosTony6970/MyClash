import { beforeEach, describe, expect, it } from 'vitest';
import { expectNoRawIds } from './no-raw-ids.test-helper';
import {
  assertOrgRole,
  bout,
  crewRow,
  DECLARANT,
  forbidden,
  id,
  JEAN,
  judgeVerdict,
  listEventReferees,
  MATCH,
  preview,
  resetWorld,
  world,
} from './preview-referee-assignment.test-helper';

async function refused(over: Parameters<typeof preview>[0] = {}): Promise<string> {
  const result = await preview(over);
  expectNoRawIds(result);
  expect(Object.keys(result)).toEqual(['refusal']);
  return (result as { refusal: string }).refusal;
}

beforeEach(resetWorld);

describe('preview_referee_assignment refuses', () => {
  it('in maintenance, before the editor check', async () => {
    world.readOnly = true;
    expect(await refused()).toBe('MyClash is in maintenance: nothing can change right now.');
    expect(assertOrgRole).not.toHaveBeenCalled();
  });

  it('a caller below editor at the Event', async () => {
    assertOrgRole.mockRejectedValue(forbidden());
    expect(await refused()).toBe(
      "Only the Event's organisers (editor or above) can change its referees.",
    );
  });

  it('fails, not refuses, when the membership read fails', async () => {
    assertOrgRole.mockRejectedValue(new Error('membership read failed: timeout'));
    await expect(preview()).rejects.toThrow('membership read failed');
  });

  it.each(['completed', 'archived'])('an Event that is %s', async (status) => {
    world.eventStatus = status;
    expect(await refused()).toBe('FAL 2026 is over: its referees can no longer change.');
  });

  it('while the referee board is locked', async () => {
    world.locked = true;
    expect(await refused()).toBe(
      'Referee assignments are locked at this Event. Unlock them in MyClash first.',
    );
  });

  it('a Match code the Tournament does not have', async () => {
    expect(await refused({ match: 'LSW-P9-M01' })).toBe('No Match "LSW-P9-M01" in Longsword Open.');
  });

  it('a Match code two bouts share', async () => {
    world.bouts = [bout(), bout({ id: id(6) })];
    expect(await refused()).toBe(
      'Several Matches of Longsword Open are "lsw-p2-m04": MyClash cannot tell them apart.',
    );
  });

  it('a role the Event does not have, naming its roles', async () => {
    expect(await refused({ role: 'Président' })).toBe(
      'No referee role "Président" at FAL 2026; its roles are: Déclarant, Table, Juge de coin.',
    );
  });

  it('a role name two roles share', async () => {
    world.extraSkills = [{ id: 'custom-fal-2', name: 'DÉCLARANT', event_id: id(1) }];
    expect(await refused()).toBe(
      'Several referee roles at FAL 2026 are "declarant"; its roles are: Déclarant, Table, ' +
        'Juge de coin, DÉCLARANT.',
    );
  });

  it('a referee not on the roster', async () => {
    expect(await refused({ referee: 'Zoé Bernard' })).toBe(
      'No referee "Zoé Bernard" on the referee roster of FAL 2026.',
    );
  });

  it('a name several referees match, each with their club, so Claude can ask', async () => {
    expect(await refused({ referee: 'paul' })).toBe(
      'Several referees of FAL 2026 match "paul": Paul Martin (Salle Lyon), ' +
        'Luc Paulin (Salle Nantes). Which one?',
    );
  });

  it('a referee without the role’s skill', async () => {
    expect(await refused({ referee: 'Luc Paulin' })).toBe(
      'Luc Paulin does not hold the Déclarant skill at FAL 2026.',
    );
  });

  it('the person who already holds the role', async () => {
    world.crew = [crewRow(JEAN, DECLARANT, 'match')];
    expect(await refused({ referee: 'Jean Dupont' })).toBe(
      'Jean Dupont already holds Déclarant on LSW-P2-M04.',
    );
    expect(judgeVerdict).not.toHaveBeenCalled();
  });

  it('an Impossible swap, with every reason in words', async () => {
    judgeVerdict.mockResolvedValue({
      verdict: {
        level: 'impossible',
        reasons: [
          {
            code: 'own_match',
            level: 'impossible',
            against: { kind: 'match', id: MATCH, label: 'LSW-P2-M04' },
            confirmed: false,
          },
          {
            code: 'outside_availability',
            level: 'impossible',
            against: null,
            confirmed: false,
          },
          {
            code: 'rest',
            level: 'discouraged',
            against: { kind: 'match', id: id(40), label: 'LSW-P1-M02' },
            confirmed: false,
          },
        ],
      },
      matchIds: [MATCH],
      skippedMatchIds: [],
    });
    expect(await refused()).toBe(
      'Paul Martin cannot take Déclarant on LSW-P2-M04: fights in this bout (LSW-P2-M04); ' +
        'outside their declared availability.',
    );
  });

  it('a removal when nobody holds the role', async () => {
    expect(await refused({ referee: null })).toBe('Nobody holds Déclarant on this Match.');
    expect(listEventReferees).not.toHaveBeenCalled();
  });

  it('a removal of a holder from the Pool crew', async () => {
    world.crew = [crewRow(JEAN, DECLARANT, 'pool')];
    expect(await refused({ referee: null })).toBe(
      'Jean Dupont holds Déclarant for all of Pool 2, not this Match alone. Change it on the ' +
        'Pools page, or name someone for this Match.',
    );
  });

  it('a removal of a holder from the piste crew', async () => {
    world.crew = [crewRow(JEAN, DECLARANT, 'lice')];
    expect(await refused({ referee: null })).toBe(
      'Jean Dupont holds Déclarant for every Match on Piste A, not this Match alone. Change ' +
        'it in MyClash, or name someone for this Match.',
    );
  });

  it('a removal of a piste-crew holder on a piste with no name, never saying "null"', async () => {
    world.bouts = [bout({ lices: null })];
    world.crew = [crewRow(JEAN, DECLARANT, 'lice')];
    expect(await refused({ referee: null })).toBe(
      'Jean Dupont holds Déclarant for every Match on its piste, not this Match alone. Change ' +
        'it in MyClash, or name someone for this Match.',
    );
  });
});

describe('preview_referee_assignment fails', () => {
  it('when the crew read fails: an empty crew would pass the holder check', async () => {
    world.crewError = true;
    await expect(preview()).rejects.toThrow('referee crew read failed: connection reset');
  });

  it('with no confirmation key, rather than answer without a token', async () => {
    await expect(preview({}, null)).rejects.toThrow('no confirmation key');
  });
});
