/**
 * A Registration in a team Tournament is refused by the database (the kind trigger, 0281); both
 * Registration writers answer it as the 409 a screen can name (`entrantKindRefusal`), not as a 400
 * carrying the trigger's text.
 *
 * The story: Anna is entered in "Team Longsword" from the Persons page, then put on its waitlist.
 * The insert is refused with the trigger's own message, as PostgREST passes it on.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { fighterStatusDouble } from '../matches/fighter-status.fixtures';
import { RegistrationsService } from './registrations.service';
import { mockSupabase, type ChainResult } from '../../common/testing/supabase-chain';

const REFUSED: ChainResult = {
  data: null,
  error: {
    code: '23514',
    message: 'entrant_kind_holds: a team Tournament holds no registrations row',
  } as never,
};

/** The service over a team Tournament with no cap; `registrations` answers in call order. */
function service(registrations: ChainResult[]) {
  const db = mockSupabase({
    persons: { data: { id: 'anna', global_person_id: 'g-anna' }, error: null },
    tournaments: { data: { max_participants: null, max_waitlist: null }, error: null },
    registrations,
  });
  return new RegistrationsService(
    db as never,
    { resolveOrCreateGlobalPerson: vi.fn() } as never,
    fighterStatusDouble(),
    { assertTournamentResultsOpen: vi.fn() } as never,
  );
}

async function refusalOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConflictException);
  return (error as ConflictException).getResponse();
}

describe('a Registration in a team Tournament', () => {
  it('is refused 409 entrant_kind_mismatch by the entry', async () => {
    const entry = service([REFUSED]).create('t-team', { personId: 'anna', bibNumber: 7 });
    expect(await refusalOf(entry)).toMatchObject({ reason: 'entrant_kind_mismatch' });
  });

  it('is refused 409 entrant_kind_mismatch by the waitlist', async () => {
    // The waitlist's top row first, then the insert.
    const queued = service([{ data: null, error: null }, REFUSED]).addToWaitlist('t-team', {
      personId: 'anna',
    });
    expect(await refusalOf(queued)).toMatchObject({ reason: 'entrant_kind_mismatch' });
  });

  it('leaves any other refused insert a 400, as before', async () => {
    const other: ChainResult = { data: null, error: { code: '23503', message: 'fk' } as never };
    await expect(
      service([other]).create('t1', { personId: 'anna', bibNumber: 7 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
