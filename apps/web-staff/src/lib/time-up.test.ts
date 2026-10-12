/**
 * The tablet beeps and vibrates each time a running clock crosses 0:00, and
 * gives a short pulse when a hit is written (quick win P13; operator,
 * 2026-10-12). The live proof is `tests/a11y/pad-time-up-cue.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TAP_PULSE_MS, TIME_UP_PATTERN, tapCue, timeUpCue } from './pad-cue';
import { crossedLimit, type ClockReading } from './time-up';

const LIMIT = 90_000;
const at = (status: ClockReading['status'], elapsedMs: number): ClockReading => ({
  status,
  elapsedMs,
});

describe('a clock crosses its limit', () => {
  it('when it ran below the limit, and is at it now', () => {
    expect(crossedLimit(at('running', 89_960), 90_000, LIMIT)).toBe(true);
  });

  it('when it ran below the limit, and is past it now', () => {
    expect(crossedLimit(at('running', 89_960), 90_010, LIMIT)).toBe(true);
  });

  // The Pause landed in the same draw as the limit: the time ran out all the same.
  it('whatever the clock does now', () => {
    expect(crossedLimit(at('running', 89_990), 90_005, LIMIT)).toBe(true);
  });

  it('once: not again at the next draw, past the limit', () => {
    expect(crossedLimit(at('running', 90_010), 90_060, LIMIT)).toBe(false);
  });

  it('not before the limit', () => {
    expect(crossedLimit(at('running', 89_900), 89_950, LIMIT)).toBe(false);
  });

  // Extra time puts time back on the clock: the limit is crossed a second time.
  it('again, after extra time put it back below the limit', () => {
    expect(crossedLimit(at('running', 95_000), 30_000, LIMIT)).toBe(false);
    expect(crossedLimit(at('halted', 30_000), 30_000, LIMIT)).toBe(false);
    expect(crossedLimit(at('running', 89_980), 90_030, LIMIT)).toBe(true);
  });

  it('never at the first reading: the screen opened on a bout past its time', () => {
    expect(crossedLimit(null, 95_000, LIMIT)).toBe(false);
  });

  // The clock is read after the screen: idle at zero, then running past its time.
  it('never from a clock that did not run at the reading before', () => {
    expect(crossedLimit(at('idle', 0), 95_000, LIMIT)).toBe(false);
    expect(crossedLimit(at('ended', 80_000), 95_000, LIMIT)).toBe(false);
  });

  it('never from a time correction on a clock that stands still', () => {
    expect(crossedLimit(at('halted', 80_000), 95_000, LIMIT)).toBe(false);
  });

  it('never in a bout with no time limit', () => {
    expect(crossedLimit(at('running', 89_960), 90_010, null)).toBe(false);
  });
});

describe('the cue of the tablet', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A browser's sound, and the tones it was asked to play. */
  function sound(resume: () => Promise<void>) {
    const played: number[] = [];
    class Context {
      currentTime = 3;
      destination = {};
      resume = resume;
      createOscillator() {
        return {
          frequency: { value: 0 },
          connect: () => undefined,
          start: () => played.push(Date.now()),
          stop: () => undefined,
        };
      }
      createGain() {
        return { gain: { value: 0 }, connect: () => undefined };
      }
    }
    return { Context, played };
  }

  it('of a hit is one short pulse, and no sound', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    tapCue();
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(TAP_PULSE_MS);
    expect(TAP_PULSE_MS).toBe(10);
  });

  it('of "time is up" is two pulses and one beep', async () => {
    const vibrate = vi.fn();
    const { Context, played } = sound(() => Promise.resolve());
    vi.stubGlobal('navigator', { vibrate });
    vi.stubGlobal('window', { AudioContext: Context });
    timeUpCue();
    await Promise.resolve();
    expect(vibrate).toHaveBeenCalledWith(TIME_UP_PATTERN);
    expect(TIME_UP_PATTERN).toEqual([200, 100, 200]);
    expect(played).toHaveLength(1);
  });

  // A browser keeps the sound of a page asleep until somebody touches the page.
  it('plays no beep when the sound starts late: not at the next touch, a minute after', async () => {
    vi.resetModules();
    let wake: () => void = () => undefined;
    const asleep = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const { Context, played } = sound(() => asleep);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', { AudioContext: Context });
    vi.useFakeTimers();
    try {
      const cue = await import('./pad-cue');
      cue.timeUpCue();
      vi.advanceTimersByTime(60_000);
      wake();
      await asleep;
      await Promise.resolve();
      expect(played).toEqual([]);

      // The sound is awake now: the next "time is up" is heard.
      cue.timeUpCue();
      await Promise.resolve();
      await Promise.resolve();
      expect(played).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says nothing on a tablet with no vibration and no sound', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {});
    expect(() => timeUpCue()).not.toThrow();
    expect(() => tapCue()).not.toThrow();
  });

  it('says nothing when the browser refuses the vibration', () => {
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('not allowed');
      },
    });
    vi.stubGlobal('window', {});
    expect(() => timeUpCue()).not.toThrow();
  });
});

describe('the bout screen', () => {
  const read = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');

  it('asks for the cue from the live time of the clock, at the limit of the phase', () => {
    expect(read('components', 'ScoringCenterControls.tsx')).toContain(
      'useTimeUpCue(status, elapsedMs, limitSeconds === null ? null : limitSeconds * 1000);',
    );
  });

  it('keeps the reading before in a ref, and writes it at every draw', () => {
    const hook = read('hooks', 'useTimeUpCue.ts');
    expect(hook).toContain('const before = useRef<ClockReading | null>(null);');
    expect(hook).toMatch(
      /const crossed = crossedLimit\(before\.current, elapsedMs, limitMs\);\s+before\.current = \{ status, elapsedMs \};\s+if \(crossed\) timeUpCue\(\);\s+\}, \[status, elapsedMs, limitMs\]\);/,
    );
  });

  it('gives the pulse of a hit only when the hit is written', () => {
    expect(read('hooks', 'useScoringSubmit.ts')).toContain("if (written === 'saved') tapCue();");
  });
});
