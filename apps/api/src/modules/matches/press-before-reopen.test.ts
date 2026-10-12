import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { assertPressedAfterBackInPlay } from './press-before-reopen';

const MARK = '2026-04-25T10:10:00.000Z';
const at = (clock: string) => Date.parse(`2026-04-25T${clock}.000Z`);

describe('a press and the last time its bout was put back in play', () => {
  it('is taken on a bout never put back in play', () => {
    expect(() => assertPressedAfterBackInPlay('m1', null, at('10:05:00'))).not.toThrow();
  });

  it('is taken when it was made after', () => {
    expect(() => assertPressedAfterBackInPlay('m1', MARK, at('10:10:01'))).not.toThrow();
  });

  it.each([
    ['before', '10:05:00'],
    ['at the same moment', '10:10:00'],
  ])('is refused with its code when it was made %s', (_, clock) => {
    let refusal: HttpException | undefined;
    try {
      assertPressedAfterBackInPlay('m1', MARK, at(clock));
    } catch (thrown) {
      refusal = thrown as HttpException;
    }

    expect(refusal?.getStatus()).toBe(409);
    expect(refusal?.getResponse()).toMatchObject({ code: 'pressed_before_reopen' });
  });

  it('reads a time the database says with an offset', () => {
    expect(() =>
      assertPressedAfterBackInPlay('m1', '2026-04-25T12:10:00+02:00', at('10:05:00')),
    ).toThrow('pressed before the bout was put back in play');
  });

  it.each([
    ['does not carry the column', undefined],
    ['carries a time that cannot be read', 'not a time'],
  ])('is a plain error, not "never" and not a refusal, when the read %s', (_, read) => {
    let thrown: unknown;
    try {
      assertPressedAfterBackInPlay('m1', read, at('10:05:00'));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual(new Error('Could not read when bout m1 was last put back in play'));
    expect(thrown).not.toBeInstanceOf(HttpException);
  });
});
