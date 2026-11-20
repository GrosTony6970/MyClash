'use client';

import { Button, Modal } from '@myclash/ui';
import { type ReactNode, type RefObject, useEffect, useRef } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { type EntrySelectionState, entryButton, panelArrowStep } from './use-entry-selection';

/**
 * The side panel of one log entry (rulings 911, 912), for both tabs: the shared `Modal` on its
 * side placement, with Previous / Next and the arrow keys moving through the page's rows.
 *
 * Previous and Next are `aria-disabled` at a page edge, never `disabled`: a disabled button that
 * holds focus drops it to the page, out of the dialog.
 */
export function EntryPanelFrame({
  selection,
  title,
  children,
}: {
  selection: EntrySelectionState;
  title: ReactNode;
  children: ReactNode;
}) {
  const { entry, step, close } = selection;
  const anchor = useRef<HTMLSpanElement>(null);
  // The focused element can leave with the row it belonged to (an Event link, Resolve) when the
  // panel moves or reloads. The browser then puts focus on the page behind, out of the trap, and
  // the arrow keys stop. Bring it back to the footer's position line.
  useEffect(() => {
    const dialog = anchor.current?.closest('[role="dialog"]');
    if (entry && dialog && !dialog.contains(document.activeElement)) anchor.current?.focus();
  });
  return (
    <Modal
      open={entry !== null}
      onClose={close}
      placement="side"
      title={title}
      returnFocus={() => (entry ? entryButton(entry.id) : null)}
      onKeyDown={(event) => {
        const delta = panelArrowStep(event);
        if (delta === 0) return;
        event.preventDefault();
        step(delta);
      }}
      footer={<PanelFooter selection={selection} anchor={anchor} />}
    >
      {children}
    </Modal>
  );
}

function PanelFooter({
  selection,
  anchor,
}: {
  selection: EntrySelectionState;
  anchor: RefObject<HTMLSpanElement | null>;
}) {
  const { t } = useI18n();
  const { index, count, step, close } = selection;
  const atFirst = index <= 0;
  const atLast = index >= count - 1;
  return (
    <>
      <Button
        variant="secondary"
        aria-disabled={atFirst}
        onClick={() => step(-1)}
        className={atFirst ? 'opacity-40' : undefined}
      >
        {t('admin.log.panel.previous')}
      </Button>
      <span ref={anchor} tabIndex={-1} className="text-sm text-muted focus:outline-none">
        {t('admin.log.panel.position', { index: index + 1, count })}
      </span>
      <Button
        variant="secondary"
        aria-disabled={atLast}
        onClick={() => step(1)}
        className={atLast ? 'opacity-40' : undefined}
      >
        {t('admin.log.panel.next')}
      </Button>
      <Button variant="ghost" onClick={close} className="ml-auto">
        {t('admin.log.panel.close')}
      </Button>
    </>
  );
}

/** One labelled line of the panel: the label small and muted, the value loud (DESIGN.md, Type). */
export function PanelField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-border/60 py-3 last:border-b-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}
