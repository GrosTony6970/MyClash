'use client';

import { localeToBcp47, type AppLocale } from '@myclash/time';

/**
 * The extra reading a tripped query gets over the other platform-log sources:
 * how often it has happened, and a way to silence it.
 *
 * The count arrives from the API as a NUMBER, and the sentence is composed here.
 * Phrasing it server-side would hardcode English into a feed a French operator
 * reads (hard rule 6).
 */
export function QueryErrorDetail({
  occurrenceCount,
  firstSeenAt,
  resolvable,
  resolving,
  onResolve,
  locale,
  t,
}: {
  occurrenceCount: number | undefined;
  firstSeenAt: string | undefined;
  resolvable: boolean | undefined;
  resolving: boolean;
  onResolve: () => void;
  locale: AppLocale;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <>
      {occurrenceCount !== undefined && firstSeenAt && (
        <p className="mt-1 text-xs text-muted">
          {t('admin.platformLog.occurrences', {
            count: occurrenceCount,
            since: new Date(firstSeenAt).toLocaleString(localeToBcp47(locale)),
          })}
        </p>
      )}
      {resolvable && (
        // `aria-disabled`, not `disabled`: a disabled button that holds focus drops it to the
        // page, out of the side panel's trap (ruling 911). The click is held here instead.
        <button
          type="button"
          onClick={() => {
            if (!resolving) onResolve();
          }}
          aria-disabled={resolving}
          className="mt-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-semibold text-foreground-secondary hover:bg-background aria-disabled:opacity-50"
        >
          {t('admin.platformLog.resolve')}
        </button>
      )}
    </>
  );
}
