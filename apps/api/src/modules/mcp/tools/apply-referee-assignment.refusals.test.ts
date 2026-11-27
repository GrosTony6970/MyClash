import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectNoRawIds } from './no-raw-ids.test-helper';
import {
  apply,
  assertOrgRole,
  calls,
  caller,
  crewRow,
  DECLARANT,
  forbidden,
  id,
  insert,
  JEAN,
  judgeVerdict,
  listEventReferees,
  LUC,
  MARC,
  MARIE,
  MATCH,
  PAUL,
  resetWorld,
  roster,
  seal,
  setRefereeRoleAssignment,
  world,
} from './preview-referee-assignment.test-helper';
import { confirmationKey, sealConfirmation } from './write-confirmation';

const STALE = 'This confirmation is not valid any more. Preview the change again.';
const CHANGED = 'The referees of LSW-P2-M04 changed since the preview. Preview the change again.';
const LOCKED = 'Referee assignments are locked at this Event. Unlock them in MyClash first.';
const IMPOSSIBLE =
  'Paul Martin cannot take Déclarant on LSW-P2-M04: fights in this bout (LSW-P2-M04); ' +
  'outside their declared availability.';

const impossibleReasons = [
  {
    code: 'own_match',
    level: 'impossible',
    against: { kind: 'match', id: MATCH, label: 'LSW-P2-M04' },
    confirmed: false,
  },
  { code: 'outside_availability', level: 'impossible', against: null, confirmed: false },
];

/** The refusal, checked to be one sentence with no raw id, and that nothing was written. */
async function refused(token: string): Promise<string> {
  const result = await apply(token);
  expectNoRawIds(result);
  expect(Object.keys(result)).toEqual(['refusal']);
  expect(setRefereeRoleAssignment).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
  return (result as { refusal: string }).refusal;
}

beforeEach(() => {
  resetWorld();
  world.crew = [crewRow(JEAN, DECLARANT, 'match')];
});

describe('apply_referee_assignment refuses', () => {
  it('in maintenance, before it opens the token or reads anything else', async () => {
    world.readOnly = true;
    expect(await refused('not-a-token')).toBe(
      'MyClash is in maintenance: nothing can change right now.',
    );
    expect(calls.map((c) => c.table)).toEqual(['feature_flags']);
    expect(assertOrgRole).not.toHaveBeenCalled();
  });

  it('a garbled token', async () => {
    expect(await refused('not-a-token')).toBe(STALE);
    expect(calls.some((c) => c.table === 'matches')).toBe(false);
  });

  it('a token sealed with another key (forged)', async () => {
    const forged = sealConfirmation(
      confirmationKey('another-secret'),
      {
        sub: caller.userId,
        cid: caller.clientId,
        matchId: MATCH,
        role: DECLARANT,
        personId: PAUL,
        prev: JEAN,
        next: PAUL,
        codes: [],
      },
      Date.now(),
    ).token;
    expect(await refused(forged)).toBe(STALE);
  });

  it('a token sealed for another person', async () => {
    expect(await refused(seal({}, { ...caller, userId: id(92) }))).toBe(STALE);
  });

  it('a token sealed for another app', async () => {
    expect(await refused(seal({}, { ...caller, clientId: id(93) }))).toBe(STALE);
  });

  it('a bout that is gone', async () => {
    world.matchGone = true;
    expect(await refused(seal())).toBe(STALE);
  });

  it('a role the Event no longer has', async () => {
    expect(await refused(seal({ role: 'custom-gone' }))).toBe(STALE);
  });

  it('a caller below editor at the Event', async () => {
    assertOrgRole.mockRejectedValue(forbidden());
    expect(await refused(seal())).toBe(
      "Only the Event's organisers (editor or above) can change its referees.",
    );
  });

  it('an Event that became completed since the preview', async () => {
    world.eventStatus = 'completed';
    expect(await refused(seal())).toBe('FAL 2026 is over: its referees can no longer change.');
  });

  it('while the referee board is locked', async () => {
    world.locked = true;
    expect(await refused(seal())).toBe(LOCKED);
  });

  it('when someone else took the role since the preview', async () => {
    world.crew = [crewRow(MARIE, DECLARANT, 'match')];
    expect(await refused(seal())).toBe(CHANGED);
  });

  it('when someone took a role that was empty at the preview', async () => {
    expect(await refused(seal({ prev: null }))).toBe(CHANGED);
  });

  it('a removal whose holder now holds the role from the Pool crew', async () => {
    world.crew = [crewRow(JEAN, DECLARANT, 'pool')];
    expect(await refused(seal({ personId: null, next: null }))).toBe(CHANGED);
  });

  it('a removal whose Pool holder, who takes the role back, changed since the preview', async () => {
    // The person agreed to "Marc takes it back"; Luc now holds the role for the Pool.
    world.crew = [crewRow(JEAN, DECLARANT, 'match'), crewRow(LUC, DECLARANT, 'pool')];
    expect(await refused(seal({ personId: null, next: MARC }))).toBe(CHANGED);
    // And "nobody takes it back" when Luc now would.
    expect(await refused(seal({ personId: null, next: null }))).toBe(CHANGED);
  });

  it('a referee who left the roster since the preview', async () => {
    listEventReferees.mockResolvedValue(roster.filter((r) => r.personId !== PAUL));
    expect(await refused(seal())).toBe(CHANGED);
  });

  it("a referee who lost the role's skill since the preview, in words, before the checker", async () => {
    listEventReferees.mockResolvedValue(
      roster.map((r) => (r.personId === PAUL ? { ...r, qualifications: [] } : r)),
    );
    // What the real checker does for a person without the skill: a 400, the generic failure.
    judgeVerdict.mockRejectedValue(
      new BadRequestException('Selected referee is not qualified for this role'),
    );
    expect(await refused(seal())).toBe(
      'Paul Martin does not hold the Déclarant skill at FAL 2026.',
    );
    expect(judgeVerdict).not.toHaveBeenCalled();
  });

  it('a swap that became Impossible, with every reason in words', async () => {
    judgeVerdict.mockResolvedValue({
      verdict: { level: 'impossible', reasons: impossibleReasons },
    });
    expect(await refused(seal())).toBe(IMPOSSIBLE);
  });

  it('a warning the person did not see, naming it', async () => {
    judgeVerdict.mockResolvedValue({
      verdict: {
        level: 'discouraged',
        reasons: [
          {
            code: 'rest',
            level: 'discouraged',
            against: { kind: 'match', id: id(40), label: 'LSW-P1-M02' },
            confirmed: false,
          },
        ],
      },
    });
    expect(await refused(seal())).toBe(
      'Something changed since the preview: Paul Martin no rest since another duty ' +
        '(LSW-P1-M02). Preview the change again.',
    );
  });
});

