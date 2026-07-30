import { describe, expect, it } from 'vitest';
import { CreatePenaltyDto } from './penalties.dto';

/**
 * The exact bodies the scoring pad posts when a referee cards a fighter.
 *
 * Sibling of `matches/dto/matches.dto.exchange-payload.test.ts`, and for the
 * same reason: the pad reports its clock position as
 * `clockState?.activeMs ?? null` (`MatchView.tsx`), and passes that straight
 * into BOTH penalty paths — the per-side ruleset-entry picker
 * (`ScoringColumn.submitPenalty`) and the corrections drawer's direct card
 * (`MatchCorrectionsDrawer`). `clockState` is null until `GET /matches/:id/clock`
 * resolves, and stays null if it fails, so a card really can carry a null.
 *
 * Zod's `.optional()` accepts undefined only. That is what made every exchange
 * type unrecordable in production; the exchange schema was fixed and this one,
 * declared eight lines away, was left as it was. These cases pin the pad's real
 * payloads so a future narrowing fails here instead of in a venue.
 */
const schema = CreatePenaltyDto.schema;

const base = {
  clientUuid: 'c0ffee00-1c4f-4d0b-9d1e-2b1f0a5e77d3',
  sequence: 1,
  registrationId: '8f14e45f-ce53-4b6e-8f3a-0d2c7a91b4e6',
  occurredAt: '2026-07-30T11:03:27.266Z',
};

describe('CreatePenaltyDto — the payloads the scoring pad actually sends', () => {
  it('accepts a ruleset-entry card whose clock position is null', () => {
    const result = schema.safeParse({
      ...base,
      rulesetEntryId: '3d4f2b1a-6e5c-4a8d-9b7f-1c2e3a4b5d6f',
      clockTimeMs: null,
    });
    expect(result.error?.issues ?? [], 'a card must not be rejected for a null clock').toEqual([]);
    expect(result.success).toBe(true);
  });

  it('accepts a direct referee card whose clock position is null', () => {
    const result = schema.safeParse({
      ...base,
      directCard: 'yellow',
      reason: 'Excessive force',
      clockTimeMs: null,
    });
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('still accepts a real clock position', () => {
    expect(
      schema.safeParse({
        ...base,
        rulesetEntryId: '3d4f2b1a-6e5c-4a8d-9b7f-1c2e3a4b5d6f',
        clockTimeMs: 0,
      }).success,
    ).toBe(true);
  });

  it('still rejects a clock position of the wrong shape, not merely a null', () => {
    // Tolerating null must not become tolerating anything: "absent" may be
    // spelled two ways, the field has not stopped being typed.
    const entry = { ...base, rulesetEntryId: '3d4f2b1a-6e5c-4a8d-9b7f-1c2e3a4b5d6f' };
    expect(schema.safeParse({ ...entry, clockTimeMs: '0' }).success).toBe(false);
    expect(schema.safeParse({ ...entry, clockTimeMs: -1 }).success).toBe(false);
    expect(schema.safeParse({ ...entry, clockTimeMs: 1.5 }).success).toBe(false);
  });

  it('keeps the two conditional rules a null clock must not weaken', () => {
    // Neither identifier given.
    expect(schema.safeParse({ ...base, clockTimeMs: null }).success).toBe(false);
    // A direct card still needs a reason.
    expect(schema.safeParse({ ...base, directCard: 'red', clockTimeMs: null }).success).toBe(false);
    // `.strict()` still refuses a field nobody declared.
    expect(
      schema.safeParse({
        ...base,
        rulesetEntryId: '3d4f2b1a-6e5c-4a8d-9b7f-1c2e3a4b5d6f',
        bogus: 1,
      }).success,
    ).toBe(false);
  });
});
