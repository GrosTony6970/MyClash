/**
 * The bracket slot override names a side by Registration or by team (call 4 of slice 1c-1).
 *
 * Team Longsword's admin moves teams by hand in its bracket. A team of this Tournament is placed in
 * the team column of its side, and the Registration column of that side is cleared. A side left out
 * is unchanged; `null` clears both columns of the side. A team of Team Rapier, the other team
 * Tournament of the Event, is refused with the same 400 as an unknown id. A side of the other kind
 * than the Tournament's is refused 409 `entrant_kind_mismatch` both ways: a Fighter is never
 * written into a team bracket, and a team never into Open Longsword's.
 *
 * Driven through the controller, the real authorization and the real `BracketAdvanceService` over
 * seeded tables. The double does not apply a write, so the slot write is what is asserted.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  writesTo,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { BracketAdvanceService } from './bracket-advance.service';
import { BracketSlotsController } from './bracket-slots.controller';
import { UpdateBracketSlotDto } from './dto/phases.dto';

const EVENT = '11111111-1111-4111-8111-111111111111';
const TEAM_LONGSWORD = '22222222-2222-4222-8222-222222222222';
const TEAM_RAPIER = '33333333-3333-4333-8333-333333333333';
const OPEN_LONGSWORD = '44444444-4444-4444-8444-444444444444';
const TEAM_PHASE = '55555555-5555-4555-8555-555555555555';
const OPEN_PHASE = '66666666-6666-4666-8666-666666666666';
const TEAM_SLOT = '77777777-7777-4777-8777-777777777777';
const OPEN_SLOT = '88888888-8888-4888-8888-888888888888';
/** Teams of Team Longsword. */
const LIONS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WOLVES = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
/** A team of Team Rapier. */
const HAWKS = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
/** A Fighter entered in Open Longsword. */
const ANNA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NOBODY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const slot = (id: string, phaseId: string, sides: Partial<SupabaseRow> = {}): SupabaseRow => ({
  id,
  phase_id: phaseId,
  round: 1,
  position: 1,
  source_a_type: 'seed',
  source_b_type: 'seed',
  registration_a_id: null,
  registration_b_id: null,
  team_a_id: null,
  team_b_id: null,
  ...sides,
});

let db: ReturnType<typeof mockSupabase>;
let controller: BracketSlotsController;

beforeEach(() => {
  db = mockSupabase({
    events: { rows: [{ id: EVENT, organization_id: 'org-1' }] },
    tournaments: {
      rows: [
        { id: TEAM_RAPIER, event_id: EVENT, entrant_kind: 'team' },
        { id: TEAM_LONGSWORD, event_id: EVENT, entrant_kind: 'team' },
        { id: OPEN_LONGSWORD, event_id: EVENT, entrant_kind: 'individual' },
      ],
    },
    phases: {
      rows: [
        { id: TEAM_PHASE, tournament_id: TEAM_LONGSWORD, type: 'single_elim' },
        { id: OPEN_PHASE, tournament_id: OPEN_LONGSWORD, type: 'single_elim' },
      ],
    },
    bracket_slots: {
      rows: [
        slot(TEAM_SLOT, TEAM_PHASE, { team_a_id: WOLVES, team_b_id: LIONS }),
        slot(OPEN_SLOT, OPEN_PHASE),
      ],
    },
    teams: {
      rows: [
        { id: HAWKS, tournament_id: TEAM_RAPIER },
        { id: LIONS, tournament_id: TEAM_LONGSWORD },
        { id: WOLVES, tournament_id: TEAM_LONGSWORD },
      ],
    },
    registrations: { rows: [{ id: ANNA, tournament_id: OPEN_LONGSWORD }] },
    // The slot's bout, made at generation and not started: the override rewrites it.
    matches: {
      rows: [{ id: 'm-team', bracket_slot_id: TEAM_SLOT, status: 'scheduled', started_at: null }],
    },
    organization_members: {
      rows: [{ organization_id: 'org-1', user_id: 'u-admin', role: 'admin' }],
    },
  });
  const supabase = {
    service: db.service,
    getAuthUser: vi.fn(async (token: string) => ({ id: token })),
  };
  controller = new BracketSlotsController(
    new BracketAdvanceService(db as never),
    supabase as never,
    new OrganizationsService(db as never),
  );
});

const ADMIN = { headers: { authorization: 'Bearer u-admin' }, cookies: {} } as never;
const slotWrite = () => writesTo(db, 'bracket_slots').map((write) => write.row);

async function refusal(attempt: Promise<unknown>) {
  return attempt.then(
    () => null,
    (error: unknown) => error,
  );
}

describe('the bracket slot override, by side', () => {
  it('places a team of this Tournament in the team column, the Registration column cleared', async () => {
    await controller.overrideSlot(TEAM_SLOT, { teamAId: LIONS, teamBId: WOLVES }, ADMIN);

    expect(slotWrite()).toEqual([
      { registration_a_id: null, team_a_id: LIONS, registration_b_id: null, team_b_id: WOLVES },
    ]);
    // The kind and the teams are read by the slot's own Tournament.
    expect(selectsFor(db.from, 'tournaments')).toEqual(['event_id', 'entrant_kind']);
    expect(selectsFor(db.from, 'teams')).toEqual(['id']);
  });

  it('leaves a side out unchanged, and clears both columns of a null side', async () => {
    await controller.overrideSlot(TEAM_SLOT, { teamAId: null }, ADMIN);

    expect(slotWrite()).toEqual([{ registration_a_id: null, team_a_id: null }]);
  });

  it('refuses a team of another Tournament with the same 400 as an unknown id', async () => {
    const answers: unknown[] = [];
    for (const team of [HAWKS, NOBODY]) {
      const error = await refusal(controller.overrideSlot(TEAM_SLOT, { teamBId: team }, ADMIN));
      expect(error).toBeInstanceOf(BadRequestException);
      answers.push((error as BadRequestException).getResponse());
    }
    expect(answers[1]).toEqual(answers[0]);
    expect(slotWrite()).toEqual([]);
  });

  it.each([
    ['a Fighter into a team bracket', TEAM_SLOT, { registrationAId: ANNA }],
    ['a team into an individual bracket', OPEN_SLOT, { teamAId: LIONS }],
  ] as const)('refuses %s with the named 409, before any write', async (_story, slotId, body) => {
    const error = await refusal(controller.overrideSlot(slotId, body, ADMIN));

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      reason: 'entrant_kind_mismatch',
    });
    expect(slotWrite()).toEqual([]);
  });
});

describe('the override body', () => {
  const parse = (body: unknown) => UpdateBracketSlotDto.schema.safeParse(body);

  it.each([
    ['side a', { registrationAId: ANNA, teamAId: LIONS }, 'teamAId'],
    ['side b', { registrationBId: null, teamBId: WOLVES }, 'teamBId'],
  ])('refuses both kinds on %s (400)', (_side, body, field) => {
    const result = parse(body);

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([[field]]);
  });

  it('takes one kind per side, a side left out, and an unknown field refused', () => {
    expect(parse({ teamAId: LIONS, registrationBId: ANNA }).success).toBe(true);
    expect(parse({ teamBId: null }).success).toBe(true);
    expect(parse({}).success).toBe(true);
    expect(parse({ teamCId: LIONS }).success).toBe(false);
  });
});
