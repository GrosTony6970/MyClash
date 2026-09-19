/**
 * Who may change the fighters in a bracket slot.
 *
 * Until 2026-09-19 this route asked nobody. With the guard in shadow mode (the
 * production default) a caller with no token could put any registration into any
 * slot of any bracket, and the slot's Match followed.
 *
 * The bar is `admin` (operator ruling 33), as for generating, filling, reseeding
 * and deleting a bracket and for adding or removing a Pool member, and as RLS
 * `bracket_slots_write` says. The slot's Event is
 * read from the slot, never from the caller. A fighter must be entered in the
 * slot's own tournament.
 *
 * Driven through the controller and the real org-role check over seeded tables.
 * The bracket service is a stub, so "refused" means "never reached".
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { BracketSlotsController } from './bracket-slots.controller';

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '22222222-2222-4222-8222-222222222222';
const TOURNAMENT_A = '33333333-3333-4333-8333-333333333333';
/** A second tournament of Event A: same Event, not the slot's tournament. */
const TOURNAMENT_A2 = '44444444-4444-4444-8444-444444444444';
const TOURNAMENT_B = '55555555-5555-4555-8555-555555555555';
const PHASE_A = '66666666-6666-4666-8666-666666666666';
const PHASE_B = '77777777-7777-4777-8777-777777777777';
const SLOT_A = '88888888-8888-4888-8888-888888888888';
const SLOT_B = '99999999-9999-4999-8999-999999999999';
/** Entered in the slot's own tournament. */
const ANNA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLARA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
/** Entered in Event A's other tournament. */
const DAVID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
/** Entered in Event B's tournament. */
const BRUNO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
/** No registration at all. */
const NOBODY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

let db: ReturnType<typeof mockSupabase>;
let overrideSlot: Mock;
let controller: BracketSlotsController;

beforeEach(() => {
  db = mockSupabase({
    events: {
      rows: [
        { id: EVENT_B, organization_id: 'org-b' },
        { id: EVENT_A, organization_id: 'org-a' },
      ],
    },
    tournaments: {
      rows: [
        { id: TOURNAMENT_B, event_id: EVENT_B },
        { id: TOURNAMENT_A, event_id: EVENT_A },
        { id: TOURNAMENT_A2, event_id: EVENT_A },
      ],
    },
    phases: {
      rows: [
        { id: PHASE_B, tournament_id: TOURNAMENT_B },
        { id: PHASE_A, tournament_id: TOURNAMENT_A },
      ],
    },
    bracket_slots: {
      rows: [
        { id: SLOT_B, phase_id: PHASE_B },
        { id: SLOT_A, phase_id: PHASE_A },
      ],
    },
    registrations: {
      rows: [
        { id: BRUNO, tournament_id: TOURNAMENT_B },
        { id: DAVID, tournament_id: TOURNAMENT_A2 },
        { id: ANNA, tournament_id: TOURNAMENT_A },
        { id: CLARA, tournament_id: TOURNAMENT_A },
      ],
    },
    organization_members: {
      rows: [
        { organization_id: 'org-b', user_id: 'u-admin-b', role: 'admin' },
        { organization_id: 'org-a', user_id: 'u-admin-a', role: 'admin' },
        // Admin elsewhere, editor here: a decision taken on the wrong
        // organisation would let this account move Event A's fighters.
        { organization_id: 'org-b', user_id: 'u-editor-a', role: 'admin' },
        { organization_id: 'org-a', user_id: 'u-editor-a', role: 'editor' },
        // Admin of both: only the same-tournament rule can refuse this account.
        { organization_id: 'org-a', user_id: 'u-admin-ab', role: 'admin' },
        { organization_id: 'org-b', user_id: 'u-admin-ab', role: 'admin' },
      ],
    },
  });
  overrideSlot = vi.fn(async () => undefined);
  // The token IS the user id here; no token at all is the anonymous caller.
  const supabase = {
    service: db.service,
    getAuthUser: vi.fn(async (token: string) => ({ id: token })),
  };
  controller = new BracketSlotsController(
    { overrideSlot } as never,
    supabase as never,
    new OrganizationsService(db as never),
  );
});

