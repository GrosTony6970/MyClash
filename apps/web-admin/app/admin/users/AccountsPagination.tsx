'use client';

import { useI18n } from '../../../src/i18n/I18nProvider';

const PER_PAGE_CHOICES = [25, 50, 100] as const;

export interface AccountsPaginationProps {
  total: number;
  page: number;
  perPage: number;
  onPage: (page: number) => void;
  onPerPage: (perPage: number) => void;
}

/**
 * Page controls for one tab.
 *
 * The summary says "in this tab" rather than a bare count: the tabs are
 * predicates, not a partition, so an account holding both a platform role and
 * an organisation membership is counted under two of them and the three totals
 * do not add up to the number of accounts. A bare "1 284 accounts" on each tab
 * would invite exactly the wrong arithmetic.
 */
export function AccountsPagination({
  total,
  page,
  perPage,
  onPage,
  onPerPage,
}: AccountsPaginationProps) {
  const { t } = useI18n();
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-foreground-secondary">
      <span>
        {t('admin.users.pagination.summary')
          .replace('{total}', String(total))
          .replace('{page}', String(page))
          .replace('{pages}', String(totalPages))}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <label className="flex items-center gap-2">
          {t('admin.users.pagination.perPage')}
          <select
            value={perPage}
            onChange={(event) => onPerPage(Number(event.target.value))}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            {PER_PAGE_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(Math.max(1, page - 1))}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
        >
          {t('admin.users.pagination.previous')}
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
        >
          {t('admin.users.pagination.next')}
        </button>
      </div>
    </div>
  );
}
