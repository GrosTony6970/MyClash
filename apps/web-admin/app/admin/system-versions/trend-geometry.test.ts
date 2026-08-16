import { describe, expect, it } from 'vitest';
import {
  axisTicks,
  buildSegments,
  gapThresholdMs,
  latestValue,
  nearestIndex,
  nextHoverIndex,
  pointAt,
  ratioPct,
  readingsAt,
  windowDomain,
  xFraction,
  type Reading,
} from './trend-geometry';

const HOUR = 3_600_000;
const QUARTER = 900_000; // the collector's default cadence: 15 min
const SINCE = '2026-08-16T00:00:00.000Z';
const DOMAIN = windowDomain(SINCE, 24);
const BOX = { width: 100, height: 24 };

/** Readings on a regular cadence, starting `offsetMs` into the window. */
function cadence(count: number, offsetMs = 0, step = QUARTER): Reading[] {
  return Array.from({ length: count }, (_, i) => ({
    t: DOMAIN.start + offsetMs + i * step,
    v: i,
  }));
}

/** The x coordinates a path string visits, in order. */
function xs(d: string): number[] {
  return Array.from(d.matchAll(/[ML](-?[\d.]+),/g), (m) => Number(m[1]));
}

describe('windowDomain', () => {
  it('spans the full requested window from the server since', () => {
    expect(DOMAIN.end - DOMAIN.start).toBe(24 * HOUR);
    expect(DOMAIN.start).toBe(Date.parse(SINCE));
  });

  it('refuses a since it cannot parse rather than drawing against NaN', () => {
    expect(() => windowDomain('not a date', 24)).toThrow(/unparseable/);
  });
});

describe('xFraction', () => {
  it('places a timestamp by its share of the window', () => {
    expect(xFraction(DOMAIN.start + 6 * HOUR, DOMAIN)).toBeCloseTo(0.25, 10);
    expect(xFraction(DOMAIN.start + 12 * HOUR, DOMAIN)).toBeCloseTo(0.5, 10);
  });

  it('clamps outside the window instead of drawing off the strip', () => {
    expect(xFraction(DOMAIN.start - HOUR, DOMAIN)).toBe(0);
    expect(xFraction(DOMAIN.end + HOUR, DOMAIN)).toBe(1);
  });
});

describe('buildSegments', () => {
  it('spaces points by time, not by sample number', () => {
    // Three readings 12 hours apart: the middle one belongs at the middle of
    // the strip. Index spacing would agree here by accident...
    const even: Reading[] = [
      { t: DOMAIN.start, v: 1 },
      { t: DOMAIN.start + 12 * HOUR, v: 2 },
      { t: DOMAIN.start + 24 * HOUR, v: 3 },
    ];
    expect(xs(buildSegments(even, DOMAIN, { ...BOX, maxGapMs: 24 * HOUR })[0]!)).toEqual([
      0, 50, 100,
    ]);
  });

  it('leaves a hole in the history empty instead of closing it', () => {
    // ...and disagree here. Three readings, but the middle one is 1 hour in,
    // not 12: with index spacing it would still land at x=50 and the missing
    // 23 hours would vanish.
    const skewed: Reading[] = [
      { t: DOMAIN.start, v: 1 },
      { t: DOMAIN.start + HOUR, v: 2 },
      { t: DOMAIN.start + 24 * HOUR, v: 3 },
    ];
    const drawn = xs(buildSegments(skewed, DOMAIN, { ...BOX, maxGapMs: 25 * HOUR })[0]!);
    expect(drawn[1]).toBeCloseTo(100 / 24, 2);
    expect(drawn).not.toContain(50);
  });

  it('draws one unbroken line on a normal cadence', () => {
    const readings = cadence(20);
    const segments = buildSegments(readings, DOMAIN, {
      ...BOX,
      maxGapMs: gapThresholdMs(readings.map((r) => r.t)),
    });
    expect(segments).toHaveLength(1);
  });

  it('breaks the line where the collector stopped answering', () => {
    const before = cadence(8);
    const after = cadence(8, 8 * QUARTER + 3 * HOUR);
    const readings = [...before, ...after];
    const segments = buildSegments(readings, DOMAIN, {
      ...BOX,
      maxGapMs: gapThresholdMs(readings.map((r) => r.t)),
    });
    expect(segments).toHaveLength(2);
  });

  it('keeps a null reading a gap, never a zero', () => {
    const readings: Reading[] = [
      { t: DOMAIN.start, v: 40 },
      { t: DOMAIN.start + QUARTER, v: 42 },
      { t: DOMAIN.start + 2 * QUARTER, v: null },
      { t: DOMAIN.start + 3 * QUARTER, v: 41 },
      { t: DOMAIN.start + 4 * QUARTER, v: 43 },
    ];
    const segments = buildSegments(readings, DOMAIN, { ...BOX, maxGapMs: 10 * QUARTER });
    expect(segments).toHaveLength(2);
    // Nothing is plotted at the missing reading's own timestamp — a null drawn
    // as a zero would put a point there, at the floor of the box.
    const missingX = Number(((2 * QUARTER) / (24 * HOUR)) * 100).toFixed(2);
    expect(segments.join(' ')).not.toContain(missingX);
  });

  it('draws a flat series mid-height rather than dividing by zero', () => {
    const flat: Reading[] = [
      { t: DOMAIN.start, v: 7 },
      { t: DOMAIN.start + QUARTER, v: 7 },
    ];
    const d = buildSegments(flat, DOMAIN, { ...BOX, maxGapMs: 10 * QUARTER })[0]!;
    expect(d).not.toMatch(/NaN/);
    expect(d).toContain('24.00'); // (7-7)/1 = 0 of the height, measured from the top
  });

  it('draws nothing from a single point, which has no direction', () => {
    expect(buildSegments([{ t: DOMAIN.start, v: 5 }], DOMAIN, { ...BOX, maxGapMs: HOUR })).toEqual(
      [],
    );
  });

  it('keeps a young history in its own corner of the window', () => {
    // Three samples, 45 minutes of history, 24 hours of strip.
    const young = cadence(3, 0);
    const drawn = xs(buildSegments(young, DOMAIN, { ...BOX, maxGapMs: 2 * QUARTER })[0]!);
    expect(Math.max(...drawn)).toBeLessThan(100 / 24);
  });
});

