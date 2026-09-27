/**
 * A person's privacy choices live on their global person (ruling 132, migration 0211): every Event,
 * past and future, reads one answer. A failed read or write is a 5xx, never the defaults (rulings
 * 117a, 120, 124): the defaults allow being followed.
 */
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  writesTo,
} from '../../common/testing/supabase-chain';
import { PrivacyService } from './privacy.service';

const LEA = 'gp-lea';
const FAILED = { data: null, error: { message: 'connection reset' } };
const COLUMNS = 'hide_workshops_publicly, allow_being_followed';

function world(tables: Parameters<typeof mockSupabase>[0] = {}) {
  const db = mockSupabase({
    persons: {
      rows: [
        // Léa in two Events, one Event row with no global person.
        { id: 'p-spring', global_person_id: LEA },
        { id: 'p-autumn', global_person_id: LEA },
        { id: 'p-unlinked', global_person_id: null },
      ],
    },
    global_persons: {
      rows: [
        {
          id: LEA,
          claimed_by_user_id: 'u-lea',
          merged_into_id: null,
          hide_workshops_publicly: true,
          allow_being_followed: false,
        },
        {
          id: 'gp-marc',
          claimed_by_user_id: 'u-marc',
          merged_into_id: null,
          hide_workshops_publicly: false,
          allow_being_followed: true,
        },
        // Nina's profile, merged into Marc's, which another account owns: her account stayed here.
        {
          id: 'gp-nina-old',
          claimed_by_user_id: 'u-nina',
          merged_into_id: 'gp-marc',
          hide_workshops_publicly: true,
          allow_being_followed: false,
        },
      ],
    },
    ...tables,
  });
  return { db, service: new PrivacyService({ service: db.service } as never) };
}

describe('one answer for every Event (ruling 132)', () => {
  it("reads every Event row of a person through their global person's choices", async () => {
    const { db, service } = world();
    for (const personId of ['p-spring', 'p-autumn']) {
      await expect(service.forPerson(personId)).resolves.toEqual({
        hideWorkshopsPublicly: true,
        allowBeingFollowed: false,
      });
    }
    expect(selectsFor(db.from, 'persons')).toEqual(['global_person_id', 'global_person_id']);
    expect(selectsFor(db.from, 'global_persons')).toEqual([COLUMNS, COLUMNS]);
    expect(filtersFor(db.from, 'global_persons', 'eq')).toContainEqual(['id', LEA]);
  });

  it('gives an Event row linked to no global person, or an unknown one, the defaults', async () => {
    const { db, service } = world();
    const defaults = { hideWorkshopsPublicly: false, allowBeingFollowed: true };
    await expect(service.forPerson('p-unlinked')).resolves.toEqual(defaults);
    // No global person, nothing to ask for.
    expect(queriedTables(db.from)).toEqual(['persons']);
    await expect(service.forPerson('p-nobody')).resolves.toEqual(defaults);
    await expect(service.forGlobalPerson('gp-nobody')).resolves.toEqual(defaults);
  });

  it("reads the signed-in user's own choices, and null when no global person is theirs", async () => {
    const { db, service } = world();
    await expect(service.forUser('u-lea')).resolves.toEqual({
      hideWorkshopsPublicly: true,
      allowBeingFollowed: false,
    });
    await expect(service.forUser('u-nobody')).resolves.toBeNull();
    expect(filtersFor(db.from, 'global_persons', 'eq')).toContainEqual([
      'claimed_by_user_id',
      'u-lea',
    ]);
  });

  it("writes the user's own global person, only the choices sent, then reads them back", async () => {
    const { db, service } = world();
    await expect(service.updateForUser('u-marc', { allowBeingFollowed: false })).resolves.toEqual({
      hideWorkshopsPublicly: false,
      allowBeingFollowed: true, // the double reads back the seeded row
    });
    const [write, ...more] = writesTo(db, 'global_persons');
    expect(more).toEqual([]);
    expect(write).toMatchObject({ op: 'update', row: { allow_being_followed: false } });
    expect(write!.filters).toEqual([
      { method: 'eq', args: ['claimed_by_user_id', 'u-marc'] },
      { method: 'is', args: ['merged_into_id', null] },
    ]);
  });

  it('gives an account left on a merged-away profile no choices to read or save (ruling 159)', async () => {
    const { db, service } = world();
    await expect(service.forUser('u-nina')).resolves.toBeNull();
    await expect(service.updateForUser('u-nina', { allowBeingFollowed: true })).resolves.toBeNull();
    expect(writesTo(db, 'global_persons')[0]!.filters).toContainEqual({
      method: 'is',
      args: ['merged_into_id', null],
    });
  });

  it('writes nothing for an empty patch, and still answers', async () => {
    const { db, service } = world();
    await expect(service.updateForUser('u-marc', {})).resolves.toEqual({
      hideWorkshopsPublicly: false,
      allowBeingFollowed: true,
    });
    expect(writesTo(db, 'global_persons')).toEqual([]);
  });

  it('lets the person see their own hidden workshops, and nobody else', async () => {
    const { service } = world();
    await expect(service.canSeeWorkshops('p-spring', 'p-spring')).resolves.toBe(true);
    await expect(service.canSeeWorkshops('p-spring', 'p-other')).resolves.toBe(false);
    await expect(service.canSeeWorkshops('p-spring', null)).resolves.toBe(false);
  });

  it('names the global persons who hide their workshops, in one read', async () => {
    const { db, service } = world();
    await expect(service.hiddenWorkshopGlobalPersonIds([LEA, 'gp-marc', LEA, ''])).resolves.toEqual(
      new Set([LEA]),
    );
    expect(selectsFor(db.from, 'global_persons')).toEqual(['id']);
    expect(filtersFor(db.from, 'global_persons', 'in')).toEqual([['id', [LEA, 'gp-marc']]]);
    expect(filtersFor(db.from, 'global_persons', 'eq')).toEqual([
      ['hide_workshops_publicly', true],
    ]);
    await expect(service.hiddenWorkshopGlobalPersonIds([])).resolves.toEqual(new Set());
  });
});

describe('a privacy read or write that fails', () => {
  const plainError = async (call: Promise<unknown>, message: RegExp) => {
    const failure = await call.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect((failure as Error).message).toMatch(message);
  };

  it('is a 5xx on the Event row, never the defaults', async () => {
    const { service } = world({ persons: FAILED });
    await plainError(service.forPerson('p-spring'), /^privacy read failed: connection reset$/);
  });

  it('is a 5xx on the global person, for a reader and for the settings page', async () => {
    const { service } = world({ global_persons: FAILED });
    await plainError(service.forGlobalPerson(LEA), /^privacy read failed: connection reset$/);
    await plainError(service.forUser('u-lea'), /^privacy read failed: connection reset$/);
    await plainError(
      service.hiddenWorkshopGlobalPersonIds([LEA]),
      /^hidden-workshop privacy read failed: connection reset$/,
    );
  });

  it('is a 5xx on a save, never the old values read back as if saved', async () => {
    const { service } = world({ global_persons: FAILED });
    await plainError(
      service.updateForUser('u-lea', { hideWorkshopsPublicly: false }),
      /^privacy write failed: connection reset$/,
    );
  });
});
