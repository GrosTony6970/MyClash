import { describe, expect, it } from 'vitest';
import { breakEditSteps, type BarDraft, type BarState } from './break-edit-steps';

const current: BarState = {
  label: 'Lunch',
  startTime: '12:00',
  endTime: '13:00',
  colorHex: null,
};

function draft(over: Partial<BarDraft> = {}): BarDraft {
  return { label: 'Lunch', startHHMM: '12:00', endHHMM: '13:00', colorHex: '', ...over };
}

describe('breakEditSteps', () => {
  it('sends nothing when nothing changed', () => {
    expect(breakEditSteps(current, draft())).toEqual([]);
  });

  it('sends only the label step when only the name changed', () => {
    expect(breakEditSteps(current, draft({ label: 'Lunch break' }))).toEqual([
      { kind: 'label', label: 'Lunch break', colorHex: null },
    ]);
  });

  it('treats an empty colour as the kind default, not as a change', () => {
    expect(breakEditSteps(current, draft({ colorHex: '' }))).toEqual([]);
  });

  it('sends the label step when a colour is picked', () => {
    expect(breakEditSteps(current, draft({ colorHex: '#ff0000' }))).toEqual([
      { kind: 'label', label: 'Lunch', colorHex: '#ff0000' },
    ]);
  });

  /**
   * The fix. `/move` preserves the bar's duration by carrying its end along,
   * so editing only the start silently moved the end too — contradicting the
   * end field the operator was looking at as they saved. The end is now always
   * set explicitly after a move.
   */
  it('pins the end the form showed when only the start moved', () => {
    expect(breakEditSteps(current, draft({ startHHMM: '11:30' }))).toEqual([
      { kind: 'move', newStartTime: '11:30' },
      { kind: 'resize', newEndTime: '13:00' },
    ]);
  });

  it('moves before it resizes, because only the move cascades', () => {
    const steps = breakEditSteps(current, draft({ startHHMM: '11:30', endHHMM: '12:15' }));

    expect(steps.map((s) => s.kind)).toEqual(['move', 'resize']);
    expect(steps).toEqual([
      { kind: 'move', newStartTime: '11:30' },
      { kind: 'resize', newEndTime: '12:15' },
    ]);
  });

  it('resizes alone when only the end moved, so the day does not shift', () => {
    expect(breakEditSteps(current, draft({ endHHMM: '13:30' }))).toEqual([
      { kind: 'resize', newEndTime: '13:30' },
    ]);
  });

  it('orders the label step first so a failed retime still keeps the rename', () => {
    const steps = breakEditSteps(current, draft({ label: 'Long lunch', startHHMM: '11:30' }));

    expect(steps.map((s) => s.kind)).toEqual(['label', 'move', 'resize']);
  });
});
