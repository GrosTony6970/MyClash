'use client';

import Link from 'next/link';
import { localeToBcp47 } from '@myclash/time';
import { DataTable, DataTableCell, DataTableHead } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { EntryRow } from './EntryRow';
import { type PlatformLogEntry, SEVERITY_PILL } from './platform-entry';
import { QueryErrorDetail } from './QueryErrorDetail';

/**
 * The Platform tab's rows, moved out of `PlatformLogPanel`. A row opens the entry's side panel
 * (ruling 911); its link and its Resolve button do their own job.
 */
export function PlatformLogTable({
  items,
  selectedId,
  onOpen,
  resolving,
  onResolve,
}: {
  items: readonly PlatformLogEntry[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  resolving: string | null;
  onResolve: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <DataTable className="min-w-[1000px]">
      <DataTableHead>
        <DataTableCell as="th">{t('admin.platformLog.columns.occurred')}</DataTableCell>
        <DataTableCell as="th">{t('admin.platformLog.columns.category')}</DataTableCell>
        <DataTableCell as="th">{t('admin.platformLog.columns.severity')}</DataTableCell>
        <DataTableCell as="th">{t('admin.platformLog.columns.event')}</DataTableCell>
        <DataTableCell as="th">{t('admin.platformLog.columns.detail')}</DataTableCell>
        <DataTableCell as="th">{t('admin.platformLog.columns.actor')}</DataTableCell>
      </DataTableHead>
      <tbody>
        {items.map((entry) => (
          <EntryRow
            key={entry.id}
            id={entry.id}
            time={new Date(entry.occurredAt).toLocaleString(localeToBcp47(locale))}
            selected={entry.id === selectedId}
            onOpen={onOpen}
          >
            <PlatformCells
              entry={entry}
              resolving={resolving === entry.id}
              onResolve={() => onResolve(entry.id)}
            />
          </EntryRow>
        ))}
      </tbody>
    </DataTable>
  );
}

function PlatformCells({
  entry,
  resolving,
  onResolve,
}: {
  entry: PlatformLogEntry;
  resolving: boolean;
  onResolve: () => void;
}) {
  const { t, locale } = useI18n();
  const eventLabel = entry.title ?? t(`admin.platformLog.category.${entry.category}`);
  return (
    <>
      <DataTableCell className="whitespace-nowrap text-foreground-secondary">
        {t(`admin.platformLog.category.${entry.category}`)}
      </DataTableCell>
      <DataTableCell>
        <SeverityPill entry={entry} />
      </DataTableCell>
      <DataTableCell>
        {entry.href ? (
          <Link href={entry.href} className="font-medium text-accent hover:underline">
            {eventLabel}
          </Link>
        ) : (
          <span className="font-medium">{eventLabel}</span>
        )}
      </DataTableCell>
      <DataTableCell>
        <pre className="max-w-xl whitespace-pre-wrap break-words text-xs text-foreground-secondary">
          {entry.detail ?? '—'}
        </pre>
        <QueryErrorDetail
          occurrenceCount={entry.occurrenceCount}
          firstSeenAt={entry.firstSeenAt}
          resolvable={entry.resolvable}
          resolving={resolving}
          onResolve={onResolve}
          locale={locale}
          t={t}
        />
      </DataTableCell>
      <DataTableCell className="text-xs text-foreground-secondary">
        <ActorLines entry={entry} />
      </DataTableCell>
    </>
  );
}

export function SeverityPill({ entry }: { entry: PlatformLogEntry }) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-block rounded px-2 py-1 text-xs font-medium ${SEVERITY_PILL[entry.severity]}`}
    >
      {t(`admin.platformLog.severity.${entry.severity}`)}
    </span>
  );
}

/** The actor's name, then the email in small mono; a dash when no person acted. */
export function ActorLines({ entry }: { entry: PlatformLogEntry }) {
  const { t } = useI18n();
  return (
    <>
      {entry.actorUserId ? (
        <p className="font-medium">
          {entry.actorName ?? entry.actorEmail ?? t('admin.common.unknownUser')}
        </p>
      ) : (
        <span className="text-muted">—</span>
      )}
      {entry.actorName && entry.actorEmail && (
        <p className="font-mono text-muted">{entry.actorEmail}</p>
      )}
    </>
  );
}
