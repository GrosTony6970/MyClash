import { describe, expect, it } from 'vitest';
import { newBreakDraftFromCell } from './new-break-draft';

describe('newBreakDraftFromCell', () => {
  it('snaps the cell to 15 min and spans 30 min by default', () => {
    // slot 14 = 09:10 → snaps to 09:15, +30 min → 09:45.
    expect(newBreakDraftFromCell(14, 'Break')).toEqual({
      label: 'Break',
      startHHMM: '09:15',
      endHHMM: '09:45',
      liceIds: [],
      colorHex: '',
    });
  });

  it('starts at the axis origin for slot 0', () => {
    const draft = newBreakDraftFromCell(0, 'Break');
    expect(draft.startHHMM).toBe('08:00');
    expect(draft.endHHMM).toBe('08:30');
  });
});
