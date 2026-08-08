import type { BoardMatch, BoardRow, BoardScorer } from './types';

/**
 * Builders for the board's pure-module tests.
 *
 * Every field has a default so a case names only what it asserts on. The
 * payload gained a dozen fields at once; a fixture that spells them all out
 * inline turns every future field into a mass edit of unrelated cases.
 */

export const NOW = Date.parse('2026-07-21T10:00:00Z');

/** `n` seconds before NOW, as an ISO string. */
export function agoIso(seconds: number, now = NOW): string {
  return new Date(now - seconds * 1000).toISOString();
}

export function mkMatch(over: Partial<BoardMatch> = {}): BoardMatch {
  return {
    id: 'm1',
    redFighterName: 'Red',
    blueFighterName: 'Blue',
    redScore: 0,
    blueScore: 0,
    status: 'running',
    round: null,
    matchNumberLabel: '#1',
    scheduledAt: null,
    startedAt: null,
    endedAt: null,
    poolName: null,
    tournamentName: null,
    phaseType: null,
    referees: [],
    ...over,
  };
}

export function mkScorer(over: Partial<BoardScorer> = {}): BoardScorer {
  return {
    accountId: 'a1',
    name: 'Léa',
    username: 'lea',
    status: 'active',
    lastSeenAt: null,
    otherCount: 0,
    others: [],
    ...over,
  };
}

/** A healthy piste with a bout under way. */
export function mkRow(over: Partial<BoardRow> = {}): BoardRow {
  return {
    lice: {
      id: 'L1',
      name: 'Piste 1',
      sortOrder: 0,
      locationLabel: null,
      colorHex: null,
      venue: null,
      area: null,
    },
    currentMatch: mkMatch({ startedAt: agoIso(60) }),
    scorer: mkScorer(),
    health: { outboxDepth: 0, oldestPendingAgeSec: 0, rejectedCount: 0, clockSkewMs: null },
    attention: null,
    nextUp: null,
    queue: [],
    lastCompleted: null,
    ...over,
  };
}
