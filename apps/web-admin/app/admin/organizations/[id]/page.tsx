'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../src/i18n/I18nProvider';

interface Member {
  user_id: string;
  email: string;
  display_name: string | null;
  username: string;
  role: string;
  joined_at: string;
}

interface AuditEntry {
  id: string;
  actor_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
}

interface OrgDetail {
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
  is_protected: boolean;
  members: Member[];
  recent_audit_log: AuditEntry[];
}

interface PlatformAccount {
  id: string;
  email?: string;
  display_name?: string | null;
}

interface PlatformAccountListResponse {
  users: PlatformAccount[];
}

interface Props {
  params: Promise<{ id: string }>;
}

type PickerMode = 'reassign' | 'promote';

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function memberMatchesSearch(member: Member, search: string): boolean {
  const normalizedSearch = normalizeSearch(search);
  if (!normalizedSearch) return true;
  return [member.username, member.display_name, member.email, member.user_id]
    .filter(Boolean)
    .some((value) => normalizeSearch(String(value)).includes(normalizedSearch));
}

function accountLabel(account: PlatformAccount): string {
  return account.display_name?.trim() || account.email || account.id;
}

export default function AdminOrgDetailPage({ params }: Props) {
  const { t } = useI18n();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [pickerMode, setPickerMode] = useState<PickerMode | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [platformAccounts, setPlatformAccounts] = useState<PlatformAccount[]>([]);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [platformError, setPlatformError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    void params.then(({ id }) => setOrgId(id));
  }, [params]);

  useEffect(() => {
    if (!orgId) return;

    let cancelled = false;
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/admin/organizations/${orgId}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error(t('admin.organizations.detail.loadError'));
        setOrg((await res.json()) as OrgDetail);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('admin.organizations.genericError'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [orgId, apiUrl, t]);

  async function handleAction(action: 'suspend' | 'reactivate' | 'delete') {
    if (!orgId) return;
    const labels = {
      suspend: t('admin.organizations.actions.suspend'),
      reactivate: t('admin.organizations.actions.reactivate'),
      delete: t('admin.organizations.actions.delete'),
    };
    if (!confirm(t('admin.organizations.actions.confirm', { action: labels[action] }))) return;

    const method = action === 'delete' ? 'DELETE' : 'PATCH';
    const url = `${apiUrl}/api/v1/admin/organizations/${orgId}${action !== 'delete' ? `/${action}` : ''}`;
    const res = await fetch(url, { method, credentials: 'include' });

    if (res.ok || res.status === 204) {
      if (action === 'delete') {
        window.location.href = '/admin/organizations';
      } else {
        window.location.reload();
      }
    } else {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      alert(data?.message ?? t('admin.organizations.actions.failed'));
    }
  }

  function openReassignPicker() {
    setPickerMode('reassign');
    setPickerSearch('');
    setPlatformError(null);
  }

  function openPromotePicker() {
    setPickerMode('promote');
    setPickerSearch('');
    setPlatformError(null);
    void loadPlatformAccounts('');
  }

  function closePicker() {
    if (actionLoading) return;
    setPickerMode(null);
    setPickerSearch('');
    setPlatformError(null);
  }

  async function loadPlatformAccounts(search: string) {
    setPlatformLoading(true);
    setPlatformError(null);
    const params = new URLSearchParams();
    params.set('perPage', '20');
    if (search.trim()) params.set('q', search.trim());

    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/users?${params}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('admin.organizations.detail.accountSearchFailed'));
      const data = (await res.json()) as PlatformAccountListResponse;
      setPlatformAccounts(data.users ?? []);
    } catch (err) {
      setPlatformError(
        err instanceof Error ? err.message : t('admin.organizations.detail.accountSearchFailed'),
      );
      setPlatformAccounts([]);
    } finally {
      setPlatformLoading(false);
    }
  }

  async function handleReassignOwner(member: Member) {
    if (!orgId || actionLoading) return;
    if (
      !confirm(
        t('admin.organizations.detail.confirmReassignOwner', {
          account: member.username || member.email || member.user_id,
        }),
      )
    ) {
      return;
    }

    setActionLoading(true);
    const res = await fetch(`${apiUrl}/api/v1/admin/organizations/${orgId}/reassign-owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ newOwnerUserId: member.user_id }),
    });
    setActionLoading(false);

    if (res.ok || res.status === 204) {
      window.location.reload();
    } else {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      alert(data?.message ?? t('admin.organizations.detail.reassignFailed'));
    }
  }

  async function handlePromoteSuperAdmin(account: PlatformAccount) {
    if (actionLoading) return;
    if (
      !confirm(
        t('admin.organizations.detail.confirmPromoteMember', {
          account: accountLabel(account),
        }),
      )
    ) {
      return;
    }

    setActionLoading(true);
    const res = await fetch(`${apiUrl}/api/v1/admin/users/promote-super-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ userId: account.id }),
    });
    setActionLoading(false);

    if (res.ok || res.status === 204) {
      closePicker();
      alert(t('admin.organizations.detail.promoteSuccess'));
    } else {
      alert(t('admin.organizations.detail.promoteFailed'));
    }
  }

  if (loading) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-400">{t('admin.organizations.loading')}</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="p-8">
        <p className="text-sm text-red-600">{error}</p>
      </main>
    );
  }

  if (!org) return null;
  const filteredMembers = org.members.filter((member) => memberMatchesSearch(member, pickerSearch));

  return (
    <main className="max-w-4xl p-8">
      <div className="mb-2">
        <Link href="/admin/organizations" className="text-sm text-gray-500 hover:underline">
          {t('admin.organizations.detail.back')}
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{org.name}</h1>
          <p className="mt-0.5 font-mono text-sm text-gray-500">{org.slug}</p>
        </div>
        <span
          className={`mt-1 inline-block rounded-full px-3 py-1 text-sm font-medium ${
            org.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}
        >
          {t(`admin.organizations.status.${org.status}`)}
        </span>
      </div>

      {org.is_protected ? (
        <div className="mb-6 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          {t('admin.organizations.detail.protectedNote')}
        </div>
      ) : null}

      <div className="mb-8 grid grid-cols-3 gap-4">
        {[
          { label: t('admin.organizations.table.members'), value: org.member_count },
          { label: t('admin.organizations.table.events'), value: org.event_count },
          {
            label: t('admin.organizations.table.created'),
            value: new Date(org.created_at).toLocaleDateString('fr-FR'),
          },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-gray-200 p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
            <p className="mt-1 text-xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">{t('admin.organizations.table.actions')}</h2>
        <div className="flex flex-wrap gap-2">
          {org.status === 'active' && !org.is_protected ? (
            <button
              onClick={() => {
                void handleAction('suspend');
              }}
              className="rounded-md bg-orange-100 px-4 py-2 text-sm font-medium text-orange-700 transition-colors hover:bg-orange-200"
            >
              {t('admin.organizations.actions.suspend')}
            </button>
          ) : org.status === 'suspended' ? (
            <button
              onClick={() => {
                void handleAction('reactivate');
              }}
              className="rounded-md bg-green-100 px-4 py-2 text-sm font-medium text-green-700 transition-colors hover:bg-green-200"
            >
              {t('admin.organizations.actions.reactivate')}
            </button>
          ) : null}
          {org.status === 'active' && org.is_protected ? (
            <span className="rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-500">
              {t('admin.organizations.actions.protected')}
            </span>
          ) : null}
          <button
            onClick={() => {
              openReassignPicker();
            }}
            className="rounded-md bg-blue-100 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-200"
          >
            {t('admin.organizations.detail.reassignOwner')}
          </button>
          <button
            onClick={() => {
              openPromotePicker();
            }}
            className="rounded-md bg-purple-100 px-4 py-2 text-sm font-medium text-purple-700 transition-colors hover:bg-purple-200"
          >
            {t('admin.organizations.detail.promoteMember')}
          </button>
          {org.is_protected ? null : (
            <button
              onClick={() => {
                void handleAction('delete');
              }}
              className="rounded-md bg-red-100 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-200"
            >
              {t('admin.organizations.actions.deleteHard')}
            </button>
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">
          {t('admin.organizations.detail.membersTitle', { count: org.members.length })}
        </h2>
        {org.members.length === 0 ? (
          <p className="text-sm text-gray-400">{t('admin.organizations.detail.noMembers')}</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 pr-4">{t('admin.organizations.detail.user')}</th>
                <th className="py-2 pr-4">{t('admin.organizations.detail.userId')}</th>
                <th className="py-2 pr-4">{t('admin.organizations.detail.role')}</th>
                <th className="py-2">{t('admin.organizations.detail.joined')}</th>
              </tr>
            </thead>
            <tbody>
              {org.members.map((member) => (
                <tr key={member.user_id} className="border-b border-gray-100">
                  <td className="py-2 pr-4">
                    <div className="font-medium text-slate-700">{member.username}</div>
                    {member.email && member.email !== member.username ? (
                      <div className="text-xs text-slate-400">{member.email}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-gray-600">{member.user_id}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                        member.role === 'owner'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {member.role}
                    </span>
                  </td>
                  <td className="py-2 text-gray-500">
                    {new Date(member.joined_at).toLocaleDateString('fr-FR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{t('admin.organizations.detail.auditLog')}</h2>
        {org.recent_audit_log.length === 0 ? (
          <p className="text-sm text-gray-400">{t('admin.organizations.detail.noAuditLog')}</p>
        ) : (
          <div className="space-y-2">
            {org.recent_audit_log.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-3 border-b border-gray-100 pb-2 text-sm"
              >
                <span className="mt-0.5 whitespace-nowrap text-xs text-gray-400">
                  {new Date(entry.created_at).toLocaleString('fr-FR')}
                </span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700">
                  {entry.action}
                </span>
                <span className="font-mono text-xs text-gray-500">
                  {t('admin.organizations.detail.auditBy', { userId: entry.actor_user_id })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {pickerMode ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={
            pickerMode === 'reassign'
              ? t('admin.organizations.detail.selectOwnerTitle')
              : t('admin.organizations.detail.selectSuperAdminTitle')
          }
        >
          <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">
                    {pickerMode === 'reassign'
                      ? t('admin.organizations.detail.selectOwnerTitle')
                      : t('admin.organizations.detail.selectSuperAdminTitle')}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {pickerMode === 'reassign'
                      ? t('admin.organizations.detail.selectOwnerDescription')
                      : t('admin.organizations.detail.selectSuperAdminDescription')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closePicker}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {t('actions.cancel')}
                </button>
              </div>
              <label className="mt-4 block text-sm font-semibold text-slate-700">
                {t('admin.organizations.detail.memberSearch')}
                <input
                  type="search"
                  value={pickerSearch}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPickerSearch(value);
                    if (pickerMode === 'promote') void loadPlatformAccounts(value);
                  }}
                  placeholder={
                    pickerMode === 'reassign'
                      ? t('admin.organizations.detail.reassignSearchPlaceholder')
                      : t('admin.organizations.detail.promoteSearchPlaceholder')
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </label>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-3">
              {pickerMode === 'promote' && platformLoading ? (
                <p className="p-4 text-sm text-slate-500">
                  {t('admin.organizations.detail.accountSearchLoading')}
                </p>
              ) : null}
              {pickerMode === 'promote' && platformError ? (
                <p className="p-4 text-sm text-red-600">{platformError}</p>
              ) : null}
              {pickerMode === 'reassign' && filteredMembers.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">
                  {t('admin.organizations.detail.noMemberMatches')}
                </p>
              ) : null}
              {pickerMode === 'promote' &&
              !platformLoading &&
              !platformError &&
              platformAccounts.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">
                  {t('admin.organizations.detail.noAccountMatches')}
                </p>
              ) : null}

              <div className="space-y-2">
                {pickerMode === 'reassign'
                  ? filteredMembers.map((member) => (
                      <button
                        key={member.user_id}
                        type="button"
                        disabled={actionLoading || member.role === 'owner'}
                        onClick={() => {
                          void handleReassignOwner(member);
                        }}
                        className="w-full rounded-md border border-slate-200 px-4 py-3 text-left transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className="block font-semibold text-slate-950">
                          {member.username || member.email || member.user_id}
                        </span>
                        <span className="mt-1 block text-sm text-slate-600">
                          {member.email || t('admin.users.noEmail')}
                        </span>
                        <span className="mt-1 block font-mono text-xs text-slate-500">
                          {member.user_id}
                        </span>
                      </button>
                    ))
                  : platformAccounts.map((account) => (
                      <button
                        key={account.id}
                        type="button"
                        disabled={actionLoading}
                        onClick={() => {
                          void handlePromoteSuperAdmin(account);
                        }}
                        className="w-full rounded-md border border-slate-200 px-4 py-3 text-left transition hover:border-purple-300 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className="block font-semibold text-slate-950">
                          {accountLabel(account)}
                        </span>
                        <span className="mt-1 block text-sm text-slate-600">
                          {account.email || t('admin.users.noEmail')}
                        </span>
                        <span className="mt-1 block font-mono text-xs text-slate-500">
                          {account.id}
                        </span>
                      </button>
                    ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
