'use client';

import Link from 'next/link';
import { localeToBcp47 } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { EntryPanelFrame, PanelField } from './EntryPanelFrame';
import type { PlatformLogEntry } from './platform-entry';
import { ActorLines, SeverityPill } from './PlatformLogTable';
import { QueryErrorDetail } from './QueryErrorDetail';
import type { EntrySelectionState } from './use-entry-selection';

/**
 * One Platform log entry in full (ruling 911): the whole detail text, never cut, and for a
 * tripped query its count and the Resolve button. The page's error banner sits under the dimmed
 * page, so a refused Resolve shows its message here too.
 */
export function PlatformEntryPanel({
  selection,
  busy,
  error,
  onResolve,
}: {
  selection: EntrySelectionState<PlatformLogEntry>;
  /** A Resolve is running, or the list is reloading after one: Resolve waits. */
  busy: boolean;
  error: string | null;
  onResolve: (id: string) => void;
}) {
  const { t } = useI18n();
  const entry = selection.entry;
  const title = entry ? (entry.title ?? t(`admin.platformLog.category.${entry.category}`)) : '';

  return (
    <EntryPanelFrame selection={selection} title={title}>
      {entry && (
        <>
          {error && (
            <p
              role="alert"
              className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          )}
          <PlatformFields entry={entry} title={title} busy={busy} onResolve={onResolve} />
        </>
      )}
    </EntryPanelFrame>
  );
}

function PlatformFields({
  entry,
  title,
  busy,
  onResolve,
}: {
  entry: PlatformLogEntry;
  title: string;
  busy: boolean;
  onResolve: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <dl>
      <PanelField label={t('admin.log.panel.when')}>
        {new Date(entry.occurredAt).toLocaleString(localeToBcp47(locale), {
          dateStyle: 'full',
          timeStyle: 'medium',
        })}
      </PanelField>
      <PanelField label={t('admin.platformLog.panel.category')}>
        {t(`admin.platformLog.category.${entry.category}`)}
      </PanelField>
      <PanelField label={t('admin.platformLog.panel.severity')}>
        <SeverityPill entry={entry} />
      </PanelField>
      {entry.href && (
        <PanelField label={t('admin.platformLog.panel.event')}>
          <Link href={entry.href} className="font-medium text-accent hover:underline">
            {title}
          </Link>
        </PanelField>
      )}
      <PanelField label={t('admin.platformLog.panel.detail')}>
        <DetailText entry={entry} busy={busy} onResolve={onResolve} />
      </PanelField>
      <PanelField label={t('admin.log.panel.who')}>
        <ActorLines entry={entry} />
      </PanelField>
    </dl>
  );
}

/** The whole detail text, never cut, then a tripped query's count and Resolve. */
function DetailText({
  entry,
  busy,
  onResolve,
}: {
  entry: PlatformLogEntry;
  busy: boolean;
  onResolve: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <>
      {entry.detail ? (
        <pre className="whitespace-pre-wrap break-words rounded-md bg-background p-3 font-mono text-xs text-foreground">
          {entry.detail}
        </pre>
      ) : (
        <span className="text-muted">{t('admin.platformLog.panel.noDetail')}</span>
      )}
      <QueryErrorDetail
        occurrenceCount={entry.occurrenceCount}
        firstSeenAt={entry.firstSeenAt}
        resolvable={entry.resolvable}
        resolving={busy}
        onResolve={() => onResolve(entry.id)}
        locale={locale}
        t={t}
      />
    </>
  );
}
