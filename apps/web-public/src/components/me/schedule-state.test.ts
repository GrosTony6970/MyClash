import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  departuresSoFar,
  forgetSchedule,
  forgetSchedules,
  keepSchedule,
  keptSchedule,
  type ScheduleCopy,
} from './schedule-copy';
import {
  copyAfterRead,
  SCHEDULE_LOADING,
  scheduleAfterRead,
  scheduleFromCopy,
} from './schedule-state';

/**
 * The schedule says how old it is, and survives a hall with no signal (quick
 * win F10; operator ruling 2026-10-13: the phone keeps a copy, and the copy
 * leaves with its person).
 */
const AT_14_02 = 1_800_000_000_000;
const LATER = AT_14_02 + 60_000;
const paul = { personId: 'paul' };
const copyOfPaul: ScheduleCopy<typeof paul> = { schedule: paul, fetchedAt: AT_14_02 };

describe('what the page shows after an answer', () => {
  const fromCopy = scheduleFromCopy(copyOfPaul);

  it('before any answer: the copy at once, with its own time; with none, loading', () => {
    expect(fromCopy).toEqual({
      state: 'shown',
      schedule: paul,
      updatedAt: AT_14_02,
      offline: false,
    });
    expect(scheduleFromCopy(null)).toBe(SCHEDULE_LOADING);
  });

  it('a schedule from the server is shown, timed now', () => {
    const fresh = { personId: 'paul', bouts: 2 };
    expect(scheduleAfterRead(fromCopy, { kind: 'data', data: fresh }, LATER)).toEqual({
      state: 'shown',
      schedule: fresh,
      updatedAt: LATER,
      offline: false,
    });
  });

  it('a failed read keeps what is on screen, with its OLD time, and says offline', () => {
    expect(scheduleAfterRead(fromCopy, { kind: 'failed' }, LATER)).toEqual({
      state: 'shown',
      schedule: paul,
      updatedAt: AT_14_02,
      offline: true,
    });
  });

  it('a failed read with nothing on screen is "failed": the page offers Retry', () => {
    expect(scheduleAfterRead(SCHEDULE_LOADING, { kind: 'failed' }, LATER).state).toBe('failed');
  });

  it('a 401 shows NO schedule, whatever was on screen', () => {
    expect(scheduleAfterRead(fromCopy, { kind: 'signedOut' }, LATER)).toEqual({
      state: 'signedOut',
      schedule: null,
      updatedAt: null,
      offline: false,
    });
  });

  it('a failed read after a 401 keeps the doors: the page does not turn to "could not load"', () => {
    const doors = scheduleAfterRead(fromCopy, { kind: 'signedOut' }, LATER);
    expect(scheduleAfterRead(doors, { kind: 'failed' }, LATER)).toEqual(doors);
  });

  it('a read that lands after a failure is no longer offline', () => {
    const offline = scheduleAfterRead(fromCopy, { kind: 'failed' }, LATER);
    expect(scheduleAfterRead(offline, { kind: 'data', data: paul }, LATER).offline).toBe(false);
  });
});

describe('what an answer does to the copy on the phone', () => {
  it('a schedule is written with its time; a 401 removes the copy; a failure leaves it', () => {
    expect(copyAfterRead({ kind: 'data', data: paul }, LATER)).toEqual({
      write: { schedule: paul, fetchedAt: LATER },
    });
    expect(copyAfterRead({ kind: 'signedOut' }, LATER)).toBe('forget');
    expect(copyAfterRead({ kind: 'failed' }, LATER)).toBe('leave');
  });
});

function fakeStore(seed: Record<string, string> = {}) {
  const held = new Map(Object.entries(seed));
  return {
    held,
    get length() {
      return held.size;
    },
    key: (index: number) => [...held.keys()][index] ?? null,
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
  };
}

