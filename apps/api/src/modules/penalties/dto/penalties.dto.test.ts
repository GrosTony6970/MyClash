import { describe, expect, it } from 'vitest';
import { createPenaltySchema } from './penalties.dto';

const base = {
  clientUuid: '11111111-1111-4111-8111-111111111111',
  sequence: 1,
  registrationId: '22222222-2222-4222-8222-222222222222',
  occurredAt: '2026-06-23T18:00:00.000Z',
};

describe('createPenaltySchema', () => {
  it('accepts a ruleset-entry penalty', () => {
    expect(
      createPenaltySchema.safeParse({
        ...base,
        rulesetEntryId: '33333333-3333-4333-8333-333333333333',
      }).success,
    ).toBe(true);
  });

  it('accepts a direct card with a reason', () => {
    expect(
      createPenaltySchema.safeParse({ ...base, directCard: 'red', reason: 'referee decision' })
        .success,
    ).toBe(true);
  });

  it('rejects when neither rulesetEntryId nor directCard is provided', () => {
    expect(createPenaltySchema.safeParse({ ...base }).success).toBe(false);
  });

  it('rejects a direct card without a reason', () => {
    expect(createPenaltySchema.safeParse({ ...base, directCard: 'black' }).success).toBe(false);
  });

  it('rejects unknown fields (strict)', () => {
    expect(
      createPenaltySchema.safeParse({ ...base, directCard: 'red', reason: 'x', sneaky: true })
        .success,
    ).toBe(false);
  });

  it('rejects an invalid card value', () => {
    expect(
      createPenaltySchema.safeParse({ ...base, directCard: 'green', reason: 'x' }).success,
    ).toBe(false);
  });
});
