import { useEffect, useRef, type RefObject } from 'react';

/**
 * useFocusTrap — keeps Tab focus inside the given container element while
 * `active` is true. On activation focus jumps to the first focusable element;
 * on deactivation focus is restored to wherever it was before — or to `returnFocus()` when the
 * caller gives one and it answers an element: a side panel that moved to another row gives focus
 * back to that row, not to the row it opened on (ruling 912).
 *
 * Used by Modal, ConfirmDialog, PromptDialog, and the mobile sidebar drawer.
 */
const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  returnFocus?: () => HTMLElement | null,
) {
  // The latest `returnFocus`, read at close: the effect below runs once per opening.
  const latestReturn = useRef(returnFocus);
  useEffect(() => {
    latestReturn.current = returnFocus;
  });
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
    ).filter((el) => !el.hasAttribute('inert') && el.offsetParent !== null);
    focusables[0]?.focus();

    function handleKey(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const container2 = containerRef.current;
      if (!container2) return;
      const current = Array.from(
        container2.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
      ).filter((el) => !el.hasAttribute('inert') && el.offsetParent !== null);
      if (current.length === 0) {
        event.preventDefault();
        return;
      }
      const first = current[0]!;
      const last = current[current.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      (latestReturn.current?.() ?? previouslyFocused)?.focus?.();
    };
  }, [active, containerRef]);
}