describe('the copy', () => {
  it('is kept and read back per Event', () => {
    const store = fakeStore();
    keepSchedule('open-de-lyon', copyOfPaul, store);
    expect(keptSchedule('open-de-lyon', store)).toEqual(copyOfPaul);
    expect(keptSchedule('another-event', store)).toBeNull();
  });

  it('a broken or half-written copy reads as none', () => {
    const store = fakeStore({
      'myclash:schedule:a': '{not json',
      'myclash:schedule:b': JSON.stringify({ schedule: paul }),
      'myclash:schedule:c': 'null',
    });
    for (const key of ['a', 'b', 'c']) expect(keptSchedule(key, store)).toBeNull();
  });

  it('forgetting one Event leaves the others; forgetting all leaves what is not a schedule', () => {
    const store = fakeStore({ mc_theme: 'dark' });
    keepSchedule('a', copyOfPaul, store);
    keepSchedule('b', copyOfPaul, store);
    forgetSchedule('a', store);
    expect([...store.held.keys()]).toEqual(['mc_theme', 'myclash:schedule:b']);
    keepSchedule('a', copyOfPaul, store);
    forgetSchedules(store);
    expect([...store.held.keys()]).toEqual(['mc_theme']);
  });

  it('works with no store at all, and with one that throws', () => {
    expect(keptSchedule('a', null)).toBeNull();
    keepSchedule('a', copyOfPaul, null);
    forgetSchedules(null);
    const broken = {
      length: 1,
      key: () => {
        throw new Error('blocked');
      },
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(keptSchedule('a', broken)).toBeNull();
    expect(() => keepSchedule('a', copyOfPaul, broken)).not.toThrow();
    expect(() => forgetSchedule('a', broken)).not.toThrow();
    expect(() => forgetSchedules(broken)).not.toThrow();
  });
});

/** This package's vitest does not compile TSX, so the doors are read as text. */
describe('the copy leaves the phone with its person', () => {
  const WP = join(__dirname, '..', '..', '..');
  const read = (...path: string[]) => readFileSync(join(WP, ...path), 'utf8');

  it('at sign-out, after the login ended and before the page changes', () => {
    expect(read('src', 'lib', 'phone-alerts.ts')).toMatch(
      /'\/api\/v1\/auth\/logout', \{ method: 'POST' \}\);\s+forgetSchedules\(\);\s+window\.location\.assign\(to\);/,
    );
  });

  it('when an account is deleted, before the page changes', () => {
    expect(read('src', 'lib', 'phone-alerts.ts')).toMatch(
      /if \(held\) await forget\(held\);\s+forgetSchedules\(\);\s+window\.location\.replace\(to\);/,
    );
  });

  it('when somebody signs in with a password, or with Google', () => {
    expect(read('app', 'login', 'page.tsx')).toMatch(
      /if \(code === 'ok'\) \{\s+(\/\/[^\n]*\s+)*forgetSchedules\(\);\s+router\.replace\(landing\);/,
    );
    expect(read('app', 'auth', 'oauth', 'callback', 'page.tsx')).toMatch(
      /phase = 'redirecting';\s+(\/\/[^\n]*\s+)*forgetSchedules\(\);\s+router\.replace\(/,
    );
  });

  it('and a read that was out when she left writes nothing back', () => {
    const before = departuresSoFar();
    forgetSchedules(fakeStore({}));
    expect(departuresSoFar()).toBe(before + 1);
    // One Event's copy ended by a 401 is not a person leaving the phone.
    forgetSchedule('a', fakeStore({}));
    expect(departuresSoFar()).toBe(before + 1);

    expect(read('src', 'components', 'me', 'use-my-schedule.ts')).toMatch(
      /const since = departuresSoFar\(\);[\s\S]+?\(answer\) => \{\s+(\/\/[^\n]*\s+)*if \(departuresSoFar\(\) !== since\) return;/,
    );
  });

  it('at "this is not me" on the guest schedule', () => {
    expect(read('app', 'e', '[eventSlug]', 'my-schedule', 'page.tsx')).toMatch(
      /guest-sessions\/me`, \{[^}]+\}\)\.finally\(\(\) => \{\s+(\/\/[^\n]*\s+)*forgetSchedules\(\);/,
    );
  });

  it('when a visitor picks a name', () => {
    expect(read('app', 'e', '[eventSlug]', 'people', '[personId]', 'page.tsx')).toMatch(
      /if \(result\.ok\) \{\s+(\/\/[^\n]*\s+)*forgetSchedules\(\);\s+(\/\/[^\n]*\s+)*window\.location\.assign/,
    );
  });

  it('and the reader is the one both pages use', () => {
    const hook = read('src', 'components', 'me', 'use-my-schedule.ts');
    expect(hook).toContain("if (kept === 'forget') forgetSchedule(eventKey);");
    expect(hook).toContain('readMySchedule<T>(apiUrl, eventKey, signal)');
    expect(read('app', 'e', '[eventSlug]', 'my-schedule', 'page.tsx')).toContain(
      'const mine = useMySchedule<PersonSchedule>(eventSlug);',
    );
    expect(read('src', 'components', 'me', 'hooks.ts')).not.toContain('my-schedule');
  });
});
