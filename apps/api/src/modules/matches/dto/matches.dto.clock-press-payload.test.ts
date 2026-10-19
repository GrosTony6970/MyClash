import { describe, expect, it } from 'vitest';
import { ClockActionDto } from './matches.dto';

/**
 * The exact body the scoring pad posts for a queued clock press (`postPress` in
 * `apps/web-staff/src/offline/press-send.ts`; the pad's own test `press-send.test.ts` pins the
 * same keys with `toEqual`).
 *
 * The pad's browser tests run on a stubbed server, which takes any body. A key the strict schema
 * refuses would be a 400 at a venue, and the pad holds a press at its first 400 with every row of
 * its bout behind it. So a Start's two keys of the copy it was pressed under are allowed on every
 * action, each without the other: only the server's reading of them depends on the action.
 */
const schema = ClockActionDto.schema;

const press = {
  action: 'start',
  clientUuid: '7dde6260-3b74-4cee-9881-a71e5922bb89',
  pressedAt: '2026-10-10T10:00:00.000Z',
  sentAt: '2026-10-10T10:20:00.000Z',
};
const startedUnder = { rulesId: 'c0000000-0000-4000-8000-00000000000a' };

describe('ClockActionDto: the body the scoring pad sends', () => {
  it('takes a Start that names the copy its screen showed, pressed with no network', () => {
    const result = schema.safeParse({ ...press, startedUnder, pressedWithoutNetwork: true });
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it('takes each key without the other, and a Start with neither (a tablet of before)', () => {
    expect(schema.safeParse({ ...press, startedUnder }).success).toBe(true);
    expect(schema.safeParse({ ...press, pressedWithoutNetwork: true }).success).toBe(true);
    expect(schema.safeParse(press).success).toBe(true);
  });

  it('takes a Halt that carries them: never a 400 over a key the server does not read', () => {
    const halt = { ...press, action: 'halt', startedUnder, pressedWithoutNetwork: false };
    expect(schema.safeParse(halt).success).toBe(true);
  });

  it('refuses a copy that is no id, and any other key beside it', () => {
    expect(schema.safeParse({ ...press, startedUnder: { rulesId: 'A; drop' } }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ ...press, startedUnder: { ...startedUnder, code: 'TF_v1' } }).success,
    ).toBe(false);
  });

  it('takes a press with a network as before', () => {
    expect(schema.safeParse({ action: 'reopen', discardDependentResults: true }).success).toBe(
      true,
    );
  });
});
