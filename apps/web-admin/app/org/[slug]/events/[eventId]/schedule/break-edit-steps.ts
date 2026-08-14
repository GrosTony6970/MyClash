/**
 * What a programme-bar edit sends, and in what order.
 *
 * The popover CASCADES on purpose where dragging the bar's top edge does not:
 * typing a new start here means "the rest of the day moves with it", while
 * dragging the top edge means "this bar gets shorter". Two gestures, two
 * intents, kept apart deliberately.
 *
 * The trap is that `/move` also carries the END along by the same delta to
 * preserve the duration — so editing only the start silently changed the end,
 * contradicting the end field the operator was looking at as they saved. A
 * start change is therefore always followed by an explicit end set: the
 * cascade still happens, and the bar lands exactly where the form promised.
 *
 * Order matters and is not a fan-out. `/move` cascades and `/resize` does not,
 * so running them out of order changes the result.
 *
 * Pure: no React, no I/O — the caller turns each step into a request.
 */

export interface BarState {
  label: string;
  startTime: string;
  endTime: string;
  colorHex: string | null;
}

export interface BarDraft {
  label: string;
  startHHMM: string;
  endHHMM: string;
  /** '' means "no colour picked" → the kind's default. */
  colorHex: string;
}

export type BreakEditStep =
  | { kind: 'label'; label: string; colorHex: string | null }
  | { kind: 'move'; newStartTime: string }
  | { kind: 'resize'; newEndTime: string };

export function breakEditSteps(current: BarState, draft: BarDraft): BreakEditStep[] {
  const steps: BreakEditStep[] = [];
  const draftColor = draft.colorHex || null;

  if (draft.label !== current.label || draftColor !== current.colorHex) {
    steps.push({ kind: 'label', label: draft.label, colorHex: draftColor });
  }

  const startChanged = draft.startHHMM !== current.startTime;
  if (startChanged) steps.push({ kind: 'move', newStartTime: draft.startHHMM });

  // Always after a move — see the note above.
  if (startChanged || draft.endHHMM !== current.endTime) {
    steps.push({ kind: 'resize', newEndTime: draft.endHHMM });
  }

  return steps;
}
