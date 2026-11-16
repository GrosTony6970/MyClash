import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, supabaseFrom } from '../../common/testing/supabase-chain';
import { MatchAutoLockService } from './match-auto-lock.service';

const lockMatchMock = vi.fn();

/** One running Event, one Tournament with `lockConfig`, one pool phase, and its bouts. */
function world(matches: Array<Record<string, unknown>>, lockConfig: Record<string, unknown> = {}) {
  return mockSupabase({
    events: { rows: [{ id: 'event-1', status: 'running' }] },
    tournaments: {
      rows: [{ id: 'tournament-1', event_id: 'event-1', lock_config_json: lockConfig }],
    },
    phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1', type: 'pool' }] },
    matches: { rows: matches },
  });
}

const bout = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  phase_id: 'phase-1',
  pool_id: 'pool-1',
  status: 'completed',
  ended_at: '2026-05-16T00:00:00.000Z',
  locked_at: null,
  ...extra,
});

describe('MatchAutoLockService', () => {
  const scanner = (db: { service: unknown }) =>
    new MatchAutoLockService(db as never, { lockMatch: lockMatchMock } as never);

  beforeEach(() => {
    vi.clearAllMocks();
    // A write that locked its Match answers the row (MatchesService.lockMatch).
    lockMatchMock.mockResolvedValue({ id: 'locked' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('locks a finished Pool, each write carrying the updated_at the scan read', async () => {
    const db = world(
      [
        bout('match-1', { updated_at: '2026-05-16T00:00:01.123456+00:00' }),
        bout('match-2', {
          ended_at: '2026-05-16T00:01:00.000Z',
          updated_at: '2026-05-16T00:01:02.654321+00:00',
        }),
      ],
      {
        autoLockEnabled: true,
        autoLockDelayMinutes: 15,
        autoLockCompletedPools: true,
        autoLockCompletedBrackets: true,
      },
    );

    expect(await scanner(db).runOnce(new Date('2026-05-16T00:20:00.000Z'))).toBe(2);
    // Each write carries the `updated_at` this scan read for that Match (ruling 816).
    expect(lockMatchMock).toHaveBeenCalledWith(
      'match-1',
      'Auto lock after completed group',
      '2026-05-16T00:00:01.123456+00:00',
    );
    expect(lockMatchMock).toHaveBeenCalledWith(
      'match-2',
      'Auto lock after completed group',
      '2026-05-16T00:01:02.654321+00:00',
    );
  });

  it('counts only the Matches its write locked: a Match changed since the read is not', async () => {
    const db = world([bout('match-1'), bout('match-2')], { autoLockEnabled: true });
    // match-1 was unlocked, corrected or reset after the scan read it: the write matched no row
    // and answered null.
    lockMatchMock.mockResolvedValueOnce(null);

    expect(await scanner(db).runOnce(new Date('2026-05-16T00:20:00.000Z'))).toBe(1);
    expect(lockMatchMock).toHaveBeenCalledTimes(2);
  });

  it('does not lock incomplete pool groups', async () => {
    const db = world([bout('match-1'), bout('match-2', { status: 'running', ended_at: null })]);

    expect(await scanner(db).runOnce(new Date('2026-05-16T00:20:00.000Z'))).toBe(0);
    expect(lockMatchMock).not.toHaveBeenCalled();
  });

  it('locks nothing in a Tournament whose auto-lock is off', async () => {
    const db = world([bout('match-1')], { autoLockEnabled: false });

    expect(await scanner(db).runOnce(new Date('2026-05-16T00:20:00.000Z'))).toBe(0);
    expect(lockMatchMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ autoLockCompletedPools: false }, ['bracket-1']],
    [{ autoLockCompletedBrackets: false }, ['match-1']],
  ])('locks only the phases its settings allow: %o', async (lockConfig, expected) => {
    const db = mockSupabase({
      events: { rows: [{ id: 'event-1', status: 'running' }] },
      tournaments: {
        rows: [{ id: 'tournament-1', event_id: 'event-1', lock_config_json: lockConfig }],
      },
      phases: {
        rows: [
          { id: 'phase-1', tournament_id: 'tournament-1', type: 'pool' },
          { id: 'phase-2', tournament_id: 'tournament-1', type: 'single_elim' },
        ],
      },
      matches: {
        rows: [bout('bracket-1', { phase_id: 'phase-2', pool_id: null }), bout('match-1')],
      },
    });

    await scanner(db).runOnce(new Date('2026-05-16T00:20:00.000Z'));
    expect(lockMatchMock.mock.calls.map(([id]) => id)).toEqual(expected);
  });

  // A hit made at 10:06 on a tablet with no wifi decides the Pool's last bout; its queue reaches
  // the server at 11:00. The bout ended at 10:06, but the desk gets its 30 minutes from 11:00.
  it('waits from the later of the end and the last write of a bout', async () => {
    const db = world(
      [
        bout('match-1', {
          ended_at: '2026-05-16T10:06:00.000Z',
          updated_at: '2026-05-16T11:00:00.000Z',
        }),
      ],
      { autoLockEnabled: true, autoLockDelayMinutes: 30 },
    );

    expect(await scanner(db).runOnce(new Date('2026-05-16T11:05:00.000Z'))).toBe(0);
    expect(lockMatchMock).not.toHaveBeenCalled();
    expect(await scanner(db).runOnce(new Date('2026-05-16T11:30:00.000Z'))).toBe(1);
  });

  it('a read PostgREST refuses ends the scan with a warning and no lock', async () => {
    vi.useFakeTimers();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const from = supabaseFrom({
      events: { rows: [{ id: 'event-1', status: 'running' }] },
      tournaments: { rows: [{ id: 'tournament-1', event_id: 'event-1', lock_config_json: {} }] },
      phases: { data: null, error: { message: 'Could not load phases' } },
    });
    const service = scanner({ service: { from } });

    service.start();
    await vi.advanceTimersByTimeAsync(60_000);
    service.onModuleDestroy();

    expect(warnSpy).toHaveBeenCalledWith('Auto-lock scan failed: Could not load phases');
    expect(lockMatchMock).not.toHaveBeenCalled();
  });
});