/** A request from `userId`; none = no token. */
function req(userId?: string) {
  return {
    headers: userId ? { authorization: `Bearer ${userId}` } : {},
    cookies: {},
  } as never;
}

const SWAP = { registrationAId: ANNA, registrationBId: CLARA };

describe('BracketSlotsController authorization', () => {
  it('covers every handler of the controller', () => {
    // A handler added to the controller and not tested here is checked by nothing.
    const handlers = Object.getOwnPropertyNames(BracketSlotsController.prototype).filter(
      (name) => name !== 'constructor',
    );
    expect(handlers).toEqual(['overrideSlot']);
  });

  it('refuses a caller with no token, before any read', async () => {
    await expect(controller.overrideSlot(SLOT_A, SWAP, req())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(overrideSlot).not.toHaveBeenCalled();
    expect(queriedTables(db.from)).toEqual([]);
  });

  it('refuses a signed-in account outside the organisation, whatever fighter it names', async () => {
    // The role is checked before the fighters: a 400 for an unknown id here
    // would tell a stranger which ids the tournament holds.
    for (const fighter of [ANNA, NOBODY]) {
      await expect(
        controller.overrideSlot(SLOT_A, { registrationAId: fighter }, req('u-stranger')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(overrideSlot).not.toHaveBeenCalled();
  });

  it('refuses an editor: moving a fighter needs admin', async () => {
    await expect(controller.overrideSlot(SLOT_A, SWAP, req('u-editor-a'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(overrideSlot).not.toHaveBeenCalled();
  });

  it("checks the slot's own Event", async () => {
    // Event B's admin, on Event A's slot.
    await expect(controller.overrideSlot(SLOT_A, SWAP, req('u-admin-b'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(overrideSlot).not.toHaveBeenCalled();
  });

  it('lets an admin of the Event through, with the ids it was sent', async () => {
    await controller.overrideSlot(SLOT_A, SWAP, req('u-admin-a'));
    expect(overrideSlot).toHaveBeenCalledWith(SLOT_A, ANNA, CLARA);
  });

  it('lets an admin empty a side, and leave the other as it is', async () => {
    await controller.overrideSlot(SLOT_A, { registrationAId: null }, req('u-admin-a'));
    expect(overrideSlot).toHaveBeenCalledWith(SLOT_A, null, undefined);
  });

  it.each(['registrationAId', 'registrationBId'] as const)(
    "refuses a %s not entered in the slot's tournament, with one answer whoever asks",
    async (side) => {
      // Event A's other tournament, Event B's tournament (from an admin of
      // both), and no registration at all: the same 400 each time, so the
      // answer tells no one which ids exist elsewhere.
      const tries = [
        ['u-admin-a', DAVID],
        ['u-admin-ab', BRUNO],
        ['u-admin-a', NOBODY],
      ] as const;
      const answers: unknown[] = [];
      for (const [caller, fighter] of tries) {
        const refusal = await controller
          .overrideSlot(SLOT_A, { ...SWAP, [side]: fighter }, req(caller))
          .catch((error: unknown) => error);
        expect(refusal).toBeInstanceOf(BadRequestException);
        answers.push((refusal as BadRequestException).getResponse());
      }
      expect(answers[1]).toEqual(answers[0]);
      expect(answers[2]).toEqual(answers[0]);
      expect(overrideSlot).not.toHaveBeenCalled();
    },
  );

  it('answers 404 for a slot that does not exist, before any role check', async () => {
    await expect(controller.overrideSlot(NOBODY, SWAP, req('u-admin-a'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(overrideSlot).not.toHaveBeenCalled();
  });

  it('reads each hop from the row that names it', async () => {
    await controller.overrideSlot(SLOT_A, SWAP, req('u-admin-a'));
    // The double hands back the whole row whatever is selected, so the outcome
    // alone would stay green with a column dropped from a read.
    expect(selectsFor(db.from, 'bracket_slots')).toEqual(['phase_id']);
    expect(selectsFor(db.from, 'phases')).toEqual(['tournament_id']);
    expect(selectsFor(db.from, 'tournaments')).toEqual(['event_id']);
    expect(selectsFor(db.from, 'registrations')).toEqual(['id']);
  });
});
