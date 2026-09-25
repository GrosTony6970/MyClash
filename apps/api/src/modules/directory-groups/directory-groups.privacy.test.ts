import { HttpException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase as seededSupabase,
  selectsFor,
  writesTo,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { REACHABLE_COLUMNS } from '../fighters/directory-predicate';
import { DirectoryGroupsService } from './directory-groups.service';

/**
 * Directory group cards (operator ruling 107): a signed-in user's own groups of
 * fighters, on the People hub.
 *   - a member's country shows only when their privacy map allows it, as on
 *     the fighter profile and the people cards (`isFieldPublic`);
 *   - a profile that was erased, deleted or merged away is never a member card
 *     and cannot be added: it answers exactly like an unknown fighter
 *     (`applyReachable` / `isReachable`);
 *   - a failed read is a 5xx, never "no members" or "fighter not found".
 *
 * Until 2026-09-25 the card sent the country whatever the map said, and an
 * erased profile could be added by its slug.
 */
const USER = 'user-1';
const ERASED_AT = '2026-09-01T00:00:00Z';

const person = (id: string, over: SupabaseRow = {}): SupabaseRow => ({
  id,
  slug: `${id}-slug`,
  display_name: id,
  photo_url: null,
  country_code: 'FR',
  clubs: null,
  ...over,
});

const PEOPLE = {
  open: person('open'),
  hidden: person('hidden', { country_code: 'BE', public_visibility: { nationality: false } }),
  erased: person('erased', { account_deleted_at: ERASED_AT }),
  deleted: person('deleted', { deleted_at: ERASED_AT }),
  merged: person('merged', { merged_into_id: 'open' }),
};

const GROUP = { id: 'group-1', owner_user_id: USER, name: 'Rivals', sort_order: 0 };

let db: ReturnType<typeof seededSupabase>;
let service: DirectoryGroupsService;

function build(tables: Record<string, TableSeed>) {
  db = seededSupabase(tables);
  service = new DirectoryGroupsService(
    db as never,
    {
      getCompactStats: vi.fn().mockResolvedValue(new Map()),
      getFavoriteWeapons: vi.fn().mockResolvedValue(new Map()),
    } as never,
    { countFollowStateForGlobalPersons: vi.fn().mockResolvedValue(new Map()) } as never,
  );
}

const member = (gp: SupabaseRow): SupabaseRow => ({
  group_id: GROUP.id,
  global_person_id: gp['id'],
  global_persons: gp,
});

const refusal = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (err: unknown) => err,
  );
const shapeOf = (err: unknown) => {
  expect(err, 'expected a refusal, the call succeeded').not.toBeNull();
  const http = err as HttpException;
  return { type: http.constructor.name, status: http.getStatus(), body: http.getResponse() };
};

describe('GET /me/groups (ruling 107)', () => {
  beforeEach(() =>
    build({
      directory_groups: { rows: [GROUP] },
      directory_group_members: { rows: Object.values(PEOPLE).map(member) },
    }),
  );

  it("shows a member's country only when their privacy map allows it", async () => {
    const [group] = await service.listGroups(USER);
    expect(group?.members.map((m) => [m.globalPersonId, m.countryCode])).toEqual([
      ['open', 'FR'],
      ['hidden', null],
    ]);
  });

  it('never shows an erased, deleted or merged member', async () => {
    const [group] = await service.listGroups(USER);
    expect(group?.members.map((m) => m.globalPersonId)).toEqual(['open', 'hidden']);
    expect(group?.memberCount).toBe(2);
  });

  it('reads each member with its privacy map and erasure date', async () => {
    await service.listGroups(USER);
    const [select] = selectsFor(db.from, 'directory_group_members');
    // Every reachability column: one left out reads as null, so the member shows.
    for (const column of ['public_visibility', ...REACHABLE_COLUMNS]) {
      expect(select).toMatch(new RegExp(`\\b${column}\\b`, 'u'));
    }
  });

  it('fails a failed member read loudly (5xx), never as an empty group', async () => {
    build({
      directory_groups: { rows: [GROUP] },
      directory_group_members: { data: null, error: { message: 'boom' } },
    });
    const call = service.listGroups(USER);
    await expect(call).rejects.toThrow('directory group members read failed: boom');
    await expect(call).rejects.not.toBeInstanceOf(HttpException);
  });

  it('fails a failed group read loudly (5xx), never as no groups', async () => {
    build({
      directory_groups: { data: null, error: { message: 'boom' } },
      directory_group_members: { rows: [] },
    });
    const call = service.listGroups(USER);
    await expect(call).rejects.toThrow('directory groups read failed: boom');
    await expect(call).rejects.not.toBeInstanceOf(HttpException);
  });
});

