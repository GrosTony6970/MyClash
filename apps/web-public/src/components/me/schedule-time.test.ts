import { describe, expect, it } from 'vitest';
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

describe('classifyTime — fights under a time simulation (window-driven)', () => {
  // With a simulated clock, match statuses describe a moment hours away, so a
  // *scheduled* fight falls back to its slot window — this is what makes the
  // LIVE / NEXT badges move while simulating.
  it('is live inside its planned window', () => {
    expect(
      classifyTime(
        { kind: 'fight', startMs: NOW - 1 * MIN, endMs: NOW + 4 * MIN, status: 'scheduled' },
        NOW,
        true,
      ),
    ).toBe('live');
  });

  it('is upcoming before its slot', () => {
    expect(
      classifyTime({ kind: 'fight', startMs: NOW + 30 * MIN, status: 'scheduled' }, NOW, true),
    ).toBe('upcoming');
  });

  it('is past once its planned window has elapsed — so NEXT advances', () => {
    expect(
      classifyTime(
        { kind: 'fight', startMs: NOW - 9 * MIN, endMs: NOW - 1 * MIN, status: 'scheduled' },
        NOW,
        true,
      ),
    ).toBe('past');
  });

  it('still lets real statuses win — completed stays past, running stays live', () => {
    expect(
      classifyTime({ kind: 'fight', startMs: NOW + 60 * MIN, status: 'completed' }, NOW, true),
    ).toBe('past');
    expect(
      classifyTime({ kind: 'fight', startMs: NOW - 60 * MIN, status: 'running' }, NOW, true),
    ).toBe('live');
  });

  it('leaves a TBD fight upcoming (it sorts last, so it only becomes NEXT alone)', () => {
    expect(classifyTime({ kind: 'fight', startMs: null, status: 'scheduled' }, NOW, true)).toBe(
      'upcoming',
    );
  });

  it('is inert when the simulation flag is off — the real-event rule is unchanged', () => {
    // Same inputs as the "past"/"live" cases above, without the flag.
    expect(classifyTime({ kind: 'fight', startMs: NOW - 1 * MIN, status: 'scheduled' }, NOW)).toBe(
      'upcoming',
    );
    expect(
      classifyTime(
        { kind: 'fight', startMs: NOW - 9 * MIN, endMs: NOW - 1 * MIN, status: 'scheduled' },
        NOW,
      ),
    ).toBe('upcoming');
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

  it('is past as soon as it starts when its end is unknown — never live for a guessed length', () => {
    expect(classifyTime({ kind: 'workshop', startMs: NOW - 1 * MIN, endMs: null }, NOW)).toBe(
      'past',
    );
    expect(classifyTime({ kind: 'workshop', startMs: NOW + 1 * MIN, endMs: null }, NOW)).toBe(
      'upcoming',
    );
  });
});

describe('classifyTime — referee slots (the window the API works out)', () => {
  it('is upcoming before start', () => {
    expect(
      classifyTime({ kind: 'referee', startMs: NOW + 5 * MIN, endMs: NOW + 40 * MIN }, NOW),
    ).toBe('upcoming');
  });

  it('is live for its whole window, past the five minutes it used to be given', () => {
    expect(
      classifyTime({ kind: 'referee', startMs: NOW - 20 * MIN, endMs: NOW + 20 * MIN }, NOW),
    ).toBe('live');
  });

  it('is past once its end has passed, and from its start when the end is unknown', () => {
    expect(
      classifyTime({ kind: 'referee', startMs: NOW - 40 * MIN, endMs: NOW - 1 * MIN }, NOW),
    ).toBe('past');
    expect(classifyTime({ kind: 'referee', startMs: NOW - 1 * MIN }, NOW)).toBe('past');
  });
});

describe('classifyTime — TBD (no start time)', () => {
  it('treats a null start as upcoming', () => {
    expect(classifyTime({ kind: 'workshop', startMs: null }, NOW)).toBe('upcoming');
    expect(classifyTime({ kind: 'referee', startMs: NaN }, NOW)).toBe('upcoming');
  });
});
