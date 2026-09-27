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
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';

function world(globalPersons: Parameters<typeof mockSupabase>[0]['global_persons']) {
  const db = mockSupabase({ global_persons: globalPersons });
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
  const controller = new PrivacyController(
    new PrivacyService(supabase as never),
    supabase as never,
  );
  return { db, controller };
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
