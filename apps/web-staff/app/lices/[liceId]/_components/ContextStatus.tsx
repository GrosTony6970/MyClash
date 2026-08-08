'use client';

import { useI18n } from '../../../../src/i18n/I18nProvider';

/**
 * Loading / retry / empty for the lazily-fetched pool and bracket sections.
 *
 * Retry is a full-width 44px button rather than a toast: the operator is on a
 * tablet with gloves on, and a failed reference fetch is not worth interrupting
 * scoring for — they tap it when they want it.
 */
export function ContextStatus({
  loading,
  error,
  empty,
  emptyLabel,
  onRetry,
}: {
  loading: boolean;
  error: boolean;
  empty: boolean;
  emptyLabel: string;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  if (error) {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="min-h-[44px] w-full rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted hover:border-muted"
      >
        {t('scoring.lice.contextLoadError')}
      </button>
    );
  }
  if (loading) {
    return <p className="px-4 py-3 text-sm text-muted">{t('scoring.lice.contextLoading')}</p>;
  }
  if (empty) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted">
        {emptyLabel}
      </p>
    );
  }
  return null;
}
