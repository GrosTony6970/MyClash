import { describe, expect, it } from 'vitest';
import { parseBoutLength, planRunWindowSave, sharedBoutLength } from './run-window';

describe('parseBoutLength', () => {
  it('reads a blank field as no typed length', () => {
    expect(parseBoutLength('')).toEqual({ kind: 'blank' });
    expect(parseBoutLength('   ')).toEqual({ kind: 'blank' });
  });

  it('reads a whole number of minutes from 1 to a day', () => {
    expect(parseBoutLength('7')).toEqual({ kind: 'minutes', minutes: 7 });
    expect(parseBoutLength(' 12 ')).toEqual({ kind: 'minutes', minutes: 12 });
    expect(parseBoutLength('1')).toEqual({ kind: 'minutes', minutes: 1 });
    expect(parseBoutLength('1440')).toEqual({ kind: 'minutes', minutes: 1440 });
  });

  it('refuses what is not a whole number of minutes in range, rather than reading it as blank', () => {
    for (const raw of ['0', '-1', '1.5', '7min', 'abc', '1e2', '1441']) {
      expect(parseBoutLength(raw), raw).toEqual({ kind: 'invalid' });
    }
  });
});

describe('sharedBoutLength', () => {
  const card = (id: string, typed: number | null) => ({
    id,
    plannedDurationOverrideMinutes: typed,
  });

  it("opens on the run's length when every bout carries the same one", () => {
    const cards = [card('a', 7), card('b', 7), card('c', 7), card('other', 12)];
    expect(sharedBoutLength(['a', 'b', 'c'], cards)).toBe(7);
  });

  it('opens blank when one bout in the middle of the run disagrees', () => {
    const cards = [card('a', 7), card('b', null), card('c', 7)];
    expect(sharedBoutLength(['a', 'b', 'c'], cards)).toBeNull();
  });

  it('opens blank when no bout carries a typed length', () => {
    expect(sharedBoutLength(['a', 'b'], [card('a', null), card('b', null)])).toBeNull();
  });
});

describe('planRunWindowSave', () => {
  // A run at 10:43 in Paris (UTC+2 in June). The field shows its slot, 10:40.
  const RUN_START = '2026-06-06T08:43:00.000Z';
  const base = {
    runMatchIds: ['m-1', 'm-2', 'm-3'],
    runStartIso: RUN_START,
    shownStartHHMM: '10:40',
    startHHMM: '10:40',
    openedBoutLength: null,
    boutLengthMinutes: null,
    day: '2026-06-06',
    tz: 'Europe/Paris',
  };

  it('asks for nothing when neither the start nor the length changed', () => {
    expect(planRunWindowSave(base)).toEqual({ kind: 'nothing' });
  });

  it("keeps the run's own start while its text is untouched, and sends the typed length", () => {
    expect(planRunWindowSave({ ...base, boutLengthMinutes: 7 })).toEqual({
      kind: 'save',
      body: {
        matchIds: ['m-1', 'm-2', 'm-3'],
        startAt: RUN_START,
        plannedDurationOverrideMinutes: 7,
      },
    });
  });

  it("reads a changed start on the Event's clock, and sends no length key", () => {
    const plan = planRunWindowSave({ ...base, startHHMM: '11:00' });
    expect(plan).toEqual({
      kind: 'save',
      body: { matchIds: ['m-1', 'm-2', 'm-3'], startAt: '2026-06-06T09:00:00.000Z' },
    });
  });

  it('sends null to clear a typed length', () => {
    const plan = planRunWindowSave({ ...base, openedBoutLength: 7, boutLengthMinutes: null });
    expect(plan).toEqual({
      kind: 'save',
      body: {
        matchIds: base.runMatchIds,
        startAt: RUN_START,
        plannedDurationOverrideMinutes: null,
      },
    });
  });

  it('refuses a start it cannot read, before anything is sent', () => {
    for (const startHHMM of ['9h30', '25:00', '10:5', '']) {
      expect(planRunWindowSave({ ...base, startHHMM }), startHHMM).toEqual({
        kind: 'unreadable-start',
      });
    }
  });
});
