// apps/api/src/modules/staff/live-board-context.test.ts
//
// The v2 payload: bout context, referees, the queue, the finished tail and
// lice placement. Split from live-board.test.ts, which covers the original
// current-bout / scorer / health assembly.
import { describe, expect, it } from 'vitest';
import { assembleBoardRows, buildBoardAccounts } from './live-board';
import { account, base, lice, match } from './live-board.fixtures';
import type { ResolvedReferee } from '../matches/resolve-match-referees';

describe('assembleBoardRows — context, queue and placement', () => {
  it('maps pool, tournament and phase context onto the current bout', () => {
    const input = base();
    input.matches = [
      match({
        pool_id: 'p1',
        pools: { name: 'Pool A' },
        phases: { type: 'pool', tournaments: { name: 'Longsword Open' } },
      }),
    ];
    const cm = assembleBoardRows(input)[0]!.currentMatch!;
    expect(cm.poolName).toBe('Pool A');
    expect(cm.tournamentName).toBe('Longsword Open');
    expect(cm.phaseType).toBe('pool');
  });

  it('leaves referees empty when nothing is assigned', () => {
    const input = base();
    input.matches = [match()];
    expect(assembleBoardRows(input)[0]!.currentMatch!.referees).toEqual([]);
  });

  it('attaches referees to the current bout, carrying the role colour token', () => {
    const input = base();
    input.matches = [match()];
    input.refereesByMatchId = new Map([
      [
        'm1',
        [
          {
            name: 'Marc L',
            role: 'sk-1',
            roleLabel: 'Director',
            roleColor: 'amber',
            status: 'confirmed',
          },
        ] as ResolvedReferee[],
      ],
    ]);
    expect(assembleBoardRows(input)[0]!.currentMatch!.referees).toEqual([
      { name: 'Marc L', roleLabel: 'Director', roleColor: 'amber', status: 'confirmed' },
    ]);
  });

  it('orders the queue by scheduled_at and caps it at three', () => {
    const input = base();
    input.matches = [
      match({ id: 'cur', status: 'running' }),
      match({
        id: 'm4',
        status: 'scheduled',
        match_number_label: '#4',
        scheduled_at: '2026-07-21T12:00:00Z',
      }),
      match({
        id: 'm2',
        status: 'scheduled',
        match_number_label: '#2',
        scheduled_at: '2026-07-21T10:00:00Z',
      }),
      match({
        id: 'm3',
        status: 'scheduled',
        match_number_label: '#3',
        scheduled_at: '2026-07-21T11:00:00Z',
      }),
      match({
        id: 'm5',
        status: 'scheduled',
        match_number_label: '#5',
        scheduled_at: '2026-07-21T13:00:00Z',
      }),
    ];
    const row = assembleBoardRows(input)[0]!;
    expect(row.queue.map((q) => q.matchId)).toEqual(['m2', 'm3', 'm4']);
    // nextUp is the head of the queue, not the query's first scheduled row.
    expect(row.nextUp).toEqual({ matchId: 'm2', label: '#2' });
  });

  it('never lets a completed bout become current or enter the queue', () => {
    // Completed bouts arrive on a separate list precisely so they cannot be
    // promoted; this pins that they stay out even if one leaks into `matches`.
    const input = base();
    input.matches = [match({ id: 'done', status: 'completed' })];
    const row = assembleBoardRows(input)[0]!;
    expect(row.currentMatch).toBeNull();
    expect(row.queue).toEqual([]);
  });

  it('reports the most recently finished bout', () => {
    const input = base();
    input.recentCompleted = [
      match({
        id: 'old',
        status: 'completed',
        match_number_label: '#1',
        ended_at: '2026-07-21T09:00:00Z',
      }),
      match({
        id: 'new',
        status: 'completed',
        match_number_label: '#2',
        ended_at: '2026-07-21T10:30:00Z',
      }),
    ];
    expect(assembleBoardRows(input)[0]!.lastCompleted).toEqual({
      matchId: 'new',
      label: '#2',
      endedAt: '2026-07-21T10:30:00Z',
    });
  });

  it('falls back to scheduled_at for legacy completed bouts with no ended_at', () => {
    // Bouts completed before the clock columns landed carry a null ended_at.
    // Ordering those last would make an old event claim its FIRST bout was its
    // most recent.
    const input = base();
    input.recentCompleted = [
      match({ id: 'a', status: 'completed', ended_at: null, scheduled_at: '2026-07-21T09:00:00Z' }),
      match({ id: 'b', status: 'completed', ended_at: null, scheduled_at: '2026-07-21T11:00:00Z' }),
    ];
    const last = assembleBoardRows(input)[0]!.lastCompleted!;
    expect(last.matchId).toBe('b');
    expect(last.endedAt).toBeNull();
  });

  it('keeps a completed-only lice as an idle row rather than dropping it', () => {
    const input = base();
    input.recentCompleted = [
      match({ id: 'done', status: 'completed', ended_at: '2026-07-21T10:00:00Z' }),
    ];
    const row = assembleBoardRows(input)[0]!;
    expect(row.currentMatch).toBeNull();
    expect(row.queue).toEqual([]);
    expect(row.lastCompleted?.matchId).toBe('done');
  });

  it('projects the lice placement, including a null venue or area', () => {
    const input = base();
    input.lices = [
      lice({
        id: 'L1',
        location_label: 'Hall A, north',
        color_hex: '#ff0000',
        venues: { id: 'v1', name: 'Gymnase' },
        venue_areas: null,
      }),
    ];
    expect(assembleBoardRows(input)[0]!.lice).toEqual({
      id: 'L1',
      name: 'Piste 1',
      sortOrder: 0,
      locationLabel: 'Hall A, north',
      colorHex: '#ff0000',
      venue: { id: 'v1', name: 'Gymnase' },
      area: null,
    });
  });

  it('orders rows by lice sort_order', () => {
    const input = base();
    input.lices = [
      lice({ id: 'L3', name: 'Piste 3', sort_order: 2 }),
      lice({ id: 'L1', name: 'Piste 1', sort_order: 0 }),
      lice({ id: 'L2', name: 'Piste 2', sort_order: 1 }),
    ];
    expect(assembleBoardRows(input).map((r) => r.lice.id)).toEqual(['L1', 'L2', 'L3']);
  });

  it('scopes matches, queue and history to their own lice', () => {
    const input = base();
    input.lices = [lice({ id: 'L1' }), lice({ id: 'L2', name: 'Piste 2', sort_order: 1 })];
    input.matches = [
      match({ id: 'm1', lice_id: 'L1', status: 'running' }),
      match({ id: 'm2', lice_id: 'L2', status: 'scheduled' }),
    ];
    input.recentCompleted = [
      match({ id: 'd2', lice_id: 'L2', status: 'completed', ended_at: '2026-07-21T09:00:00Z' }),
    ];
    const [one, two] = assembleBoardRows(input);
    expect(one!.currentMatch?.id).toBe('m1');
    expect(one!.lastCompleted).toBeNull();
    expect(two!.currentMatch?.id).toBe('m2');
    expect(two!.lastCompleted?.matchId).toBe('d2');
  });
});

describe('buildBoardAccounts', () => {
  it('lists every account with the pistes it covers', () => {
    const accounts = [
      account({ id: 'a1' }),
      account({ id: 'a2', display_name: 'Tom', username: 'tom' }),
    ];
    const assignments = [
      { staff_account_id: 'a1', lice_id: 'L1' },
      { staff_account_id: 'a1', lice_id: 'L2' },
    ];
    expect(buildBoardAccounts(accounts, assignments)).toEqual([
      {
        accountId: 'a1',
        name: 'Léa',
        username: 'lea',
        status: 'active',
        lastSeenAt: null,
        liceIds: ['L1', 'L2'],
      },
      {
        accountId: 'a2',
        name: 'Tom',
        username: 'tom',
        status: 'active',
        lastSeenAt: null,
        liceIds: [],
      },
    ]);
  });
});