describe('gapThresholdMs', () => {
  it('tolerates one skipped tick and breaks on two', () => {
    const threshold = gapThresholdMs(cadence(10).map((r) => r.t));
    expect(2 * QUARTER).toBeLessThan(threshold);
    expect(3 * QUARTER).toBeGreaterThan(threshold);
  });

  it('never falls below two minutes, however tight the samples', () => {
    expect(gapThresholdMs([0, 1000, 2000, 3000])).toBe(120_000);
  });

  it('has no threshold to give from a single sample', () => {
    expect(gapThresholdMs([DOMAIN.start])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('axisTicks', () => {
  it('returns evenly spaced times across the whole window', () => {
    const ticks = axisTicks(DOMAIN, 5);
    expect(ticks).toHaveLength(5);
    expect(ticks[0]).toBe(DOMAIN.start);
    expect(ticks[4]).toBe(DOMAIN.end);
    expect(ticks[1]! - ticks[0]!).toBe(6 * HOUR);
    expect(ticks[2]! - ticks[1]!).toBe(6 * HOUR);
  });
});

describe('nearestIndex', () => {
  const times = cadence(5).map((r) => r.t); // 0, 15, 30, 45, 60 min

  it('picks the sample closest in time to the cursor', () => {
    // 32 minutes in: nearer the 30-minute sample than the 45-minute one.
    expect(nearestIndex(32 / (24 * 60), times, DOMAIN)).toBe(2);
  });

  it('clamps to the ends rather than falling off them', () => {
    expect(nearestIndex(-1, times, DOMAIN)).toBe(0);
    expect(nearestIndex(2, times, DOMAIN)).toBe(times.length - 1);
  });

  it('reports nothing when there are no samples', () => {
    expect(nearestIndex(0.5, [], DOMAIN)).toBeNull();
  });
});

describe('readingsAt', () => {
  const pct = (v: number) => `${v.toFixed(0)} %`;
  const series = [
    { label: 'DB connections', values: [26, 27], format: pct },
    { label: 'Redis memory', values: [null, 1], format: pct },
  ];

  it('reads every series at the same sample', () => {
    expect(readingsAt(series, 1)).toEqual([
      { label: 'DB connections', value: '27 %' },
      { label: 'Redis memory', value: '1 %' },
    ]);
  });

  it('shows a missing reading as a dash, never as a number', () => {
    expect(readingsAt(series, 0)[1]).toEqual({ label: 'Redis memory', value: '—' });
  });
});

describe('pointAt', () => {
  it('places the hover dot on the line it belongs to', () => {
    const readings: Reading[] = [
      { t: DOMAIN.start, v: 0 },
      { t: DOMAIN.start + 12 * HOUR, v: 10 },
    ];
    expect(pointAt(readings, 1, DOMAIN, BOX)).toEqual({ x: 50, y: 0 });
  });

  it('has no dot to place on a missing reading', () => {
    const readings: Reading[] = [
      { t: DOMAIN.start, v: 1 },
      { t: DOMAIN.start + HOUR, v: null },
      { t: DOMAIN.start + 2 * HOUR, v: 3 },
    ];
    expect(pointAt(readings, 1, DOMAIN, BOX)).toBeNull();
  });
});

describe('nextHoverIndex', () => {
  it('starts from the latest sample, matching the value column', () => {
    expect(nextHoverIndex('ArrowLeft', null, 10)).toBe(8);
    expect(nextHoverIndex('ArrowRight', null, 10)).toBe(9);
  });

  it('steps one sample at a time and stops at the ends', () => {
    expect(nextHoverIndex('ArrowLeft', 5, 10)).toBe(4);
    expect(nextHoverIndex('ArrowLeft', 0, 10)).toBe(0);
    expect(nextHoverIndex('ArrowRight', 9, 10)).toBe(9);
  });

  it('jumps to either end', () => {
    expect(nextHoverIndex('Home', 5, 10)).toBe(0);
    expect(nextHoverIndex('End', 5, 10)).toBe(9);
  });

  it('clears on Escape', () => {
    expect(nextHoverIndex('Escape', 5, 10)).toBeNull();
  });

  it('leaves every other key alone, so Tab still escapes the strip', () => {
    expect(nextHoverIndex('Tab', 5, 10)).toBeUndefined();
    expect(nextHoverIndex('a', 5, 10)).toBeUndefined();
  });
});

describe('ratioPct', () => {
  it('reads a capacity pair as a percentage', () => {
    expect(ratioPct(25, 100)).toBe(25);
  });

  it('refuses an unlimited capacity rather than drawing it as 0 %', () => {
    // Redis reports maxmemory 0 for "unlimited". 0 % would read as headroom.
    expect(ratioPct(500, 0)).toBeNull();
  });

  it('reports nothing when either side is missing', () => {
    expect(ratioPct(null, 100)).toBeNull();
    expect(ratioPct(50, null)).toBeNull();
  });
});

describe('latestValue', () => {
  it('skips trailing gaps to the last real reading', () => {
    expect(latestValue([1, 2, null, null])).toBe(2);
  });

  it('reports nothing when a series never answered', () => {
    expect(latestValue([null, null])).toBeNull();
  });
});
