/**
 * Who may make the server fetch one fighter from HEMA Ratings.
 *
 * Until 2026-09-23 `POST hema-ratings/fighters/:id/sync` asked nobody. With the
 * guard in shadow mode (the production default) anyone at all could make the API
 * fetch ANY id they typed from hemaratings.com and rewrite the latest snapshot.
 * Its one caller is the HEMA Ratings picker on an Event's persons page, so the
 * route now names that Event and takes `editor` on it — the bar for adding a
 * person there (operator ruling 38).
 *
 * The arbitrary id is the half that moved. `GET hema-ratings/search` reaches the
 * same fetch and snapshot write over ids the snapshot already holds, for an
 * `editor` somewhere (ruling 100, hema-ratings.search-access.test.ts).
 *
 * Driven through the controller and the real org-role check over seeded tables.
 * The ratings service is a stub, so "refused" means "never reached".
 */
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { HemaRatingsController } from './hema-ratings.controller';

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '22222222-2222-4222-8222-222222222222';
const NO_EVENT = '99999999-9999-4999-8999-999999999999';

let db: ReturnType<typeof mockSupabase>;
let sync: Mock;
let controller: HemaRatingsController;

beforeEach(() => {
  db = mockSupabase({
    events: {
      rows: [
        { id: EVENT_B, organization_id: 'org-b' },
        { id: EVENT_A, organization_id: 'org-a' },
      ],
    },
    organization_members: {
      rows: [
        { organization_id: 'org-b', user_id: 'u-editor-b', role: 'editor' },
        { organization_id: 'org-a', user_id: 'u-editor-a', role: 'editor' },
        // The role just below the bar: a member who may not add a person.
        { organization_id: 'org-a', user_id: 'u-lead-a', role: 'workshop_lead' },
      ],
    },
  });
  sync = vi.fn(async () => undefined);
  // The token IS the user id here; no token at all is the anonymous caller.
  const supabase = {
    service: db.service,
    getAuthUser: vi.fn(async (token: string) => ({ id: token })),
  };
  controller = new HemaRatingsController(
    { syncByHemaRatingsId: sync } as never,
    supabase as never,
    new OrganizationsService(db as never),
  );
});

/** A request from `userId`; none = no token. */
function req(userId?: string) {
  return { headers: userId ? { authorization: `Bearer ${userId}` } : {}, cookies: {} } as never;
}

describe('HemaRatingsController.sync authorization', () => {
  it('refuses a caller with no token, before any read', async () => {
    await expect(controller.sync(EVENT_A, '1234', req())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(queriedTables(db.from)).toEqual([]);
    expect(sync).not.toHaveBeenCalled();
  });

  it('refuses an editor of another organisation', async () => {
    await expect(controller.sync(EVENT_A, '1234', req('u-editor-b'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(sync).not.toHaveBeenCalled();
  });

  it('refuses a member below editor', async () => {
    await expect(controller.sync(EVENT_A, '1234', req('u-lead-a'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(sync).not.toHaveBeenCalled();
  });

  it('answers 404 for an Event that does not exist', async () => {
    await expect(controller.sync(NO_EVENT, '1234', req('u-editor-a'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(sync).not.toHaveBeenCalled();
  });

  it("lets an editor of the Event sync the fighter, and reads that Event's organisation", async () => {
    await expect(controller.sync(EVENT_A, '1234', req('u-editor-a'))).resolves.toEqual({
      accepted: true,
    });
    expect(sync).toHaveBeenCalledWith('1234');
    // The decision is the Event's organisation, so the projection must carry it.
    expect(selectsFor(db.from, 'events')).toEqual(['organization_id']);
  });

  it('holds each Event to its own organisation, not to whichever was read first', async () => {
    await expect(controller.sync(EVENT_B, '5678', req('u-editor-b'))).resolves.toEqual({
      accepted: true,
    });
    await expect(controller.sync(EVENT_B, '5678', req('u-editor-a'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(sync.mock.calls).toEqual([['5678']]);
  });
});
