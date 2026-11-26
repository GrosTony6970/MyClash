/**
 * Whether the Event timeline is folded, remembered per Event in this browser.
 * Open is the default: nothing stored, or a browser that keeps no site data.
 */

const keyOf = (eventId: string) => `myclash.eventTimeline.collapsed.${eventId}`;

export function rememberedCollapsed(eventId: string): boolean {
  try {
    return window.localStorage.getItem(keyOf(eventId)) === '1';
  } catch {
    return false;
  }
}

export function rememberCollapsed(eventId: string, collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(keyOf(eventId), '1');
    else window.localStorage.removeItem(keyOf(eventId));
  } catch {
    // Site data blocked: the fold lasts until the page is left.
  }
}
