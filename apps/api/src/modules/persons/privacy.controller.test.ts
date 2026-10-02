/**
 * The settings page's privacy choices, `GET/PATCH /persons/me/privacy`, read and write the signed-in
 * user's GLOBAL person (ruling 132): one answer for every Event, including one they have not
 * entered yet. Driven through the controller and the real service over seeded tables.
 *
 * Before, the choices were copied onto every Event row the user owned, so a user entered in no Event
 * had nowhere to store them, and next month's Event started from the defaults.
 */
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables, writesTo } from '../../common/testing/supabase-chain';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';

function world(globalPersons: Parameters<typeof mockSupabase>[0]['global_persons']) {
  // Marc follows Léa in the Spring Open (ruling 208: switching the choice off removes him).
  const db = mockSupabase({
    global_persons: globalPersons,
    persons: {
      rows: [{ id: 'lea-spring', global_person_id: 'gp-lea', events: { status: 'published' } }],
    },
    follows: { rows: [{ followed_person_id: 'lea-spring', follower_user_id: 'marc' }] },
    directory_follows: { rows: [] },
  });
  const supabase = {
    service: db.service,
    anon: {
      auth: {
        getUser: vi.fn(async (token: string) =>
          token === 'dead'
            ? { data: { user: null }, error: { message: 'expired' } }
            : { data: { user: { id: token } }, error: null },
        ),
      },
    },
  };
  const applyFollow = vi.fn();
  const controller = new PrivacyController(
    new PrivacyService(supabase as never),
    supabase as never,
    { applyFollow, applyHubFollow: vi.fn() } as never,
  );
  return { db, controller, applyFollow };
}

const LEA_ROW = {
  id: 'gp-lea',
  claimed_by_user_id: 'u-lea',
  hide_workshops_publicly: true,
  allow_being_followed: false,
};
const as = (token?: string) => ({ cookies: token ? { 'sb-access-token': token } : {} }) as never;

describe('PrivacyController (ruling 132)', () => {
  it("answers the user's global person's choices, whatever Events they are in", async () => {
    const { controller } = world({ rows: [LEA_ROW] });
    await expect(controller.getPrivacy(as('u-lea'))).resolves.toEqual({
      hideWorkshopsPublicly: true,
      allowBeingFollowed: false,
    });
  });

  it("saves on the user's own global person, and nobody else's", async () => {
    const { db, controller } = world({ rows: [LEA_ROW] });
    await controller.updatePrivacy(as('u-lea'), { allowBeingFollowed: true } as never);
    const writes = writesTo(db, 'global_persons');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ op: 'update', row: { allow_being_followed: true } });
    expect(writes[0]!.filters).toEqual([
      { method: 'eq', args: ['claimed_by_user_id', 'u-lea'] },
      { method: 'is', args: ['merged_into_id', null] },
    ]);
  });

  // Tom's account owns no profile: the sign-in could not link it safely (ruling 160, accepted).
  it('401s a user who owns no global person, in both directions', async () => {
    const { controller } = world({ rows: [LEA_ROW] });
    for (const call of [
      () => controller.getPrivacy(as('u-nobody')),
      () => controller.updatePrivacy(as('u-nobody'), { allowBeingFollowed: false } as never),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(call()).rejects.toThrow(/^No person profile linked to this account$/);
    }
  });

  it('saved as off, removes the people who already follow her, once the choice is saved', async () => {
    const { db, controller, applyFollow } = world({ rows: [{ ...LEA_ROW, merged_into_id: null }] });

    await controller.updatePrivacy(as('u-lea'), { allowBeingFollowed: false } as never);

    // The choice first, so no new follow lands; then the hub switches off (ruling 217), then his
    // follow, muted and deleted.
    expect(db.writes.map((write) => [write.table, write.op])).toEqual([
      ['global_persons', 'update'],
      ['directory_follows', 'update'],
      ['follows', 'update'],
      ['follows', 'delete'],
      ['directory_follows', 'delete'],
    ]);
    expect(applyFollow.mock.calls).toEqual([['lea-spring', 'marc']]);
  });

  it.each<[string, Record<string, boolean>]>([
    ['saved as on', { allowBeingFollowed: true }],
    ['not part of the save', { hideWorkshopsPublicly: true }],
  ])('%s, keeps her followers', async (_, patch) => {
    const { db, controller, applyFollow } = world({ rows: [{ ...LEA_ROW, merged_into_id: null }] });

    await controller.updatePrivacy(as('u-lea'), patch as never);

    expect(queriedTables(db.from)).not.toContain('follows');
    expect(db.writes.map((write) => write.table)).toEqual(['global_persons']);
    expect(applyFollow).not.toHaveBeenCalled();
  });

  it('fails the save when a follower cannot be removed; the choice is saved, a second tap repairs', async () => {
    const { db, controller, applyFollow } = world({ rows: [{ ...LEA_ROW, merged_into_id: null }] });
    applyFollow.mockRejectedValueOnce(new Error('Followed person unreadable: boom'));
    const off = () => controller.updatePrivacy(as('u-lea'), { allowBeingFollowed: false } as never);

    await expect(off()).rejects.toThrow('Followed person unreadable: boom');
    expect(writesTo(db, 'global_persons')).toHaveLength(1);
    expect(writesTo(db, 'follows').map((write) => write.op)).toEqual(['update']);

    await expect(off()).resolves.toMatchObject({ allowBeingFollowed: false });
    expect(writesTo(db, 'follows').map((write) => write.op)).toEqual([
      'update',
      'update',
      'delete',
    ]);
  });

  it('401s with no session cookie, and with a dead one', async () => {
    const { controller } = world({ rows: [LEA_ROW] });
    await expect(controller.getPrivacy(as())).rejects.toThrow(
      /^Authentication required to manage privacy preferences$/,
    );
    await expect(controller.getPrivacy(as('dead'))).rejects.toThrow(/^Invalid or expired session$/);
  });

  it('a failed read is a 5xx, never "you have no profile"', async () => {
    const { controller } = world({ data: null, error: { message: 'boom' } });
    const failure = await controller.getPrivacy(as('u-lea')).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
  });
});