describe('POST /me/groups/:groupId/members (ruling 107)', () => {
  beforeEach(() =>
    build({
      directory_groups: { rows: [GROUP] },
      directory_group_members: { rows: [] },
      global_persons: { rows: Object.values(PEOPLE) },
    }),
  );

  const add = (input: { globalPersonId?: string; slug?: string }) =>
    service.addMember(USER, GROUP.id, input);

  it.each(['erased', 'deleted', 'merged'])(
    'answers adding a %s profile exactly like an unknown fighter',
    async (id) => {
      for (const input of [{ slug: `${id}-slug` }, { globalPersonId: id }]) {
        const unknown = await refusal(
          add(input.slug ? { slug: 'nobody' } : { globalPersonId: 'nobody' }),
        );
        const hidden = await refusal(add(input));
        expect(shapeOf(hidden)).toEqual(shapeOf(unknown));
        expect(unknown).toBeInstanceOf(NotFoundException);
      }
      expect(writesTo(db, 'directory_group_members')).toEqual([]);
    },
  );

  it('hides a hidden country on the added card', async () => {
    await expect(add({ slug: 'hidden-slug' })).resolves.toMatchObject({
      globalPersonId: 'hidden',
      countryCode: null,
    });
    await expect(add({ slug: 'open-slug' })).resolves.toMatchObject({ countryCode: 'FR' });
  });

  it('reads the added card with its privacy map', async () => {
    await add({ slug: 'hidden-slug' });
    expect(selectsFor(db.from, 'global_persons')).toEqual([
      'id',
      'id, slug, display_name, photo_url, country_code, public_visibility, clubs ( name )',
    ]);
  });

  it('reads the added card only while the profile is still reachable', async () => {
    // The lookup and the card are two reads: an erasure can land between them.
    await add({ slug: 'open-slug' });
    const reachable = [
      ['deleted_at', null],
      ['merged_into_id', null],
      ['account_deleted_at', null],
    ];
    expect(filtersFor(db.from, 'global_persons', 'is')).toEqual([...reachable, ...reachable]);
  });

  it('fails a failed fighter lookup loudly (5xx), never as "fighter not found"', async () => {
    build({
      directory_groups: { rows: [GROUP] },
      directory_group_members: { rows: [] },
      global_persons: { data: null, error: { message: 'boom' } },
    });
    const call = add({ slug: 'open-slug' });
    await expect(call).rejects.toThrow('fighter lookup failed: boom');
    await expect(call).rejects.not.toBeInstanceOf(HttpException);
  });

  it('fails a failed card read loudly (5xx), never as "fighter not found"', async () => {
    build({
      directory_groups: { rows: [GROUP] },
      directory_group_members: { rows: [] },
      global_persons: [
        { data: { id: 'open' }, error: null },
        { data: null, error: { message: 'boom' } },
      ],
    });
    const call = add({ slug: 'open-slug' });
    await expect(call).rejects.toThrow('fighter card read failed: boom');
    await expect(call).rejects.not.toBeInstanceOf(HttpException);
  });
});
