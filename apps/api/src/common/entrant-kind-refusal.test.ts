/**
 * The kind trigger's refusals as a 409 a screen can name (`entrant-kind-refusal.ts`).
 *
 * The messages below are the trigger's own text (0281, `raise exception`), as PostgREST passes it
 * on with the SQLSTATE; the cascade probe proves both on a real database
 * (`scripts/lib/team-kind-race.mjs`).
 */
import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { entrantKindRefusal } from './entrant-kind-refusal';

const HOLDS = {
  code: '23514',
  message: 'entrant_kind_holds: a team Tournament holds no registrations row',
};
const SETTLED = {
  code: '23514',
  message: 'entrant_kind_is_settled: Tournament 0b8f… has entrants, so its kind stays individual',
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
