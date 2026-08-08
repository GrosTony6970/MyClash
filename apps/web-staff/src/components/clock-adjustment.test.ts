import { describe, expect, it } from 'vitest';
import { clockAdjustmentMs } from './clock-adjustment';

describe('clockAdjustmentMs', () => {
  it('countdown within the limit: add raises the displayed remaining, subtract lowers it', () => {
    // elapsed 26.7s of a 90s limit → display 63.3s remaining.
    expect(
      clockAdjustmentMs({
        timerMode: 'countdown',
        direction: 'add',
        seconds: 10,
        elapsedMs: 26_700,
        limitMs: 90_000,
      }),
    ).toBe(-10_000);
    expect(
      clockAdjustmentMs({
        timerMode: 'countdown',
        direction: 'subtract',
        seconds: 10,
        elapsedMs: 26_700,
        limitMs: 90_000,
      }),
    ).toBe(10_000);
  });

  it('countdown overshot past zero: add anchors to the DISPLAY so 0:00 + 10s lands on exactly 0:10', () => {
    // Clock ran 10s past the 90s limit (elapsed 100s, display pinned 0:00).
    // A naive -10s would leave display at 0 — the silent-fail case.
    expect(
      clockAdjustmentMs({
        timerMode: 'countdown',
        direction: 'add',
        seconds: 10,
        elapsedMs: 100_000,
        limitMs: 90_000,
      }),
    ).toBe(-20_000); // elapsed 100s → 80s ⇒ display 10s
  });

  it('countdown subtract at 0:00 keeps the display at zero (never negative remaining)', () => {
    const adj = clockAdjustmentMs({
      timerMode: 'countdown',
      direction: 'subtract',
      seconds: 10,
      elapsedMs: 100_000,
      limitMs: 90_000,
    });
    // New elapsed = limit (display exactly 0), not beyond.
    expect(100_000 + adj).toBe(90_000);
  });

  it('countdown add cannot exceed the full limit (display caps at the phase time)', () => {
    const adj = clockAdjustmentMs({
      timerMode: 'countdown',
      direction: 'add',
      seconds: 10,
      elapsedMs: 5_000,
      limitMs: 90_000,
    });
    expect(5_000 + adj).toBe(0); // elapsed floors at 0 ⇒ display = full 90s
  });

  it('countup (or no limit): add/subtract apply directly to the displayed elapsed time', () => {
    expect(
      clockAdjustmentMs({
        timerMode: 'countup',
        direction: 'add',
        seconds: 10,
        elapsedMs: 26_700,
        limitMs: null,
      }),
    ).toBe(10_000);
    expect(
      clockAdjustmentMs({
        timerMode: 'countdown',
        direction: 'subtract',
        seconds: 10,
        elapsedMs: 26_700,
        limitMs: null, // no limit configured → behaves like countup
      }),
    ).toBe(-10_000);
  });
});
