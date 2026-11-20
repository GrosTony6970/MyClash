'use client';

import { DataTableCell, DataTableRow } from '@myclash/ui';
import type { ReactNode } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { rowClickOpens } from './use-entry-selection';

/**
 * A row of either Log tab that opens its entry's side panel (ruling 911). Its first cell is the
 * time, as a real button: the keyboard's way in. A click elsewhere on the row is the mouse's
 * shortcut, except on a link or a button, which do their own job.
 */
export function EntryRow({
  id,
  time,
  selected,
  onOpen,
  children,
}: {
  id: string;
  time: string;
  selected: boolean;
  onOpen: (id: string) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <DataTableRow
      aria-current={selected ? 'true' : undefined}
      className="cursor-pointer"
      onClick={(event) => {
        if (rowClickOpens(event)) onOpen(id);
      }}
    >
      <DataTableCell className="whitespace-nowrap text-foreground-secondary">
        <button
          type="button"
          data-entry-open={id}
          onClick={() => onOpen(id)}
          className="rounded-md text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        >
          {/* The time stays the button's name; the hidden words say what it does. */}
          <span className="sr-only">{t('admin.log.panel.openEntry')} · </span>
          {time}
        </button>
      </DataTableCell>
      {children}
    </DataTableRow>
  );
}
