'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Fullscreen for a TV screen (quick win T5): one tap in place of a keyboard
 * the TV does not have.
 *
 * The browser leaves fullscreen when a page is LOADED. So a screen that offers
 * this must change bout without a load: see `onBoutOver` of `TVScoreboard`.
 *
 * Best effort, as the wake lock is: a browser may refuse the request (it wants
 * a tap, and some want more). The screen then stays as it was, and the button
 * still says "Fullscreen".
 */
export interface FullscreenPage {
  fullscreenEnabled?: boolean;
  fullscreenElement: unknown;
  documentElement: { requestFullscreen?: () => Promise<void> };
  exitFullscreen?: () => Promise<void>;
  addEventListener(type: 'fullscreenchange', listener: () => void): void;
  removeEventListener(type: 'fullscreenchange', listener: () => void): void;
}

/** A phone browser may have no fullscreen at all: its screen then offers no button. */
export function fullscreenSupported(page: FullscreenPage): boolean {
  return (
    page.fullscreenEnabled === true && typeof page.documentElement.requestFullscreen === 'function'
  );
}

export function isFullscreen(page: FullscreenPage): boolean {
  return page.fullscreenElement != null;
}

/** Into fullscreen, or out of it. A refusal of the browser changes nothing. */
export async function toggleFullscreen(page: FullscreenPage): Promise<void> {
  try {
    if (isFullscreen(page)) await page.exitFullscreen?.();
    else await page.documentElement.requestFullscreen?.();
  } catch {
    // Refused: the screen stays as it was.
  }
}

function subscribe(listener: () => void): () => void {
  document.addEventListener('fullscreenchange', listener);
  return () => document.removeEventListener('fullscreenchange', listener);
}

const never = () => () => undefined;
const no = () => false;

/** `supported`: show the button at all. `active`: the screen is in fullscreen now. */
export function useFullscreen(): { supported: boolean; active: boolean; toggle: () => void } {
  const supported = useSyncExternalStore(never, () => fullscreenSupported(document), no);
  const active = useSyncExternalStore(subscribe, () => isFullscreen(document), no);
  const toggle = useCallback(() => void toggleFullscreen(document), []);
  return { supported, active, toggle };
}
