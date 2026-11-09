'use client';

import type { BoardWorkshop } from '@myclash/schedule-core';
import { formatInZone, localeToBcp47 } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { drawerDragPayload, writeDrag, type DrawerEntry } from './workshop-drawer';

interface Props<W extends BoardWorkshop & { category?: string | null; level?: string | null }> {
  entries: Array<DrawerEntry<W>>;
  timezone: string;
  readOnly: boolean;
  /** A drag began, carrying `span` slots: the grid's drop shadow takes that height. */
  onDragStart: (span: number) => void;
  onDragEnd: () => void;
}

/**
 * The board drawer's list (operator ruling 524): every Workshop, which a drag adds a session of,
 * and under it each of its sessions the board cannot draw, which a drag places.
 */
export function WorkshopDrawerList<W extends BoardWorkshop>({
  entries,
  timezone,
  readOnly,
  onDragStart,
  onDragEnd,
}: Props<W>) {
  const { t, locale } = useI18n();
  if (entries.length === 0) {
    return <p className="text-xs text-muted">{t('organizer.workshopsPage.board.noWorkshops')}</p>;
  }
  const when = (iso: string) =>
    formatInZone(
      iso,
      timezone,
      { weekday: 'short', hour: '2-digit', minute: '2-digit' },
      localeToBcp47(locale),
    );
  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry) => {
        const w = entry.workshop;
        const drag = {
          draggable: !readOnly,
          onDragStart: (e: React.DragEvent<HTMLDivElement>) => {
            const payload = drawerDragPayload(entry);
            onDragStart(payload.span);
            writeDrag(e.dataTransfer, payload);
          },
          onDragEnd,
        };
        if (entry.kind === 'session') {
          return (
            <div
              key={entry.session.id}
              {...drag}
              className="ml-3 cursor-grab rounded-lg border border-dashed border-warning bg-surface px-3 py-1.5 text-xs text-foreground-secondary shadow-sm hover:border-accent"
              title={w.title}
            >
              {entry.session.startsAt
                ? t('organizer.workshopsPage.board.unplacedSession', {
                    when: when(entry.session.startsAt),
                  })
                : t('organizer.workshopsPage.board.unplacedSessionNoTime')}
            </div>
          );
        }
        const details =
          [w.category, w.level].filter(Boolean).join(' · ') ||
          (w.durationMinutes != null
            ? t('organizer.workshopsPage.board.minutesShort', { min: w.durationMinutes })
            : '—');
        return (
          <div
            key={w.id}
            {...drag}
            className="cursor-grab rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm hover:border-accent"
            title={w.title}
          >
            <span className="block truncate font-medium text-foreground">{w.title}</span>
            <span className="text-xs text-muted">{details}</span>
            {entry.sessions > 0 && (
              <span className="block text-xs text-muted">
                {t('organizer.workshopsPage.board.sessionsCount', { count: entry.sessions })}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
