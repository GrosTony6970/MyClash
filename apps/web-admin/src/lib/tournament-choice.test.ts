import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_TOURNAMENTS,
  chooseTournament,
  rememberTournament,
  rememberedTournament,
  withTournament,
} from './tournament-choice';

/** O7, ruled 2026-10-14: the address, then the last one picked in this Event, then the first. */

describe('chooseTournament', () => {
  const ids = ['t1', 't2', 't3'];

  it('takes the address first', () => {
    expect(chooseTournament(ids, 't3', 't2')).toBe('t3');
  });

  it('takes the remembered one when the address names none, or one the Event does not hold', () => {
    expect(chooseTournament(ids, null, 't2')).toBe('t2');
    expect(chooseTournament(ids, 'gone', 't2')).toBe('t2');
  });

  it('takes the first when neither names one of the list', () => {
    expect(chooseTournament(ids, 'gone', 'gone-too')).toBe('t1');
  });

  it('answers nothing while the list is empty', () => {
    expect(chooseTournament([], 't1', 't1')).toBe('');
  });
});

/** This test run has no `localStorage`: one kept in a map, as a browser keeps it. */
function memoryStorage() {
  const kept = new Map<string, string>();
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  };
}

describe('the browser memory', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is kept per Event', () => {
    rememberTournament('ev1', 't2');
    expect(rememberedTournament('ev1')).toBe('t2');
    expect(rememberedTournament('ev2')).toBeNull();
  });

  it('never keeps "every Tournament"', () => {
    rememberTournament('ev1', 't2');
    rememberTournament('ev1', ALL_TOURNAMENTS);
    expect(rememberedTournament('ev1')).toBe('t2');
  });

  it('reads and writes nothing, and does not throw, where site data is blocked', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked });
    expect(() => rememberTournament('ev1', 't2')).not.toThrow();
    expect(rememberedTournament('ev1')).toBeNull();
  });
});

describe('withTournament', () => {
  it('keeps the other parameters and the tab in the hash', () => {
    expect(withTournament('http://x.test/org/c/events/e/pools?q=lea#matches', 't2')).toBe(
      '/org/c/events/e/pools?q=lea&tournamentId=t2#matches',
    );
  });

  it('replaces an older Tournament, and takes a path as well as a full address', () => {
    expect(withTournament('/org/c/events/e/bracket?tournamentId=t1#bracket', 't3')).toBe(
      '/org/c/events/e/bracket?tournamentId=t3#bracket',
    );
  });

  it('leaves a link bare while the page does not know its Tournament', () => {
    expect(withTournament('/org/c/events/e/bracket', '')).toBe('/org/c/events/e/bracket');
  });
});
