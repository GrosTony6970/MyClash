import { describe, expect, it } from 'vitest';
import { computeLeagueFreshness, type LinkedTournamentChange } from './league-freshness';

const COMPUTED = '2026-08-01T12:00:00.000Z';
const BEFORE = '2026-07-30T09:00:00.000Z';
const AFTER = '2026-08-02T18:30:00.000Z';

function linked(overrides: Partial<LinkedTournamentChange> = {}): LinkedTournamentChange {
  return { tournamentId: 't-1', name: 'Longsword', lastChangedAt: BEFORE, ...overrides };
}

describe('computeLeagueFreshness', () => {
  it('is fresh when every linked tournament last changed before the recompute', () => {
    const report = computeLeagueFreshness({
      finalizedAt: null,
      computedAt: COMPUTED,
      linkedTournaments: [linked(), linked({ tournamentId: 't-2', name: 'Rapier' })],
    });
    expect(report.state).toBe('fresh');
    expect(report.changedTournamentNames).toEqual([]);
  });

  it('is stale, and names only the tournaments that moved', () => {
    const report = computeLeagueFreshness({
      finalizedAt: null,
      computedAt: COMPUTED,
      linkedTournaments: [
        linked(),
        linked({ tournamentId: 't-2', name: 'Rapier', lastChangedAt: AFTER }),
        linked({ tournamentId: 't-3', name: 'Sabre', lastChangedAt: AFTER }),
      ],
    });
    expect(report.state).toBe('stale');
    expect(report.changedTournamentNames).toEqual(['Rapier', 'Sabre']);
  });

  it('reads a finalized season as frozen even when a linked tournament moved after it', () => {
    // recomputeForEvent skips a finalized league and recomputeLeagueRankings
    // refuses it, so there is no action behind a "stale" badge here.
    const report = computeLeagueFreshness({
      finalizedAt: '2026-08-03T00:00:00.000Z',
      computedAt: COMPUTED,
      linkedTournaments: [linked({ lastChangedAt: AFTER })],
    });
    expect(report.state).toBe('frozen');
    expect(report.changedTournamentNames).toEqual([]);
  });

  it('is never_computed when tournaments are linked but nothing has been computed', () => {
    const report = computeLeagueFreshness({
      finalizedAt: null,
      computedAt: null,
      linkedTournaments: [linked()],
    });
    expect(report.state).toBe('never_computed');
  });

  it('is fresh rather than never_computed with no linked tournaments', () => {
    // Nothing can contribute, so a recompute would do nothing — nagging for one
    // would be noise on every empty league.
    const report = computeLeagueFreshness({
      finalizedAt: null,
      computedAt: null,
      linkedTournaments: [],
    });
    expect(report.state).toBe('fresh');
  });

  it('treats a tournament with no matches as unchanged', () => {
    const report = computeLeagueFreshness({
      finalizedAt: null,
      computedAt: COMPUTED,
      linkedTournaments: [linked({ lastChangedAt: null })],
    });
    expect(report.state).toBe('fresh');
  });

  it('treats an exactly-equal timestamp as unchanged', () => {
    // A recompute reads the very results it computes from, so a tie is the same
    // state. Calling it stale would leave a badge no recompute could clear.
    const report = computeLeagueFreshness({
      finalizedAt: null,
      computedAt: COMPUTED,
      linkedTournaments: [linked({ lastChangedAt: COMPUTED })],
    });
    expect(report.state).toBe('fresh');
  });

  it('compares instants, not strings, across differing timestamp formats', () => {
    // Postgres hands back '+00' offsets while computed_at may arrive as 'Z'.
    // A lexicographic comparison would call this stale forever.
    const report = computeLeagueFreshness({
      finalizedAt: null,
      computedAt: '2026-08-01T12:00:00Z',
      linkedTournaments: [linked({ lastChangedAt: '2026-08-01 11:00:00+00' })],
    });
    expect(report.state).toBe('fresh');
  });
});
