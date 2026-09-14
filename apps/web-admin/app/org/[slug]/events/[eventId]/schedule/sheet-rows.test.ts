import { describe, expect, it } from 'vitest';
import { keepLiveRows, withTournamentLength } from './sheet-rows';

describe('withTournamentLength', () => {
  it('starts a row for a Tournament that has none', () => {
    expect(withTournamentLength([], 't1', 'poolMatchDurationMinutes', 7)).toEqual([
      { tournamentId: 't1', poolMatchDurationMinutes: 7 },
    ]);
  });

  it('removes a length when its box is cleared, and keeps the others', () => {
    const rows = [
      { tournamentId: 't1', poolMatchDurationMinutes: 7, finalsMatchDurationMinutes: 12 },
    ];

    const next = withTournamentLength(rows, 't1', 'poolMatchDurationMinutes', undefined);

    expect(next).toEqual([{ tournamentId: 't1', finalsMatchDurationMinutes: 12 }]);
    expect(next[0]).not.toHaveProperty('poolMatchDurationMinutes');
  });

  it("leaves other Tournaments' rows as they were, in order", () => {
    const rows = [
      { tournamentId: 't1', poolMatchDurationMinutes: 7 },
      { tournamentId: 't2', poolMatchDurationMinutes: 9 },
    ];

    expect(withTournamentLength(rows, 't1', 'poolMatchDurationMinutes', 8)).toEqual([
      { tournamentId: 't1', poolMatchDurationMinutes: 8 },
      { tournamentId: 't2', poolMatchDurationMinutes: 9 },
    ]);
  });
});

describe('keepLiveRows', () => {
  const known = new Set(['t1', 't2']);

  it('drops a row whose boxes are all blank', () => {
    expect(keepLiveRows([{ tournamentId: 't1' }], known)).toEqual([]);
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
