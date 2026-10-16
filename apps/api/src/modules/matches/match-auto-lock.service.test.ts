import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchAutoLockService } from './match-auto-lock.service';

const fromMock = vi.fn();
const lockMatchMock = vi.fn();

function makeSelectResult(result: unknown) {
  return {
    select: vi.fn().mockResolvedValue(result),
  };
}

describe('MatchAutoLockService', () => {
  let service: MatchAutoLockService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MatchAutoLockService(
      { service: { from: fromMock } } as never,
      { lockMatch: lockMatchMock } as never,
    );
  });

  it('loads phases and matches explicitly instead of using the stale nested embed', async () => {
    fromMock
      .mockReturnValueOnce(
        makeSelectResult({
          data: [
            {
              id: 'tournament-1',
              lock_config_json: {
                autoLockEnabled: true,
                autoLockDelayMinutes: 15,
                autoLockCompletedPools: true,
                autoLockCompletedBrackets: true,
              },
            },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(
        makeSelectResult({
          data: [{ id: 'phase-1', tournament_id: 'tournament-1', type: 'pool' }],
          error: null,
        }),
      )
      .mockReturnValueOnce(
        makeSelectResult({
          data: [
            {
              id: 'match-1',
              phase_id: 'phase-1',
              status: 'completed',
              ended_at: '2026-05-16T00:00:00.000Z',
              locked_at: null,
              pool_id: 'pool-1',
            },
            {
              id: 'match-2',
              phase_id: 'phase-1',
              status: 'completed',
              ended_at: '2026-05-16T00:01:00.000Z',
              locked_at: null,
              pool_id: 'pool-1',
            },
          ],
          error: null,
        }),
      );

    const locked = await service.runOnce(new Date('2026-05-16T00:20:00.000Z'));

    expect(locked).toBe(2);
    expect(fromMock).toHaveBeenNthCalledWith(1, 'tournaments');
    expect(fromMock).toHaveBeenNthCalledWith(2, 'phases');
    expect(fromMock).toHaveBeenNthCalledWith(3, 'matches');
    const selects = fromMock.mock.results.map(
      (result) => (result.value as { select: ReturnType<typeof vi.fn> }).select.mock.calls[0]?.[0],
    );
    expect(selects).not.toContain(
      'id, lock_config_json, phases(id,type,matches(id,status,ended_at,locked_at,pool_id))',
    );
    expect(lockMatchMock).toHaveBeenCalledWith(
      'match-1',
      'Auto lock after completed group',
      undefined,
      'auto',
    );
    expect(lockMatchMock).toHaveBeenCalledWith(
      'match-2',
      'Auto lock after completed group',
      undefined,
      'auto',
    );
  });

  it('does not lock incomplete pool groups', async () => {
    fromMock
      .mockReturnValueOnce(
        makeSelectResult({
          data: [{ id: 'tournament-1', lock_config_json: { autoLockEnabled: true } }],
          error: null,
        }),
      )
      .mockReturnValueOnce(
        makeSelectResult({
          data: [{ id: 'phase-1', tournament_id: 'tournament-1', type: 'pool' }],
          error: null,
        }),
      )
      .mockReturnValueOnce(
        makeSelectResult({
          data: [
            {
              id: 'match-1',
              phase_id: 'phase-1',
              status: 'completed',
              ended_at: '2026-05-16T00:00:00.000Z',
              locked_at: null,
              pool_id: 'pool-1',
            },
            {
              id: 'match-2',
              phase_id: 'phase-1',
              status: 'running',
              ended_at: null,
              locked_at: null,
              pool_id: 'pool-1',
            },
          ],
          error: null,
        }),
      );

    const locked = await service.runOnce(new Date('2026-05-16T00:20:00.000Z'));

    expect(locked).toBe(0);
    expect(lockMatchMock).not.toHaveBeenCalled();
  });

  // A hit made at 10:06 on a tablet with no wifi decides the Pool's last bout; its queue reaches
  // the server at 11:00. The bout ended at 10:06, but the desk gets its 30 minutes from 11:00.
  it('waits from the later of the end and the last write of a bout', async () => {
    const lateResult = (now: string) => {
      fromMock
        .mockReturnValueOnce(
          makeSelectResult({
            data: [
              {
                id: 'tournament-1',
                lock_config_json: { autoLockEnabled: true, autoLockDelayMinutes: 30 },
              },
            ],
            error: null,
          }),
        )
        .mockReturnValueOnce(
          makeSelectResult({
            data: [{ id: 'phase-1', tournament_id: 'tournament-1', type: 'pool' }],
            error: null,
          }),
        )
        .mockReturnValueOnce(
          makeSelectResult({
            data: [
              {
                id: 'match-1',
                phase_id: 'phase-1',
                status: 'completed',
                ended_at: '2026-05-16T10:06:00.000Z',
                updated_at: '2026-05-16T11:00:00.000Z',
                locked_at: null,
                pool_id: 'pool-1',
              },
            ],
            error: null,
          }),
        );
      return service.runOnce(new Date(now));
    };

    expect(await lateResult('2026-05-16T11:05:00.000Z')).toBe(0);
    expect(lockMatchMock).not.toHaveBeenCalled();
    const select = (fromMock.mock.results[2]?.value as { select: ReturnType<typeof vi.fn> }).select
      .mock.calls[0]?.[0];
    expect(select).toContain('updated_at');

    expect(await lateResult('2026-05-16T11:30:00.000Z')).toBe(1);
  });

  it('returns zero and logs a warning when a query fails', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fromMock
      .mockReturnValueOnce(
        makeSelectResult({
          data: [{ id: 'tournament-1', lock_config_json: { autoLockEnabled: true } }],
          error: null,
        }),
      )
      .mockReturnValueOnce(
        makeSelectResult({
          data: null,
          error: { message: 'Could not load phases' },
        }),
      );

    const locked = await service.runOnce(new Date('2026-05-16T00:20:00.000Z'));

    expect(locked).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith('Auto-lock scan failed: Could not load phases');
    expect(lockMatchMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
