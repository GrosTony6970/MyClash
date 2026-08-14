import { describe, expect, it } from 'vitest';
import { draggedMatchIds, type DragPayload } from './drag-payload';
import type { ScheduleMatch } from './schedule-types';

/**
 * These pin the one decision the union delegates: which payloads carry fights.
 *
 * It replaced a `??` chain over four separate refs, and that chain's silent
 * fall-through to an empty list is what made a dragged programme bar a no-op on
 * the Blocks view. That behaviour has to survive, so it is asserted rather than
 * remembered.
 */

const MATCH: ScheduleMatch = {
  id: 'm-1',
  matchNumberLabel: 'M1',
  status: 'scheduled',
  liceId: null,
  scheduledAt: null,
  startedAt: null,
  endedAt: null,
  redFighterName: null,
  blueFighterName: null,
  redRegistrationId: '',
  blueRegistrationId: '',
  tournamentName: null,
  tournamentColor: null,
  durationMinutes: 5,
  phaseType: null,
  poolId: null,
  poolName: null,
};

describe('draggedMatchIds', () => {
  it('reads a single fight out of a match payload', () => {
    expect(draggedMatchIds({ kind: 'match', match: MATCH })).toEqual(['m-1']);
  });

  it('passes a group payload through untouched', () => {
    const groups: DragPayload[] = [
      { kind: 'pool', poolId: 'p-1', matchIds: ['a', 'b'] },
      { kind: 'bracketRound', key: 'r-1', matchIds: ['a', 'b'] },
      { kind: 'viewBlock', matchIds: ['a', 'b'] },
    ];
    for (const payload of groups) expect(draggedMatchIds(payload)).toEqual(['a', 'b']);
  });

  it('gives a programme bar no fights, so a bar drop stays a no-op', () => {
    // Not an oversight: a bar is a time window that cascades whatever follows
    // it, not a set of fights. The group placer returns early on an empty set,
    // which is how the Blocks view has always ignored a dragged bar.
    expect(draggedMatchIds({ kind: 'block', id: 'b-1', startTime: '13:00' })).toEqual([]);
    expect(draggedMatchIds({ kind: 'viewBreak', id: 'b-1', startTime: '13:00' })).toEqual([]);
  });

  it('treats no payload as nothing to move', () => {
    expect(draggedMatchIds(null)).toEqual([]);
  });
});
