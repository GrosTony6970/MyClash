'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useConfirm } from '../components/useConfirm';
import type { Translator } from '../types/translator';
import { leaveTarget } from '../utils/leave-target';

/**
 * Ask before a page with unsaved edits is left (quick-win M4, then O12 and O15, operator
 * 2026-10-14).
 *
 * While `dirty`, three ways out ask first: a click on a link to another page of the site (the
 * app's own dialog; the listener runs in the capture phase on `document`, so before Next's `Link`
 * sees the click), closing or reloading the browser tab (the browser's own `beforeunload`
 * prompt), and whatever the page itself calls `askToLeave()` for (a tab switch, a Cancel). The
 * browser's Back button is not guarded: Next has no clean way to stop it.
 *
 * This package neither translates nor routes by itself: the app hands in its `t` and its
 * router's `push`. `body`, already translated, replaces the plain "they will be lost" when the
 * page knows better what is kept (the new-Event wizard after a partial Create).
 */
export function useLeaveGuard(
  dirty: boolean,
  { t, navigate, body }: { t: Translator; navigate: (href: string) => void; body?: string },
): {
  askToLeave: () => Promise<boolean>;
  confirmDialog: ReactNode;
} {
  const { confirm, confirmDialog } = useConfirm();
  const dirtyNow = useRef(dirty);
  const bodyNow = useRef(body);
  useEffect(() => {
    dirtyNow.current = dirty;
    bodyNow.current = body;
  }, [dirty, body]);

  const askToLeave = useCallback(
    async () =>
      !dirtyNow.current ||
      confirm({
        title: t('common.leaveGuard.title'),
        description: bodyNow.current ?? t('common.leaveGuard.body'),
        confirmLabel: t('common.leaveGuard.leave'),
        cancelLabel: t('common.leaveGuard.stay'),
        danger: true,
      }),
    [confirm, t],
  );

  useEffect(() => {
    if (!dirty) return undefined;
    return guardLeaving(askToLeave, navigate);
  }, [dirty, askToLeave, navigate]);

  return { askToLeave, confirmDialog };
}

/** The browser's prompt on unload, and the app's question on an in-site link. Returns the undo. */
function guardLeaving(askToLeave: () => Promise<boolean>, go: (href: string) => void): () => void {
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    // Older browsers show the prompt only when a value is set.
    event.returnValue = '';
  };
  const onClick = (event: MouseEvent) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    const href = leaveTarget(
      event,
      {
        href: anchor.getAttribute('href'),
        target: anchor.getAttribute('target'),
        download: anchor.hasAttribute('download'),
      },
      window.location.href,
    );
    if (!href) return;
    // preventDefault alone: Next's Link runs the link's own onClick (the phone drawer closes
    // there), then gives up on a prevented click. Stopping the event would keep the drawer open.
    event.preventDefault();
    // The page goes on with a plain push: a link's own `replace` / `scroll` are not kept.
    void askToLeave().then((leave) => {
      if (leave) go(href);
    });
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('click', onClick, true);
  return () => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('click', onClick, true);
  };
}
