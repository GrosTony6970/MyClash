'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useConfirm } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { leaveTarget } from './leave-guard';

/**
 * Ask before a page with unsaved edits is left (quick-win M4, operator 2026-10-14).
 *
 * While `dirty`, three ways out ask first: a click on a link to another page of the site (the
 * app's own dialog; the listener runs in the capture phase on `document`, so before Next's `Link`
 * sees the click), closing or reloading the browser tab (the browser's own `beforeunload`
 * prompt), and whatever the page itself calls `askToLeave()` for (the profile's tabs). The
 * browser's Back button is not guarded: Next has no clean way to stop it.
 */
export function useLeaveGuard(dirty: boolean): {
  askToLeave: () => Promise<boolean>;
  confirmDialog: ReactNode;
} {
  const { t } = useI18n();
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const dirtyNow = useRef(dirty);
  useEffect(() => {
    dirtyNow.current = dirty;
  }, [dirty]);

  const askToLeave = useCallback(
    async () =>
      !dirtyNow.current ||
      confirm({
        title: t('publicApp.me.profile.leaveTitle'),
        description: t('publicApp.me.profile.leaveBody'),
        confirmLabel: t('publicApp.me.profile.leaveConfirm'),
        cancelLabel: t('publicApp.me.profile.leaveCancel'),
        danger: true,
      }),
    [confirm, t],
  );

  useEffect(() => {
    if (!dirty) return undefined;
    return guardLeaving(askToLeave, (href) => router.push(href));
  }, [dirty, askToLeave, router]);

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
