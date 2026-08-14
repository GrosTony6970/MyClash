/**
 * Seed a BlockEditDraft for the "double-click an empty cell → add a break"
 * flow: snap the clicked slot to 15 min and default to a 30-minute span, no
 * lices, no color. Pure — the caller turns the draft into a POST.
 */

import { slotToHHMM, snapSlot } from '@myclash/schedule-core';
import type { BlockEditDraft } from './BlockEditPopover';

const DEFAULT_SPAN_SLOTS = 6; // 30 min at SLOT_MINUTES = 5

/**
 * `label` is passed in rather than defaulted here. It used to be the literal
 * 'Break', which the i18n lint rule cannot see inside a pure module — and
 * because the popover pre-fills it, `draft.label` was always truthy, so the
 * translated fallback in `createBreakBlock` never fired. A French organiser
 * got an English bar name every time.
 */
export function newBreakDraftFromCell(slot: number, label: string): BlockEditDraft {
  const start = snapSlot(slot);
  return {
    label,
    startHHMM: slotToHHMM(start),
    endHHMM: slotToHHMM(start + DEFAULT_SPAN_SLOTS),
    liceIds: [],
    colorHex: '',
  };
}