describe('apply_referee_assignment refuses what the write refuses', () => {
  async function writeRefused(body: Record<string, unknown>): Promise<string> {
    setRefereeRoleAssignment.mockRejectedValue(new ConflictException(body));
    const result = await apply(seal());
    expectNoRawIds(result);
    expect(Object.keys(result)).toEqual(['refusal']);
    expect(insert).not.toHaveBeenCalled();
    return (result as { refusal: string }).refusal;
  }

  it('a lock taken between the check and the write', async () => {
    expect(await writeRefused({ code: 'referee_board_locked', message: 'locked' })).toBe(LOCKED);
  });

  it('an Impossible verdict born inside the write', async () => {
    expect(await writeRefused({ code: 'referee_impossible', reasons: impossibleReasons })).toBe(
      IMPOSSIBLE,
    );
  });

  it('a warning born inside the write', async () => {
    expect(await writeRefused({ code: 'referee_needs_confirmation', reasons: [] })).toBe(CHANGED);
  });
});

describe('apply_referee_assignment fails', () => {
  it('on any other 409 of the write, and audits nothing', async () => {
    setRefereeRoleAssignment.mockRejectedValue(new ConflictException({ code: 'other' }));
    await expect(apply(seal())).rejects.toBeInstanceOf(ConflictException);
    expect(insert).not.toHaveBeenCalled();
  });

  it('on a write that fails otherwise, and audits nothing', async () => {
    setRefereeRoleAssignment.mockRejectedValue(new BadRequestException('rpc failed'));
    await expect(apply(seal())).rejects.toThrow('rpc failed');
    expect(insert).not.toHaveBeenCalled();
  });

  it('when the crew read fails: an empty crew would pass the holder check', async () => {
    world.crewError = true;
    await expect(apply(seal({ prev: null }))).rejects.toThrow('referee crew read failed');
    expect(setRefereeRoleAssignment).not.toHaveBeenCalled();
  });

  it('with no confirmation key', async () => {
    await expect(apply(seal(), null)).rejects.toThrow('no confirmation key');
  });
});
