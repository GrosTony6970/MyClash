/**
 * Seed a BlockEditDraft for the "double-click an empty cell → add a break"
 * flow: snap the clicked slot to 15 min and default to a 30-minute span, no
 * lices, no color. Pure — the caller turns the draft into a POST.
 */

import { slotToHHMM, snapSlot } from '@myclash/schedule-core';
import type { BlockEditDraft } from './BlockEditPopover';

const DEFAULT_SPAN_SLOTS = 6; // 30 min at SLOT_MINUTES = 5

export function newBreakDraftFromCell(slot: number): BlockEditDraft {
  const start = snapSlot(slot);
  return {
    label: 'Break',
    startHHMM: slotToHHMM(start),
    endHHMM: slotToHHMM(start + DEFAULT_SPAN_SLOTS),
    liceIds: [],
    colorHex: '',
  };
}
