import { describe, expect, it } from 'vitest';
import { buildRefereeTree, type RefereeHistoryEntry } from './referee-tree';

let seq = 0;
function bout(patch: Partial<RefereeHistoryEntry>): RefereeHistoryEntry {
  seq += 1;
  return {
    matchId: `m-${seq}`,
    role: null,
    eventId: 'ev-old',
    eventName: 'Open 2025',
    tournamentId: 't-old',
    tournamentName: 'Longsword',
    weapon: 'Longsword',
    scheduledAt: '2025-05-10T09:00:00Z',
    durationMs: 60_000,
    skillId: null,
    skillName: null,
    skillColor: null,
    phaseType: 'pool',
    poolNumber: 1,
    bracketRound: null,
    bracketSize: null,
    cards: { yellow: 0, red: 0, black: 0 },
    sideColors: null,
    coReferees: [],
    redFighterName: null,
    blueFighterName: null,
    redScore: null,
    blueScore: null,
    winner: null,
    ...patch,
  };
}

const names = (tree: ReturnType<typeof buildRefereeTree>) => tree.map((event) => event.name);

describe('buildRefereeTree order', () => {
  it("puts yesterday's Event above a bigger Event of last year", () => {
    const history = [
      bout({}),
      bout({}),
      bout({}),
      bout({ eventId: 'ev-new', eventName: 'Cup 2026', scheduledAt: '2026-10-13T15:00:00Z' }),
    ];
    expect(names(buildRefereeTree(history, '?'))).toEqual(['Cup 2026', 'Open 2025']);
  });

  it('orders an Event by its LATEST bout, not its first', () => {
    const history = [
      bout({ eventId: 'ev-a', eventName: 'A', scheduledAt: '2026-01-01T09:00:00Z' }),
      bout({ eventId: 'ev-a', eventName: 'A', scheduledAt: '2026-09-01T09:00:00Z' }),
      bout({ eventId: 'ev-b', eventName: 'B', scheduledAt: '2026-06-01T09:00:00Z' }),
    ];
    expect(names(buildRefereeTree(history, '?'))).toEqual(['A', 'B']);
  });

  it('puts an Event with no planned time last', () => {
    const history = [
      bout({ eventId: 'ev-x', eventName: 'No time', scheduledAt: null }),
      bout({ eventId: 'ev-x', eventName: 'No time', scheduledAt: null }),
      bout({}),
    ];
    expect(names(buildRefereeTree(history, '?'))).toEqual(['Open 2025', 'No time']);
  });

  it('keeps the bigger Event first when two share the same latest time', () => {
    const at = '2026-10-13T15:00:00Z';
    const history = [
      bout({ eventId: 'ev-s', eventName: 'Small', scheduledAt: at }),
      bout({ eventId: 'ev-b', eventName: 'Big', scheduledAt: at }),
      bout({ eventId: 'ev-b', eventName: 'Big', scheduledAt: '2026-10-13T10:00:00Z' }),
    ];
    expect(names(buildRefereeTree(history, '?'))).toEqual(['Big', 'Small']);
  });

  it('orders the Tournaments inside an Event the same way', () => {
    const history = [
      bout({ tournamentId: 't-1', tournamentName: 'Morning', scheduledAt: '2026-10-13T09:00:00Z' }),
      bout({ tournamentId: 't-1', tournamentName: 'Morning', scheduledAt: '2026-10-13T10:00:00Z' }),
      bout({ tournamentId: 't-2', tournamentName: 'Evening', scheduledAt: '2026-10-13T18:00:00Z' }),
    ];
    const [event] = buildRefereeTree(history, '?');
    expect([...event!.tournaments.values()].map((t) => t.name)).toEqual(['Evening', 'Morning']);
  });
});
