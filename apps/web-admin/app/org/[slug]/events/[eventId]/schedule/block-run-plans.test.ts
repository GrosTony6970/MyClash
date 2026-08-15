import { describe, expect, it } from 'vitest';
import { blockLiceChange, liceSelectionChanged, runUnschedulePlan } from './block-run-plans';

const placed = (id: string, liceId: string, scheduledAt: string) => ({ id, liceId, scheduledAt });

const pool = {
  kind: 'pool',
  key: 'pool:p1',
  label: 'Pool A',
  matches: [{ id: 'm1' }, { id: 'm2' }],
};

describe('runUnschedulePlan', () => {
  it('unschedules the run and remembers where every fight was', () => {
    expect(
      runUnschedulePlan({
        block: pool,
        matches: [
          placed('m1', 'lice-1', '2026-08-15T09:00:00Z'),
          placed('m2', 'lice-1', '2026-08-15T09:05:00Z'),
          placed('m9', 'lice-2', '2026-08-15T09:00:00Z'),
        ],
      }),
    ).toEqual({
      label: 'Pool A',
      matchIds: ['m1', 'm2'],
      prior: [
        { id: 'm1', liceId: 'lice-1', scheduledAt: '2026-08-15T09:00:00Z' },
        { id: 'm2', liceId: 'lice-1', scheduledAt: '2026-08-15T09:05:00Z' },
      ],
    });
  });

  /**
   * A programme bar's × DELETES the bar instead. Returning a plan here would
   * unschedule the fights sitting under a break and leave the break in place.
   */
  it('declines a programme bar, whose × deletes rather than unschedules', () => {
    expect(
      runUnschedulePlan({
        block: { kind: 'break', key: 'b-1', label: 'Lunch', matches: [{ id: 'm1' }] },
        matches: [placed('m1', 'lice-1', '2026-08-15T12:00:00Z')],
      }),
    ).toBeNull();
  });

  /** No entry rather than an empty one — an undo that restores nothing still
   *  consumes a Ctrl+Z. */
  it('declines a run with no fight the board knows about', () => {
    expect(runUnschedulePlan({ block: pool, matches: [] })).toBeNull();
    expect(
      runUnschedulePlan({
        block: { ...pool, matches: [] },
        matches: [placed('m1', 'lice-1', '2026-08-15T09:00:00Z')],
      }),
    ).toBeNull();
  });

  /**
   * The writes cover the whole run; undo can only restore what the board holds a
   * position for. They agree on every board the grid draws, and the split is
   * what keeps a run that ever outgrows that assumption from unscheduling only
   * half of itself.
   */
  it('writes every fight in the run even when only some have a known position', () => {
    const plan = runUnschedulePlan({
      block: pool,
      matches: [placed('m1', 'lice-1', '2026-08-15T09:00:00Z')],
    });

    expect(plan?.matchIds).toEqual(['m1', 'm2']);
    expect(plan?.prior.map((p) => p.id)).toEqual(['m1']);
  });

  it('carries an already-unscheduled fight back to where it was', () => {
    const plan = runUnschedulePlan({
      block: { ...pool, matches: [{ id: 'm1' }] },
      matches: [{ id: 'm1', liceId: null, scheduledAt: null }],
    });

    expect(plan?.prior).toEqual([{ id: 'm1', liceId: null, scheduledAt: null }]);
  });
});

describe('liceSelectionChanged', () => {
  /** The popover appends checkboxes in click order, so the same two lices
   *  ticked the other way round is the same selection. */
  it('ignores the order the operator ticked them in', () => {
    expect(liceSelectionChanged(['a', 'b'], ['b', 'a'])).toBe(false);
  });

  it('reports an added, a removed and a swapped lice', () => {
    expect(liceSelectionChanged(['a'], ['a', 'b'])).toBe(true);
    expect(liceSelectionChanged(['a', 'b'], ['a'])).toBe(true);
    expect(liceSelectionChanged(['a'], ['b'])).toBe(true);
  });

  it('reports nothing for an unchanged selection, including an empty one', () => {
    expect(liceSelectionChanged([], [])).toBe(false);
    expect(liceSelectionChanged(['a'], ['a'])).toBe(false);
  });
});

describe('blockLiceChange', () => {
  /** Which fight may share a lice with which depends on the tree, so the server
   *  owns a bracket re-fan. */
  it('sends a bracket to the branch-aware re-fan across every chosen lice', () => {
    expect(
      blockLiceChange({ kind: 'bracket', matches: [{ id: 'm1' }, { id: 'm2' }] }, ['l1', 'l2']),
    ).toEqual({ mode: 'refan', matchIds: ['m1', 'm2'], liceIds: ['l1', 'l2'] });
  });

  /** A pool has no branch structure: it relocates onto the first lice
   *  client-side, exactly as dragging it there would. */
  it('relocates a pool onto the first chosen lice and ignores the rest', () => {
    expect(blockLiceChange(pool, ['l1', 'l2'])).toEqual({
      mode: 'relocate',
      matchIds: ['m1', 'm2'],
      liceId: 'l1',
    });
  });

  it('treats a loose cluster like a pool', () => {
    expect(blockLiceChange({ kind: 'other', matches: [{ id: 'm1' }] }, ['l1'])).toEqual({
      mode: 'relocate',
      matchIds: ['m1'],
      liceId: 'l1',
    });
  });

  it('declines an empty selection — there is nowhere to move the run to', () => {
    expect(blockLiceChange(pool, [])).toBeNull();
    expect(blockLiceChange({ kind: 'bracket', matches: [{ id: 'm1' }] }, [])).toBeNull();
  });
});
