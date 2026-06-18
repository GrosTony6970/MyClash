import { describe, expect, it } from 'vitest';
import { blockDeleteAction } from './schedule-block-actions';

describe('blockDeleteAction', () => {
  it('unschedules the matches of a pool run', () => {
    expect(blockDeleteAction({ kind: 'pool', matchIds: ['m1', 'm2'], blockId: 'ignored' })).toEqual(
      { kind: 'unschedule', matchIds: ['m1', 'm2'] },
    );
  });

  it('unschedules a bracket run (e.g. a final)', () => {
    expect(blockDeleteAction({ kind: 'bracket', matchIds: ['m9'], blockId: 'ignored' })).toEqual({
      kind: 'unschedule',
      matchIds: ['m9'],
    });
  });

  it('unschedules a standalone (other) run', () => {
    expect(blockDeleteAction({ kind: 'other', matchIds: ['m3'], blockId: 'ignored' })).toEqual({
      kind: 'unschedule',
      matchIds: ['m3'],
    });
  });

  it('deletes the programme block for a break bar', () => {
    expect(blockDeleteAction({ kind: 'break', matchIds: [], blockId: 'blk-1' })).toEqual({
      kind: 'delete-block',
      blockId: 'blk-1',
    });
  });

  it('deletes the programme block for an admin bar', () => {
    expect(blockDeleteAction({ kind: 'admin', matchIds: [], blockId: 'blk-2' })).toEqual({
      kind: 'delete-block',
      blockId: 'blk-2',
    });
  });
});
