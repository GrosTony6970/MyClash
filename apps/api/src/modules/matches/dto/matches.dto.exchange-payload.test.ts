import { describe, expect, it } from 'vitest';
import { CreateExchangeDto } from './matches.dto';

/**
 * The exact bodies the scoring pad posts — the app used live at an event.
 *
 * The pad fills every optional field with `?? null` for the ones an exchange
 * type does not use. Every exchange goes through the outbox, so
 * `apps/web-scoring/src/offline/sync.ts` is the single post path and it builds
 * the body that way. Zod's `.optional()` accepts `undefined` only, so those
 * nulls made the schema reject a plain clean hit with a 400 — and `SyncEngine`
 * treated a 400 as terminal and DROPPED the entry. A referee's scored hit
 * vanished with nothing but a console warning.
 *
 * The old class-validator `@IsOptional()` allowed null as well as undefined, so
 * the Zod migration changed this contract without anyone noticing. These cases
 * are the pad's real payloads, copied field for field, so a future narrowing
 * fails here instead of in a venue.
 */
const schema = CreateExchangeDto.schema;

const base = {
  clientUuid: '7dde6260-3b74-4cee-9881-a71e5922bb89',
  sequence: 1,
  occurredAt: '2026-07-30T11:03:27.266Z',
  clockTimeMs: 0,
};

describe('CreateExchangeDto — the payloads the scoring pad actually sends', () => {
  it('accepts a clean hit, whose afterblow and no-exchange fields are null', () => {
    const result = schema.safeParse({
      ...base,
      type: 'clean',
      firstStrikerColor: 'red',
      firstStrikeValue: 2,
      afterblowValue: null,
      noExchangeReason: null,
    });
    expect(result.error?.issues ?? [], 'a clean hit must not be rejected').toEqual([]);
    expect(result.success).toBe(true);
  });

  it('accepts an afterblow, whose no-exchange reason is null', () => {
    const result = schema.safeParse({
      ...base,
      type: 'afterblow',
      firstStrikerColor: 'blue',
      firstStrikeValue: 2,
      afterblowValue: 1,
      noExchangeReason: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a double, which carries no striker at all', () => {
    const result = schema.safeParse({
      ...base,
      type: 'double',
      firstStrikerColor: null,
      firstStrikeValue: null,
      afterblowValue: null,
      noExchangeReason: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a no-exchange, whose strike fields are null', () => {
    const result = schema.safeParse({
      ...base,
      type: 'no_exchange',
      firstStrikerColor: null,
      firstStrikeValue: null,
      afterblowValue: null,
      noExchangeReason: 'other',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a null clock position, which is what an unstarted clock reports', () => {
    const result = schema.safeParse({
      ...base,
      clockTimeMs: null,
      type: 'clean',
      firstStrikerColor: 'red',
      firstStrikeValue: 1,
      afterblowValue: null,
      noExchangeReason: null,
    });
    expect(result.success).toBe(true);
  });

  it('still rejects a value of the wrong type, not merely a null', () => {
    // Tolerating null must not become tolerating anything: the point is that
    // "absent" may be spelled two ways, not that the field stopped being typed.
    expect(schema.safeParse({ ...base, type: 'clean', firstStrikeValue: 'two' }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...base, type: 'clean', firstStrikerColor: 'green' }).success).toBe(
      false,
    );
    // `.strict()` still refuses a field nobody declared.
    expect(schema.safeParse({ ...base, type: 'clean', bogus: 1 }).success).toBe(false);
  });
});
