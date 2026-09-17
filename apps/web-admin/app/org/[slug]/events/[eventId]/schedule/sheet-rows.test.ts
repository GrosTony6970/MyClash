import { describe, expect, it } from 'vitest';
import { keepLiveRows, withTournamentField } from './sheet-rows';

describe('withTournamentField', () => {
  it('starts a row for a Tournament that has none', () => {
    expect(withTournamentField([], 't1', 'poolMatchDurationMinutes', 7)).toEqual([
      { tournamentId: 't1', poolMatchDurationMinutes: 7 },
    ]);
  });

  it('removes a length when its box is cleared, and keeps the others', () => {
    const rows = [
      { tournamentId: 't1', poolMatchDurationMinutes: 7, finalsMatchDurationMinutes: 12 },
    ];

    const next = withTournamentField(rows, 't1', 'poolMatchDurationMinutes', undefined);

    expect(next).toEqual([{ tournamentId: 't1', finalsMatchDurationMinutes: 12 }]);
    expect(next[0]).not.toHaveProperty('poolMatchDurationMinutes');
  });

  it("leaves other Tournaments' rows as they were, in order", () => {
    const rows = [
      { tournamentId: 't1', poolMatchDurationMinutes: 7 },
      { tournamentId: 't2', poolMatchDurationMinutes: 9 },
    ];

    expect(withTournamentField(rows, 't1', 'poolMatchDurationMinutes', 8)).toEqual([
      { tournamentId: 't1', poolMatchDurationMinutes: 8 },
      { tournamentId: 't2', poolMatchDurationMinutes: 9 },
    ]);
  });
});

describe('withTournamentField, the rest box', () => {
  it('starts a row for a Tournament that has no row yet', () => {
    expect(withTournamentField([], 't1', 'minRestMinutes', 15)).toEqual([
      { tournamentId: 't1', minRestMinutes: 15 },
    ]);
  });

  it('keeps a zero: this Tournament takes no break at all', () => {
    // Zero is not blank. Folding them together would make "no break here" say
    // "use the Event's break", which is the opposite.
    expect(withTournamentField([], 't1', 'minRestMinutes', 0)).toEqual([
      { tournamentId: 't1', minRestMinutes: 0 },
    ]);
  });

  it("removes the rest when its box is cleared, and keeps the Tournament's lengths", () => {
    const rows = [{ tournamentId: 't1', poolMatchDurationMinutes: 7, minRestMinutes: 15 }];

    const next = withTournamentField(rows, 't1', 'minRestMinutes', undefined);

    expect(next).toEqual([{ tournamentId: 't1', poolMatchDurationMinutes: 7 }]);
    expect(next[0]).not.toHaveProperty('minRestMinutes');
  });

  it("leaves other Tournaments' rests as they were, in order", () => {
    const rows = [
      { tournamentId: 't1', minRestMinutes: 15 },
      { tournamentId: 't2', minRestMinutes: 3 },
    ];

    // The FIRST row is the one edited here: the length case above edits the
    // first too, so a writer that took `rows[rows.length - 1]` would pass both
    // if this one edited the last.
    expect(withTournamentField(rows, 't1', 'minRestMinutes', 4)).toEqual([
      { tournamentId: 't1', minRestMinutes: 4 },
      { tournamentId: 't2', minRestMinutes: 3 },
    ]);
  });
});

describe('keepLiveRows', () => {
  const known = new Set(['t1', 't2']);

  it('drops a row whose boxes are all blank', () => {
    expect(keepLiveRows([{ tournamentId: 't1' }], known)).toEqual([]);
  });

  it('keeps a row that carries only a rest', () => {
    // The rest is not one of the length fields, so a row holding nothing else
    // would be thrown away on the next save and the setting would vanish.
    const rows = [{ tournamentId: 't1', minRestMinutes: 0 }];

    expect(keepLiveRows(rows, known)).toEqual(rows);
  });

  it('drops a row for a Tournament the Event no longer has', () => {
    const rows = [
      { tournamentId: 'gone', poolMatchDurationMinutes: 7 },
      { tournamentId: 't2', finalsMatchDurationMinutes: 12 },
    ];

    expect(keepLiveRows(rows, known)).toEqual([
      { tournamentId: 't2', finalsMatchDurationMinutes: 12 },
    ]);
  });
});
