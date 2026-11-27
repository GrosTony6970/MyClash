import { describe, expect, it } from 'vitest';
import { CreateMatchForfeitDto } from './matches.dto';

/**
 * `POST /matches/:id/forfeit` names the side that forfeits by exactly one of its two fields: a
 * Fighter by `forfeitingRegistrationId`, a team by `forfeitingTeamId` (call 8). A team has no
 * status, so the "can the Fighter continue?" answer is refused for a team (call 4).
 */
const schema = CreateMatchForfeitDto.schema;

const REG = '00000000-0000-4000-8000-000000000001';
const TEAM = '00000000-0000-4000-8000-000000000002';

const paths = (body: Record<string, unknown>) =>
  schema.safeParse(body).error?.issues.map((issue) => issue.path) ?? [];

describe('CreateMatchForfeitDto', () => {
  it('takes a Fighter, with the continue answer, as it always has', () => {
    expect(
      schema.safeParse({ forfeitingRegistrationId: REG, reason: 'injury', canContinue: false })
        .success,
    ).toBe(true);
  });

  it('takes a team', () => {
    expect(schema.safeParse({ forfeitingTeamId: TEAM, reason: 'voluntary' }).success).toBe(true);
  });

  it('refuses both sides at once', () => {
    expect(
      paths({ forfeitingRegistrationId: REG, forfeitingTeamId: TEAM, reason: 'voluntary' }),
    ).toEqual([['forfeitingTeamId']]);
  });

  it('refuses no side', () => {
    expect(paths({ reason: 'voluntary' })).toEqual([['forfeitingTeamId']]);
  });

  it.each([true, false])('refuses canContinue %s for a team', (canContinue) => {
    expect(paths({ forfeitingTeamId: TEAM, reason: 'injury', canContinue })).toEqual([
      ['canContinue'],
    ]);
  });
});
