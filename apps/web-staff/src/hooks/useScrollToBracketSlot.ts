'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Scroll a bracket slot into view once per open.
 *
 * Targets `[data-bracket-slot-id]`, a render-neutral locator every bracket card
 * already carries — the same hook point the public bracket uses to find a
 * viewer's own slot. Guarded so a re-render or a re-fetch does not yank the
 * scroller out from under an operator who has panned somewhere else.
 */
export function useScrollToBracketSlot(
  scroller: RefObject<HTMLElement | null>,
  slotId: string | null,
  open: boolean,
  ready: boolean,
): void {
  const scrolledFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      scrolledFor.current = null;
      return;
    }
    if (!ready || !slotId || scrolledFor.current === slotId) return;
    const node = scroller.current?.querySelector(`[data-bracket-slot-id="${slotId}"]`);
    if (!node) return;
    scrolledFor.current = slotId;
    node.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [scroller, slotId, open, ready]);
}
