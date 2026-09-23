/**
 * Which penalty ruleset an Event of an organisation may pin (operator rulings
 * 64 and 66).
 *
 * A published Tournament's `penalty_ruleset_id` is public, and the Tournament's
 * ruleset is readable by every member of its organisation. So a pin that took
 * any id let an organisation admin copy another organisation's private ruleset
 * onto a Tournament of their own and read it there. A pin now accepts the
 * built-in, a shared ruleset, or one the Event's own organisation owns — never
 * "any ruleset the caller may read": an admin of two organisations would
 * otherwise hand one organisation's private rules to the other's members.
 *
 * One owner for the four pin doors (the Event default, the Tournament pin,
 * Tournament create and Tournament edit); `penalty-pin.doors.test.ts` holds each
 * door to it.
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { loadPinnablePenaltyRulesetVersion } from './penalty-version.util';

const BUILT_IN = '66666666-6666-4666-8666-666666666666';
const SHARED_B = '77777777-7777-4777-8777-777777777777';
const PRIVATE_A = '88888888-8888-4888-8888-888888888888';
const PRIVATE_B = '99999999-9999-4999-8999-999999999999';
const NOBODY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function seeded() {
  return mockSupabase({
    penalty_rulesets: {
      rows: [
        {
          id: PRIVATE_B,
          version: '1.0.4',
          built_in: false,
          public_visibility: false,
          owner_organization_id: 'org-b',
        },
        {
          id: PRIVATE_A,
          version: '2.1.0',
          built_in: false,
          public_visibility: false,
          owner_organization_id: 'org-a',
        },
        {
          id: SHARED_B,
          version: '3.0.0',
          built_in: false,
          public_visibility: true,
          owner_organization_id: 'org-b',
        },
        {
          id: BUILT_IN,
          version: '1.0.0',
          built_in: true,
          public_visibility: false,
          owner_organization_id: null,
        },
      ],
    },
  });
}

async function refusal(rulesetId: string, organizationId: string) {
  const error = await loadPinnablePenaltyRulesetVersion(
    seeded() as never,
    rulesetId,
    organizationId,
  ).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BadRequestException);
  return (error as BadRequestException).getResponse();
}

describe('loadPinnablePenaltyRulesetVersion', () => {
  it.each([
    ['the built-in', BUILT_IN, '1.0.0'],
    ["another organisation's shared ruleset", SHARED_B, '3.0.0'],
    ["the organisation's own private ruleset", PRIVATE_A, '2.1.0'],
  ])('pins %s at its current version', async (_label, rulesetId, version) => {
    await expect(
      loadPinnablePenaltyRulesetVersion(seeded() as never, rulesetId, 'org-a'),
    ).resolves.toBe(version);
  });

  it("refuses another organisation's private ruleset", async () => {
    await refusal(PRIVATE_B, 'org-a');
  });

  it('answers a missing ruleset exactly as a private one, so the refusal names no ids', async () => {
    expect(await refusal(NOBODY, 'org-a')).toEqual(await refusal(PRIVATE_B, 'org-a'));
  });

  it('refuses on a failed read, and does not call it a verdict', async () => {
    // The old loader pinned no version when its read failed.
    const db = mockSupabase({
      penalty_rulesets: { data: null, error: { message: 'connection reset' } },
    });
    const error = await loadPinnablePenaltyRulesetVersion(db as never, PRIVATE_A, 'org-a').catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe('connection reset');
  });

  it('reads every column the decision needs', async () => {
    const db = seeded();
    await loadPinnablePenaltyRulesetVersion(db as never, PRIVATE_A, 'org-a');
    // The double hands back the whole row whatever is selected.
    expect(selectsFor(db.from, 'penalty_rulesets')).toEqual([
      'version, built_in, public_visibility, owner_organization_id',
    ]);
  });
});
