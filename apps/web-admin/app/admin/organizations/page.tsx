'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdminPageHeader, Button, ConfirmDialog, StatusBadge, useToast } from '@myclash/ui';
import { useUrlState } from '../../../src/hooks/useUrlState';
import { useI18n } from '../../../src/i18n/I18nProvider';

interface OrgListItem {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  owner_email: string | null;
  owner_name: string | null;
  owner_username: string | null;
  member_count: number;
  event_count: number;
  created_at: string;
  last_activity: string | null;
  is_protected: boolean;
}

interface CreateOrganizationResult {
  organization: {
    id: string;
    name: string;
    slug: string;
    status: 'active' | 'suspended';
  };
  owner: {
    userId: string;
    email: string;
    created: boolean;
    temporaryPassword?: string;
  };
  membership: {
    role: 'owner';
  };
  magicLinkSent: boolean;
}

type SortField = 'name' | 'created_at' | 'member_count' | 'event_count';

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export default function AdminOrganizationsPage() {
  const { t } = useI18n();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [orgs, setOrgs] = useState<OrgListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useUrlState<string>('q', '');
  const [statusFilter, setStatusFilter] = useUrlState<'all' | 'active' | 'suspended'>(
    'status',
    'all',
  );
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [refreshKey, setRefreshKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<CreateOrganizationResult | null>(null);
  const [form, setForm] = useState<{
    name: string;
    slug: string;
    ownerEmail: string;
    ownerDisplayName: string;
    ownerUserId: string;
    ownerMode: 'new' | 'existing';
    slugDetached: boolean;
  }>({
    name: '',
    slug: '',
    ownerEmail: '',
    ownerDisplayName: '',
    ownerUserId: '',
    ownerMode: 'new',
    slugDetached: false,
  });
  const toast = useToast();
  const [pendingAction, setPendingAction] = useState<{
    orgId: string;
    action: 'suspend' | 'approve' | 'delete';
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [ownerSearch, setOwnerSearch] = useState('');
  const [ownerResults, setOwnerResults] = useState<
    Array<{ id: string; email?: string; display_name?: string | null }>
  >([]);
  const [ownerSearchLoading, setOwnerSearchLoading] = useState(false);
  const [tempPasswordCopied, setTempPasswordCopied] = useState(false);

  useEffect(() => {
    if (form.ownerMode !== 'existing') return;
    const q = ownerSearch.trim();
    if (!q) {
      setOwnerResults([]);
      return;
    }
    const controller = new AbortController();
    setOwnerSearchLoading(true);
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ q, perPage: '10' });
      fetch(`${apiUrl}/api/v1/admin/users?${params}`, {
        credentials: 'include',
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error('search failed');
          const data = (await res.json()) as {
            users?: Array<{ id: string; email?: string; display_name?: string | null }>;
          };
          setOwnerResults(data.users ?? []);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setOwnerResults([]);
        })
        .finally(() => setOwnerSearchLoading(false));
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(handle);
    };
  }, [form.ownerMode, ownerSearch, apiUrl]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;

    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    params.set(
      'sortBy',
      sortField === 'member_count' || sortField === 'event_count' ? 'created_at' : sortField,
    );
    params.set('order', sortOrder);

    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/admin/organizations?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setError(t('admin.organizations.accessDenied'));
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error(t('admin.organizations.loadError'));
        const data = (await res.json()) as OrgListItem[];
        if (!cancelled) {
          setOrgs(data);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('admin.organizations.genericError'));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiUrl, search, statusFilter, sortField, sortOrder, refreshKey, t]);

  async function handleCreateSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateLoading(true);
    setCreateError(null);
    setCreateResult(null);

    try {
      const ownerPayload =
        form.ownerMode === 'existing'
          ? { ownerUserId: form.ownerUserId }
          : {
              ownerEmail: form.ownerEmail,
              ownerDisplayName: form.ownerDisplayName || undefined,
            };
      const res = await fetch(`${apiUrl}/api/v1/admin/organizations`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          slug: form.slug,
          ...ownerPayload,
        }),
      });

      if (res.status === 401 || res.status === 403) {
        throw new Error(t('admin.organizations.create.accessDenied'));
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message ?? t('admin.organizations.create.failed'));
      }

      const data = (await res.json()) as CreateOrganizationResult;
      setCreateResult(data);
      setForm({
        name: '',
        slug: '',
        ownerEmail: '',
        ownerDisplayName: '',
        ownerUserId: '',
        ownerMode: 'new',
        slugDetached: false,
      });
      setOwnerSearch('');
      setOwnerResults([]);
      setCreateOpen(false);
      refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t('admin.organizations.create.failed'));
    } finally {
      setCreateLoading(false);
    }
  }

  function requestAction(orgId: string, action: 'suspend' | 'approve' | 'delete') {
    setPendingAction({ orgId, action });
  }

  async function performAction() {
    if (!pendingAction) return;
    const { orgId, action } = pendingAction;
    setActionBusy(true);
    try {
      const method = action === 'delete' ? 'DELETE' : 'PATCH';
      const url = `${apiUrl}/api/v1/admin/organizations/${orgId}${action !== 'delete' ? `/${action}` : ''}`;
      const res = await fetch(url, { method, credentials: 'include' });
      if (res.ok || res.status === 204) {
        toast.success(t(`admin.organizations.actions.${action}`));
        setPendingAction(null);
        refresh();
      } else {
        toast.error(t('admin.organizations.actions.failed'));
      }
    } finally {
      setActionBusy(false);
    }
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  }

  const sortIcon = (field: SortField) =>
    sortField === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow={t('admin.organizations.eyebrow')}
        title={t('admin.organizations.title')}
        subtitle={t('admin.organizations.description')}
        actions={
          <Button
            variant={createOpen ? 'back' : 'primary'}
            onClick={() => setCreateOpen((value) => !value)}
          >
            {createOpen
              ? t('admin.organizations.create.close')
              : t('admin.organizations.create.open')}
          </Button>
        }
      />

      {createOpen && (
        <form
          onSubmit={(event) => {
            void handleCreateSubmit(event);
          }}
          className="mb-6 rounded-md border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="mb-4">
            <h2 className="text-lg font-bold text-slate-900">
              {t('admin.organizations.create.title')}
            </h2>
            <p className="text-sm text-slate-500">{t('admin.organizations.create.description')}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-700">
              {t('admin.organizations.create.name')}
              <input
                required
                minLength={2}
                maxLength={100}
                value={form.name}
                onChange={(event) => {
                  const name = event.target.value;
                  setForm((current) => ({
                    ...current,
                    name,
                    slug: current.slugDetached ? current.slug : slugify(name),
                  }));
                }}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/20"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              {t('admin.organizations.create.slug')}
              <input
                required
                minLength={3}
                maxLength={50}
                pattern="[a-z0-9-]+"
                value={form.slug}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    slug: slugify(event.target.value),
                    slugDetached: true,
                  }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-red-800/20"
              />
            </label>
          </div>
          <div className="mt-4 border-t border-slate-200 pt-4">
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() =>
                  setForm((c) => ({
                    ...c,
                    ownerMode: 'new',
                    ownerUserId: '',
                  }))
                }
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                  form.ownerMode === 'new'
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {t('admin.organizations.create.ownerMode.new')}
              </button>
              <button
                type="button"
                onClick={() =>
                  setForm((c) => ({
                    ...c,
                    ownerMode: 'existing',
                    ownerEmail: '',
                    ownerDisplayName: '',
                  }))
                }
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                  form.ownerMode === 'existing'
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {t('admin.organizations.create.ownerMode.existing')}
              </button>
            </div>

            {form.ownerMode === 'new' ? (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-sm font-semibold text-slate-700">
                  {t('admin.organizations.create.ownerEmail')}
                  <input
                    required
                    type="email"
                    value={form.ownerEmail}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, ownerEmail: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/20"
                  />
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  {t('admin.organizations.create.ownerDisplayName')}
                  <input
                    minLength={2}
                    maxLength={100}
                    value={form.ownerDisplayName}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, ownerDisplayName: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/20"
                  />
                </label>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-semibold text-slate-700">
                  {t('admin.organizations.create.ownerSearch')}
                  <input
                    type="search"
                    value={ownerSearch}
                    onChange={(event) => {
                      setOwnerSearch(event.target.value);
                      setForm((c) => ({ ...c, ownerUserId: '' }));
                    }}
                    placeholder={t('admin.organizations.create.ownerSearchPlaceholder')}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/20"
                  />
                </label>
                {ownerSearchLoading ? (
                  <p className="mt-2 text-xs text-slate-500">
                    {t('admin.organizations.detail.accountSearchLoading')}
                  </p>
                ) : null}
                {!ownerSearchLoading && ownerSearch && ownerResults.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    {t('admin.organizations.detail.noAccountMatches')}
                  </p>
                ) : null}
                {ownerResults.length > 0 ? (
                  <ul className="mt-2 max-h-48 overflow-y-auto rounded-md border border-slate-200">
                    {ownerResults.map((u) => {
                      const selected = u.id === form.ownerUserId;
                      return (
                        <li key={u.id}>
                          <button
                            type="button"
                            onClick={() => setForm((c) => ({ ...c, ownerUserId: u.id }))}
                            className={`block w-full px-3 py-2 text-left text-sm transition ${
                              selected
                                ? 'bg-blue-50 text-blue-900'
                                : 'bg-white hover:bg-slate-50 text-slate-800'
                            }`}
                          >
                            <span className="block font-semibold">
                              {u.display_name?.trim() || u.email || u.id}
                            </span>
                            <span className="block text-xs text-slate-500">{u.email ?? u.id}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            )}
          </div>
          {createError && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {createError}
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={createLoading}
              className="rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-900 disabled:cursor-wait disabled:opacity-70"
            >
              {createLoading
                ? t('admin.organizations.create.submitting')
                : t('admin.organizations.create.submit')}
            </button>
          </div>
        </form>
      )}

      {createResult && (
        <section className="mb-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-slate-800">
          <h2 className="font-bold text-slate-900">{t('admin.organizations.create.success')}</h2>
          <p className="mt-1">
            {t('admin.organizations.create.createdOrg', {
              name: createResult.organization.name,
              slug: createResult.organization.slug,
            })}
          </p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                {t('admin.organizations.create.loginEmail')}
              </dt>
              <dd className="font-mono">{createResult.owner.email}</dd>
            </div>
            {createResult.owner.temporaryPassword ? (
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  {t('admin.organizations.create.temporaryPassword')}
                </dt>
                <dd className="mt-1 flex items-center gap-2">
                  <code className="rounded bg-white px-2 py-1 font-mono text-sm border border-slate-200">
                    {createResult.owner.temporaryPassword}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(createResult.owner.temporaryPassword ?? '')
                        .then(() => {
                          setTempPasswordCopied(true);
                          setTimeout(() => setTempPasswordCopied(false), 2000);
                        });
                    }}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {tempPasswordCopied
                      ? t('admin.organizations.create.copied')
                      : t('admin.organizations.create.copy')}
                  </button>
                </dd>
              </div>
            ) : (
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  {t('admin.organizations.create.existingAccountTitle')}
                </dt>
                <dd>{t('admin.organizations.create.existingAccount')}</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-slate-600">
            {createResult.magicLinkSent
              ? t('admin.organizations.create.magicLinkSent')
              : t('admin.organizations.create.magicLinkFailed')}
          </p>
          <p className="mt-1 text-slate-600">
            {t('admin.organizations.create.orgUrl', {
              url: `/org/${createResult.organization.slug}`,
            })}
          </p>
        </section>
      )}

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          type="search"
          placeholder={t('admin.organizations.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
        >
          <option value="all">{t('admin.organizations.status.all')}</option>
          <option value="active">{t('admin.organizations.status.active')}</option>
          <option value="suspended">{t('admin.organizations.status.suspended')}</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">{t('admin.organizations.loading')}</p>
      ) : orgs.length === 0 ? (
        <p className="text-sm text-slate-400">{t('admin.organizations.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th
                  className="cursor-pointer py-2 pr-4 pl-4 hover:text-slate-800"
                  onClick={() => toggleSort('name')}
                >
                  {t('admin.organizations.table.name')}
                  {sortIcon('name')}
                </th>
                <th className="py-2 pr-4">{t('admin.organizations.table.owner')}</th>
                <th
                  className="cursor-pointer py-2 pr-4 hover:text-slate-800"
                  onClick={() => toggleSort('member_count')}
                >
                  {t('admin.organizations.table.members')}
                  {sortIcon('member_count')}
                </th>
                <th
                  className="cursor-pointer py-2 pr-4 hover:text-slate-800"
                  onClick={() => toggleSort('event_count')}
                >
                  {t('admin.organizations.table.events')}
                  {sortIcon('event_count')}
                </th>
                <th className="py-2 pr-4">{t('admin.organizations.table.status')}</th>
                <th
                  className="cursor-pointer py-2 pr-4 hover:text-slate-800"
                  onClick={() => toggleSort('created_at')}
                >
                  {t('admin.organizations.table.created')}
                  {sortIcon('created_at')}
                </th>
                <th className="py-2">{t('admin.organizations.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2 pr-4 pl-4">
                    <Link
                      href={`/admin/organizations/${org.id}`}
                      className="font-medium text-red-700 hover:underline"
                    >
                      {org.name}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-slate-400">{org.slug}</span>
                  </td>
                  <td className="py-2 pr-4 text-slate-600">
                    <div className="font-medium text-slate-700">
                      {org.owner_username ?? org.owner_email ?? '-'}
                    </div>
                    {org.owner_email && org.owner_email !== org.owner_username ? (
                      <div className="text-xs text-slate-400">{org.owner_email}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 text-slate-600">{org.member_count}</td>
                  <td className="py-2 pr-4 text-slate-600">{org.event_count}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge variant={org.status === 'active' ? 'active' : 'suspended'}>
                      {t(`admin.organizations.status.${org.status}`)}
                    </StatusBadge>
                  </td>
                  <td className="py-2 pr-4 text-slate-500">
                    {new Date(org.created_at).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      <Link
                        href={`/admin/organizations/${org.id}/edit`}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {t('admin.organizations.actions.edit')}
                      </Link>
                      {org.status === 'active' && !org.is_protected ? (
                        <button
                          onClick={() => {
                            requestAction(org.id, 'suspend');
                          }}
                          className="text-xs text-orange-600 hover:underline"
                        >
                          {t('admin.organizations.actions.suspend')}
                        </button>
                      ) : org.status === 'suspended' ? (
                        <button
                          onClick={() => {
                            requestAction(org.id, 'approve');
                          }}
                          className="text-xs text-green-600 hover:underline"
                        >
                          {t('admin.organizations.actions.approve')}
                        </button>
                      ) : null}
                      {org.is_protected ? (
                        <span className="text-xs font-medium text-slate-400">
                          {t('admin.organizations.actions.protected')}
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            requestAction(org.id, 'delete');
                          }}
                          className="text-xs text-red-600 hover:underline"
                        >
                          {t('admin.organizations.actions.delete')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={pendingAction !== null}
        onConfirm={() => void performAction()}
        onCancel={() => setPendingAction(null)}
        title={
          pendingAction
            ? t('admin.organizations.actions.confirm', {
                action: t(`admin.organizations.actions.${pendingAction.action}`),
              })
            : ''
        }
        confirmLabel={
          pendingAction
            ? t(`admin.organizations.actions.${pendingAction.action}`)
            : t('admin.organizations.actions.confirm', { action: '' })
        }
        danger={pendingAction?.action === 'delete' || pendingAction?.action === 'suspend'}
        busy={actionBusy}
      />
    </main>
  );
}
