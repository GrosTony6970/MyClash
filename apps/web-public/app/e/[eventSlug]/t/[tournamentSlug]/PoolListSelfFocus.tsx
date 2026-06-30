'use client';

/**
 * Personal-space-only: on landing, scrolls the Pool List to the viewer's own
 * pool (the pool they fight in or referee — resolved by the page via
 * `buildSelfPoolHighlight`). Renders nothing.
 *
 * `PoolsCompositionView` is a shared server component (also used by the public
 * `/e/` SSR page), so it can't host this effect; this thin client child lives
 * inside the Pool List panel instead. DOM-only side effect (no React state),
 * mirroring the proven hidden-tab-safe pattern in PoolMatchesView: rAF defers
 * the scroll until layout settles, and a MutationObserver re-fires when the
 * (initially hidden) Pools tab becomes visible — so it also works when the user
 * opens the Pool List on a running/completed tournament (where another tab is
 * the default).
 */

import { useEffect } from 'react';

export function PoolListSelfFocus({ targetPoolId }: { targetPoolId: string | null }) {
  useEffect(() => {
    if (!targetPoolId) return;
    const panel = document.getElementById('panel-pools');
    let raf = 0;
    let done = false;

    const focus = () => {
      if (done) return;
      const el = document.getElementById(`poollist-pool-${targetPoolId}`);
      // offsetParent is null while the tab panel is `hidden` (display:none) —
      // scrolling then is a no-op, so wait for it to become visible.
      if (!el || el.offsetParent === null) return;
      done = true;
      raf = requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };

    focus(); // common case: Pools is the default/active tab on landing.

    let observer: MutationObserver | undefined;
    if (panel && !done) {
      observer = new MutationObserver(() => {
        if (!panel.hasAttribute('hidden')) focus();
      });
      observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [targetPoolId]);

  return null;
}
