'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { CATEGORIES, type PlatformFilters, SEVERITIES } from './platform-entry';

const FIELD =
  'border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30';

/** The Platform tab's filter form; moved out of `PlatformLogPanel` with no change of behaviour. */
export function PlatformLogFilters({
  draft,
  onDraft,
  onApply,
  onClear,
  perPage,
  onPerPage,
}: {
  draft: PlatformFilters;
  onDraft: (key: keyof PlatformFilters, value: string) => void;
  onApply: () => void;
  onClear: () => void;
  perPage: number;
  onPerPage: (perPage: number) => void;
}) {
  return (
    <section className="border border-border rounded-lg p-4 mb-5">
      <FilterFields draft={draft} onDraft={onDraft} />
      <FilterActions onApply={onApply} onClear={onClear} perPage={perPage} onPerPage={onPerPage} />
    </section>
  );
}

function FilterFields({
  draft,
  onDraft,
}: {
  draft: PlatformFilters;
  onDraft: (key: keyof PlatformFilters, value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_1fr_150px_150px]">
      <select
        value={draft.category}
        onChange={(event) => onDraft('category', event.target.value)}
        className={FIELD}
      >
        <option value="">{t('admin.platformLog.filters.categoryAll')}</option>
        {CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {t(`admin.platformLog.category.${category}`)}
          </option>
        ))}
      </select>
      <select
        value={draft.severity}
        onChange={(event) => onDraft('severity', event.target.value)}
        className={FIELD}
      >
        <option value="">{t('admin.platformLog.filters.severityAll')}</option>
        {SEVERITIES.map((severity) => (
          <option key={severity} value={severity}>
            {t(`admin.platformLog.severity.${severity}`)}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={draft.from}
        onChange={(event) => onDraft('from', event.target.value)}
        className={FIELD}
      />
      <input
        type="date"
        value={draft.to}
        onChange={(event) => onDraft('to', event.target.value)}
        className={FIELD}
      />
    </div>
  );
}

function FilterActions({
  onApply,
  onClear,
  perPage,
  onPerPage,
}: {
  onApply: () => void;
  onClear: () => void;
  perPage: number;
  onPerPage: (perPage: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        onClick={onApply}
        className="bg-accent hover:bg-accent-hover text-white font-semibold py-2 px-4 rounded-md text-sm"
      >
        {t('admin.platformLog.filters.applyButton')}
      </button>
      <button
        onClick={onClear}
        className="border border-border hover:bg-background py-2 px-4 rounded-md text-sm"
      >
        {t('admin.platformLog.filters.clearButton')}
      </button>
      <label className="ml-auto flex items-center gap-2 text-sm text-foreground-secondary">
        {t('admin.platformLog.filters.rowsLabel')}
        <select
          value={perPage}
          onChange={(event) => onPerPage(Number(event.target.value))}
          className="border border-border rounded-md px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
        >
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </label>
    </div>
  );
}
