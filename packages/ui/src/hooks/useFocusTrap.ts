import { useEffect, type RefObject } from 'react';

/**
 * useFocusTrap — keeps Tab focus inside the given container element while
 * `active` is true. On activation focus jumps to the first focusable element;
 * on deactivation focus is restored to wherever it was before.
 *
 * Used by ConfirmDialog, PromptDialog, and the mobile sidebar drawer.
 */
const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap(active: boolean, containerRef: RefObject<HTMLElement | null>) {
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
      previouslyFocused?.focus?.();
    };
  }, [active, containerRef]);
}
