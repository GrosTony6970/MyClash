/**
 * Which referee compensation plan an Event may use (operator ruling 69, the
 * penalty pin's rule from rulings 64 and 66): the built-in, a shared plan, or
 * one the Event's own organisation owns.
 *
 * The story: Club B keeps a private plan, its token rates and pay tiers.
 * Mallory, admin of her own club, saved her Event's settings with Club B's plan
 * id, and her Event's pay report then computed with Club B's private rates.
 *
 * Driven through the real service over seeded tables. The refusal must come
 * before anything is written, and a missing plan gets the same answer as a
 * private one, so the refusal names no ids.
 */
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { pinnableCompensationPlan } from './compensation-plan-pin';
import { CompensationService } from './compensation.service';

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const BUILT_IN = '66666666-6666-4666-8666-666666666666';
const SHARED_B = '77777777-7777-4777-8777-777777777777';
const PRIVATE_A = '88888888-8888-4888-8888-888888888888';
const PRIVATE_B = '99999999-9999-4999-8999-999999999999';
const NOBODY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const PLANS = {
  rows: [
    { id: PRIVATE_B, organization_id: 'org-b', built_in: false, public_visibility: false },
    { id: PRIVATE_A, organization_id: 'org-a', built_in: false, public_visibility: false },
    { id: SHARED_B, organization_id: 'org-b', built_in: false, public_visibility: true },
    { id: BUILT_IN, organization_id: null, built_in: true, public_visibility: false },
  ],
};

let db: ReturnType<typeof mockSupabase>;
let service: CompensationService;

beforeEach(() => {
  db = mockSupabase({
    referee_compensation_plans: PLANS,
    events: { rows: [{ id: EVENT_A, organization_id: 'org-a' }] },
    organization_members: {
      rows: [
        { organization_id: 'org-a', user_id: 'u-admin-a', role: 'admin' },
        // Sam: admin of both clubs.
        { organization_id: 'org-a', user_id: 'u-admin-ab', role: 'admin' },
        { organization_id: 'org-b', user_id: 'u-admin-ab', role: 'admin' },
      ],
    },
    // What the save reads back: the double answers an upsert's read-back from
    // its seeded rows, so the assertions read the recorded WRITE instead.
    referee_compensation_event_settings: {
      rows: [{ event_id: EVENT_A, plan_id: BUILT_IN, referee_compensation_plans: { name: 'x' } }],
    },
  });
  service = new CompensationService({ service: db.service } as never);
});

describe('pinnableCompensationPlan', () => {
  it.each([
    ['the built-in', BUILT_IN, true],
    ["another club's shared plan", SHARED_B, true],
    ["the club's own private plan", PRIVATE_A, true],
    ["another club's private plan", PRIVATE_B, false],
    ['a plan that does not exist', NOBODY, false],
  ])('%s: %s', async (_label, planId, pinnable) => {
    await expect(pinnableCompensationPlan(db as never, planId, 'org-a')).resolves.toBe(pinnable);
  });

  it('throws on a failed read: it is not a verdict', async () => {
    const failing = mockSupabase({
      referee_compensation_plans: { data: null, error: { message: 'connection reset' } },
    });
    await expect(pinnableCompensationPlan(failing as never, PRIVATE_A, 'org-a')).rejects.toThrow(
      'connection reset',
    );
  });

  it('reads every column the decision needs', async () => {
    await pinnableCompensationPlan(db as never, PRIVATE_A, 'org-a');
    // The double hands back the whole row whatever is selected.
    expect(selectsFor(db.from, 'referee_compensation_plans')).toEqual([
      'organization_id, built_in, public_visibility',
    ]);
  });
});

describe("an Event's compensation settings save", () => {
  async function refusal(planId: string, userId: string) {
    const error = await service
      .upsertEventSettings(EVENT_A, { planId } as never, userId)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(writesTo(db, 'referee_compensation_event_settings')).toEqual([]);
    return (error as BadRequestException).getResponse();
  }

  it("refuses another club's private plan, even to an admin of both clubs, before writing", async () => {
    await refusal(PRIVATE_B, 'u-admin-a');
    await refusal(PRIVATE_B, 'u-admin-ab');
  });

  it('answers a missing plan exactly as a private one', async () => {
    expect(await refusal(NOBODY, 'u-admin-a')).toEqual(await refusal(PRIVATE_B, 'u-admin-a'));
  });

  it.each([BUILT_IN, SHARED_B, PRIVATE_A])('saves the plan %s', async (planId) => {
    await service.upsertEventSettings(EVENT_A, { planId } as never, 'u-admin-a');
    const [write] = writesTo(db, 'referee_compensation_event_settings');
    expect(write?.row).toMatchObject({ event_id: EVENT_A, plan_id: planId });
  });
});
