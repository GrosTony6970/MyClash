import { describe, expect, it } from 'vitest';
import { DEFAULT_DURATION_MS } from './conflicts';
import { classifyTime } from './schedule-time';

const NOW = Date.UTC(2027, 4, 22, 12, 0, 0); // fixed reference "now"
const MIN = 60_000;

describe('classifyTime — fights (status-driven)', () => {
  it('is past when completed, regardless of time', () => {
    expect(classifyTime({ kind: 'fight', startMs: NOW + 60 * MIN, status: 'completed' }, NOW)).toBe(
      'past',
    );
  });

  it('is live when running', () => {
    expect(classifyTime({ kind: 'fight', startMs: NOW - 60 * MIN, status: 'running' }, NOW)).toBe(
      'live',
    );
  });

  it('is upcoming when scheduled', () => {
    expect(classifyTime({ kind: 'fight', startMs: NOW + 30 * MIN, status: 'scheduled' }, NOW)).toBe(
      'upcoming',
    );
  });

  it('stays upcoming when a scheduled fight runs late (start already passed)', () => {
    expect(classifyTime({ kind: 'fight', startMs: NOW - 30 * MIN, status: 'scheduled' }, NOW)).toBe(
      'upcoming',
    );
  });
});

describe('classifyTime — workshops (window-driven)', () => {
  it('is upcoming before it starts', () => {
    expect(
      classifyTime({ kind: 'workshop', startMs: NOW + 10 * MIN, endMs: NOW + 40 * MIN }, NOW),
    ).toBe('upcoming');
  });

  it('is live within [start, end)', () => {
    expect(
      classifyTime({ kind: 'workshop', startMs: NOW - 10 * MIN, endMs: NOW + 10 * MIN }, NOW),
    ).toBe('live');
  });

  it('is past once end has passed', () => {
    expect(
      classifyTime({ kind: 'workshop', startMs: NOW - 40 * MIN, endMs: NOW - 10 * MIN }, NOW),
    ).toBe('past');
  });

  it('falls back to the default duration when end is null', () => {
    // started 1 min ago, no end → live for DEFAULT_DURATION_MS
    expect(classifyTime({ kind: 'workshop', startMs: NOW - 1 * MIN, endMs: null }, NOW)).toBe(
      'live',
    );
    // started before the default window → past
    expect(
      classifyTime(
        { kind: 'workshop', startMs: NOW - (DEFAULT_DURATION_MS + MIN), endMs: null },
        NOW,
      ),
    ).toBe('past');
  });
});

describe('classifyTime — referee slots (default-duration window)', () => {
  it('is upcoming before start', () => {
    expect(classifyTime({ kind: 'referee', startMs: NOW + 5 * MIN }, NOW)).toBe('upcoming');
  });

  it('is live within the default window after start', () => {
    expect(classifyTime({ kind: 'referee', startMs: NOW - 1 * MIN }, NOW)).toBe('live');
  });

  it('is past after the default window', () => {
    expect(classifyTime({ kind: 'referee', startMs: NOW - (DEFAULT_DURATION_MS + MIN) }, NOW)).toBe(
      'past',
    );
  });
});

describe('classifyTime — TBD (no start time)', () => {
  it('treats a null start as upcoming', () => {
    expect(classifyTime({ kind: 'workshop', startMs: null }, NOW)).toBe('upcoming');
    expect(classifyTime({ kind: 'referee', startMs: NaN }, NOW)).toBe('upcoming');
  });
});
