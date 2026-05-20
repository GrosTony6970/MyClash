'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AdminPageHeader,
  Button,
  ConfirmDialog,
  SortableHeader,
  fuzzyMatch,
  rowActionClasses,
  useSortableList,
  useToast,
  type RowActionVariant,
} from '@myclash/ui';
import { useI18n } from '../../../src/i18n/I18nProvider';

interface UserOrgMembership {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface AdminUser {
  id: string;
  email?: string;
  display_name?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
  app_metadata?: Record<string, unknown>;
  organizations?: UserOrgMembership[];
}

interface UserListResponse {
  users: AdminUser[];
}

interface CreateUserResponse {
  user: {
    id: string;
    email: string;
    created: boolean;
  };
  temporaryPassword: string;
  superAdminGranted: boolean;
}

function isDisabled(user: AdminUser): boolean {
  return Boolean(user.banned_until);
}

function formatDate(value: string | null | undefined, fallback: string) {
  return value ? new Date(value).toLocaleDateString('fr-FR') : fallback;
}

function getDisplayName(user: AdminUser, fallback: string): string {
  const displayName = user.display_name?.trim();
  return displayName || fallback;
}

function getAccountLabel(user: AdminUser): string {
  return user.display_name?.trim() || user.email || user.id;
}

async function readError(res: Response, fallback: string): Promise<string> {
  if (res.status === 429) return fallback;
  try {
    const data = (await res.json()) as { message?: unknown };
    if (typeof data.message === 'string') return data.message;
    if (data.message && typeof data.message === 'object') {
      const message = (data.message as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
  } catch {
    // Keep the UI on the generic localized error when the API body is empty.
  }
  return fallback;
}

function ActionButton({
  label,
  description,
  variant,
  onClick,
}: {
  label: string;
  description: string;
  variant: RowActionVariant;
  onClick: () => void;
}) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        title={description}
        aria-label={`${label}: ${description}`}
        onClick={onClick}
        className={rowActionClasses(variant)}
      >
        {label}
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 rounded-md bg-slate-950 px-3 py-2 text-left text-xs font-medium leading-5 text-white shadow-lg group-hover:block group-focus-within:block">
        {description}
      </span>
    </span>
  );
}

export default function AdminUsersPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createDisplayName, setCreateDisplayName] = useState('');
  const [createSuperAdmin, setCreateSuperAdmin] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<CreateUserResponse | null>(null);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/admin/users?perPage=100`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setError(t('admin.users.accessDenied'));
          setLoading(false);
          return;
        }
        if (res.status === 429) throw new Error(t('common.tooManyRequests'));
        if (!res.ok) throw new Error(t('admin.users.loadError'));
        const data = (await res.json()) as UserListResponse;
        if (!cancelled) {
          setUsers(data.users ?? []);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('admin.users.genericError'));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiUrl, refreshKey, t]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    setCreateResult(null);

    const res = await fetch(`${apiUrl}/api/v1/admin/users`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: createEmail,
        displayName: createDisplayName || undefined,
        makeSuperAdmin: createSuperAdmin,
      }),
    });

    setCreating(false);
    if (!res.ok) {
      setCreateError(
        await readError(
          res,
          res.status === 429 ? t('common.tooManyRequests') : t('admin.users.create.failed'),
        ),
      );
      return;
    }

    const data = (await res.json()) as CreateUserResponse;
    setCreateResult(data);
    setCreateEmail('');
    setCreateDisplayName('');
    setCreateSuperAdmin(false);
    refresh();
  }

  const toast = useToast();
  const [pending, setPending] = useState<
    | { kind: 'toggle'; user: AdminUser; action: 'disable' | 'enable' }
    | { kind: 'delete'; user: AdminUser; mode: 'safe' | 'cleanup' }
    | null
  >(null);
  const [actionBusy, setActionBusy] = useState(false);

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
          ),
        );
      }
    } finally {
      setActionBusy(false);
    }
  }

  // ── Live fuzzy filter + sort ─────────────────────────────────────────────
  // The page already loads the first 100 rows on mount. Filter + sort both
  // run client-side on whatever the API returned.
  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users;
    return users.filter((user) =>
      fuzzyMatch(
        search,
        [
          user.display_name ?? '',
          user.email ?? '',
          user.id,
          (user.organizations ?? []).map((org) => `${org.name} ${org.role}`).join(' '),
        ]
          .filter(Boolean)
          .join(' '),
      ),
    );
  }, [users, search]);
  const getUserSortValue = useCallback((row: AdminUser, key: string): unknown => {
    switch (key) {
      case 'displayName':
        return row.display_name ?? '';
      case 'email':
        return row.email ?? '';
      case 'created':
        return row.created_at ?? null;
      case 'lastSignIn':
        return row.last_sign_in_at ?? null;
      default:
        return null;
    }
  }, []);
  const {
    sorted: visibleUsers,
    sortKey,
    direction,
    toggle,
  } = useSortableList(filteredUsers, getUserSortValue);

  return (
    <main id="main-content" className="mx-auto w-full space-y-6 px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow={t('admin.dashboard.eyebrow')}
        title={t('admin.users.title')}
        subtitle={t('admin.users.description')}
        actions={
          <Button variant="back" onClick={refresh}>
            {t('admin.users.refresh')}
          </Button>
        }
      />

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">{t('admin.users.create.title')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('admin.users.create.description')}</p>

        <form
          className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end"
          onSubmit={(event) => {
            void handleCreate(event);
          }}
        >
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            {t('admin.users.create.email')}
            <input
              type="email"
              required
              value={createEmail}
              onChange={(event) => setCreateEmail(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            {t('admin.users.create.displayName')}
            <input
              type="text"
              value={createDisplayName}
              onChange={(event) => setCreateDisplayName(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
          >
            {creating ? t('admin.users.create.submitting') : t('admin.users.create.submit')}
          </button>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 lg:col-span-3">
            <input
              type="checkbox"
              checked={createSuperAdmin}
              onChange={(event) => setCreateSuperAdmin(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            {t('admin.users.create.makeSuperAdmin')}
          </label>
        </form>

        {createError && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {createError}
          </div>
        )}

        {createResult && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">{t('admin.users.create.success')}</p>
            <p>
              {t('admin.users.create.loginEmail')}: {createResult.user.email}
            </p>
            <p className="font-mono">
              {t('admin.users.create.temporaryPassword')}: {createResult.temporaryPassword}
            </p>
            {createResult.superAdminGranted && <p>{t('admin.users.create.superAdminGranted')}</p>}
          </div>
        )}
      </section>

      {error && (
        <div className="flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={refresh}
            className="w-fit rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
          >
            {t('actions.retry')}
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          aria-label={t('admin.common.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('admin.common.searchPlaceholder')}
          className="w-72 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="px-2 text-sm text-slate-500 hover:text-slate-700"
          >
            {t('actions.clear')}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">{t('admin.users.loading')}</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-slate-500">{t('admin.users.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                <th className="px-4 py-3">
                  <SortableHeader
                    label={t('admin.users.table.displayName')}
                    columnKey="displayName"
                    currentKey={sortKey}
                    direction={direction}
                    onToggle={toggle}
                    ariaSortAsc={t('admin.common.sortAscLabel')}
                    ariaSortDesc={t('admin.common.sortDescLabel')}
                  />
                </th>
                <th className="px-4 py-3">
                  <SortableHeader
                    label={t('admin.users.table.email')}
                    columnKey="email"
                    currentKey={sortKey}
                    direction={direction}
                    onToggle={toggle}
                    ariaSortAsc={t('admin.common.sortAscLabel')}
                    ariaSortDesc={t('admin.common.sortDescLabel')}
                  />
                </th>
                <th className="px-4 py-3">{t('admin.users.table.organizations')}</th>
                <th className="px-4 py-3">{t('admin.users.table.userId')}</th>
                <th className="px-4 py-3">
                  <SortableHeader
                    label={t('admin.users.table.created')}
                    columnKey="created"
                    currentKey={sortKey}
                    direction={direction}
                    onToggle={toggle}
                    ariaSortAsc={t('admin.common.sortAscLabel')}
                    ariaSortDesc={t('admin.common.sortDescLabel')}
                  />
                </th>
                <th className="px-4 py-3">
                  <SortableHeader
                    label={t('admin.users.table.lastSignIn')}
                    columnKey="lastSignIn"
                    currentKey={sortKey}
                    direction={direction}
                    onToggle={toggle}
                    ariaSortAsc={t('admin.common.sortAscLabel')}
                    ariaSortDesc={t('admin.common.sortDescLabel')}
                  />
                </th>
                <th className="px-4 py-3">{t('admin.users.table.status')}</th>
                <th className="px-4 py-3">{t('admin.users.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => {
                const disabled = isDisabled(user);
                return (
                  <tr key={user.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-950">
                      {getDisplayName(user, t('admin.users.noDisplayName'))}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-950">
                      {user.email ?? t('admin.users.noEmail')}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      {(user.organizations ?? []).length === 0 ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {(user.organizations ?? []).slice(0, 3).map((org) => (
                            <span
                              key={org.id}
                              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5"
                              title={org.name}
                            >
                              {org.name} <span className="text-slate-400">· {org.role}</span>
                            </span>
                          ))}
                          {(user.organizations ?? []).length > 3 && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
                              +{(user.organizations ?? []).length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{user.id}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(user.created_at, t('admin.users.missingDate'))}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(user.last_sign_in_at, t('admin.users.missingDate'))}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          disabled ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {disabled
                          ? t('admin.users.status.disabled')
                          : t('admin.users.status.active')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Link href={`/admin/users/${user.id}`} className={rowActionClasses('edit')}>
                          {t('admin.users.actions.edit')}
                        </Link>
                        <ActionButton
                          label={
                            disabled
                              ? t('admin.users.actions.enable')
                              : t('admin.users.actions.disable')
                          }
                          description={
                            disabled
                              ? t('admin.users.actions.enableHelp')
                              : t('admin.users.actions.disableHelp')
                          }
                          onClick={() => {
                            setPending({
                              kind: 'toggle',
                              user,
                              action: disabled ? 'enable' : 'disable',
                            });
                          }}
                          variant={disabled ? 'success' : 'warning'}
                        />
                        <ActionButton
                          label={t('admin.users.actions.safeDelete')}
                          description={t('admin.users.actions.safeDeleteHelp')}
                          onClick={() => {
                            setPending({ kind: 'delete', user, mode: 'safe' });
                          }}
                          variant="neutral"
                        />
                        <ActionButton
                          label={t('admin.users.actions.cleanupDelete')}
                          description={t('admin.users.actions.cleanupDeleteHelp')}
                          onClick={() => {
                            setPending({ kind: 'delete', user, mode: 'cleanup' });
                          }}
                          variant="danger"
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
    </main>
  );
}
