'use client';

/**
 * Personal-space-only: on landing, scrolls a tab panel to the viewer's own row
 * (the `[data-self-row]` element the tab marks with the "YOU" chip) and gives it
 * a brief gold pulse. Renders nothing.
 *
 * Generalises the proven hidden-tab-safe pattern used by PoolListSelfFocus /
 * BracketLive to any panel that renders a single self row: pass the panel's DOM
 * id (`panel-standings`, `panel-finalranking`, …). DOM-only side effect (no React
 * state): rAF defers the scroll until layout settles; a one-shot guard keeps live
 * refetches from re-yanking the scroll. A single MutationObserver on the panel
 * covers both async cases — the row being injected once its data loads (childList
 * / subtree) and the tab un-hiding when the user deep-links to a non-default tab
 * (the `hidden` attribute) — then disconnects as soon as the scroll fires.
 */

import { useEffect } from 'react';

export function SelfRowFocus({ panelId, active }: { panelId: string; active: boolean }) {
  useEffect(() => {
    if (!active) return;
    const panel = document.getElementById(panelId);
    if (!panel) return;
    let raf = 0;
    let timer = 0;
    let done = false;
    let observer: MutationObserver | undefined;

    const focus = () => {
      if (done) return;
      const el = panel.querySelector<HTMLElement>('[data-self-row]');
      // offsetParent is null while the tab panel is `hidden` (display:none) —
      // scrolling then is a no-op, so wait for it to become visible.
      if (!el || el.offsetParent === null) return;
      done = true;
      observer?.disconnect();
      raf = requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      // Brief gold pulse to help locate the row; cleared after 2s. Inline style
      // so no per-tab styling change is needed.
      el.style.boxShadow = 'inset 0 0 0 2px #f59e0b';
      timer = window.setTimeout(() => {
        el.style.boxShadow = '';
      }, 2000);
    };

    focus(); // common case: the tab is active and the row already rendered.

    if (!done) {
      observer = new MutationObserver(focus);
      observer.observe(panel, {
        attributes: true,
        attributeFilter: ['hidden'],
        childList: true,
        subtree: true,
      });
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      observer?.disconnect();
    };
  }, [panelId, active]);

  return null;
}
