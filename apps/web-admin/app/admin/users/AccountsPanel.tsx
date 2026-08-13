'use client';

import { useState } from 'react';
import { ConfirmDialog, useToast } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';
import { useAdminUsers } from './useAdminUsers';
import { AccountsTable } from './AccountsTable';
import { AccountsPagination } from './AccountsPagination';
import { getAccountLabel, readError, type AdminUser, type UsersTab } from './types';

type Pending =
  | { kind: 'toggle'; user: AdminUser; action: 'disable' | 'enable' }
  | { kind: 'delete'; user: AdminUser; mode: 'safe' | 'cleanup' }
  | null;

/** One tab: search, table, row actions, pagination. */
export function AccountsPanel({ tab }: { tab: UsersTab }) {
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [actionBusy, setActionBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  const { users, total, truncated, loading, error, refresh } = useAdminUsers(
    tab,
    page,
    perPage,
    search,
  );

  function changeSearch(next: string) {
    setSearch(next);
    // A filtered result set is shorter, so staying on page 7 would show an
    // empty table and read as "no matches".
    setPage(1);
  }

  async function performToggle(user: AdminUser, action: 'disable' | 'enable') {
    setActionBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/users/${user.id}/${action}`, {
        method: 'PATCH',
        credentials: 'include',
      });
      if (res.ok || res.status === 204) {
        toast.success(t(`admin.users.actions.${action}`));
        setPending(null);
        refresh();
      } else {
        toast.error(
          await readError(
            res,
            res.status === 429 ? t('common.tooManyRequests') : t('admin.users.actions.failed'),
          ),
        );
      }
    } finally {
      setActionBusy(false);
    }
  }

  async function performDelete(user: AdminUser, mode: 'safe' | 'cleanup') {
    setActionBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/users/${user.id}?mode=${mode}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        toast.success(
          t(
            mode === 'safe'
              ? 'admin.users.actions.safeDelete'
              : 'admin.users.actions.cleanupDelete',
          ),
        );
        setPending(null);
        refresh();
      } else {
        toast.error(
          await readError(
            res,
            res.status === 429 ? t('common.tooManyRequests') : t('admin.users.actions.failed'),
            t('admin.users.actions.blockers'),
          ),
        );
      }
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          aria-label={t('admin.common.searchPlaceholder')}
          value={search}
          onChange={(e) => changeSearch(e.target.value)}
          placeholder={t('admin.common.searchPlaceholder')}
          className="w-72 rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        {search && (
          <button
            type="button"
            onClick={() => changeSearch('')}
            className="px-2 text-sm text-muted hover:text-foreground-secondary"
          >
            {t('actions.clear')}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={refresh}
            className="w-fit rounded-md border border-danger/30 bg-surface px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10"
          >
            {t('actions.retry')}
          </button>
        </div>
      )}

      {truncated && (
        <p className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {t('admin.users.pagination.truncated')}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted">{t('admin.users.loading')}</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.users.empty')}</p>
      ) : (
        <AccountsTable
          tab={tab}
          users={users}
          onToggle={(user, action) => setPending({ kind: 'toggle', user, action })}
          onDelete={(user, mode) => setPending({ kind: 'delete', user, mode })}
        />
      )}

      {!loading && total > 0 && (
        <AccountsPagination
          total={total}
          page={page}
          perPage={perPage}
          onPage={setPage}
          onPerPage={(next) => {
            setPerPage(next);
            setPage(1);
          }}
        />
      )}

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'toggle'
            ? t(`admin.users.actions.${pending.action}`)
            : pending?.kind === 'delete'
              ? t(
                  pending.mode === 'safe'
                    ? 'admin.users.actions.safeDelete'
                    : 'admin.users.actions.cleanupDelete',
                )
              : ''
        }
        description={
          pending?.kind === 'toggle'
            ? t('admin.users.actions.confirmToggle', {
                action: t(`admin.users.actions.${pending.action}`),
                account: getAccountLabel(pending.user),
              })
            : pending?.kind === 'delete'
              ? t(
                  pending.mode === 'safe'
                    ? 'admin.users.actions.confirmSafeDelete'
                    : 'admin.users.actions.confirmCleanupDelete',
                  { account: getAccountLabel(pending.user) },
                )
              : ''
        }
        confirmLabel={
          pending?.kind === 'toggle'
            ? t(`admin.users.actions.${pending.action}`)
            : pending?.kind === 'delete'
              ? t(
                  pending.mode === 'safe'
                    ? 'admin.users.actions.safeDelete'
                    : 'admin.users.actions.cleanupDelete',
                )
              : ''
        }
        danger={
          pending?.kind === 'delete' || (pending?.kind === 'toggle' && pending.action === 'disable')
        }
        busy={actionBusy}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          if (pending.kind === 'toggle') void performToggle(pending.user, pending.action);
          else void performDelete(pending.user, pending.mode);
        }}
      />
    </>
  );
}
