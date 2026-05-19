'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../../src/i18n/I18nProvider';

const ORG_ROLES = [
  'owner',
  'admin',
  'editor',
  'scorekeeper',
  'referee',
  'workshop_lead',
  'read_only',
] as const;

type OrgRole = (typeof ORG_ROLES)[number];

interface UserOrgMembership {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
}

interface AdminUser {
  id: string;
  email?: string;
  display_name?: string | null;
  organizations: UserOrgMembership[];
  is_super_admin?: boolean;
}

interface OrgRow {
  id: string;
  name: string;
  slug: string;
}

export default function AdminUserEditPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [user, setUser] = useState<AdminUser | null>(null);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [accountForm, setAccountForm] = useState<{ email: string; displayName: string }>({
    email: '',
    displayName: '',
  });
  const [busy, setBusy] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addOrgId, setAddOrgId] = useState('');
  const [addRole, setAddRole] = useState<OrgRole>('admin');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiUrl}/api/v1/auth/me`, { credentials: 'include' })
      .then(async (res) => (res.ok ? ((await res.json()) as { id?: string }) : null))
      .then((data) => {
        if (!cancelled) setCurrentUserId(data?.id ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  const fetchUser = useCallback(async () => {
    const res = await fetch(`${apiUrl}/api/v1/admin/users/${userId}`, {
      credentials: 'include',
    });
    if (!res.ok) {
      throw new Error(t('admin.users.edit.saveError'));
    }
    const data = (await res.json()) as { user: AdminUser };
    setUser(data.user);
    setAccountForm({ email: data.user.email ?? '', displayName: data.user.display_name ?? '' });
  }, [apiUrl, userId, t]);

  const fetchOrgs = useCallback(async () => {
    const res = await fetch(`${apiUrl}/api/v1/admin/organizations?perPage=200`, {
      credentials: 'include',
    });
    if (!res.ok) return;
    const data = (await res.json()) as { organizations?: OrgRow[] } | OrgRow[];
    const list = Array.isArray(data) ? data : (data.organizations ?? []);
    setOrgs(list);
  }, [apiUrl]);

  useEffect(() => {
    void fetchUser().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : t('admin.users.edit.saveError'));
    });
    void fetchOrgs().catch(() => undefined);
  }, [fetchUser, fetchOrgs, t]);

  const availableOrgs = useMemo(() => {
    if (!user) return orgs;
    const taken = new Set(user.organizations.map((o) => o.id));
    return orgs.filter((o) => !taken.has(o.id));
  }, [orgs, user]);

  useEffect(() => {
    if (availableOrgs.length > 0 && !availableOrgs.find((o) => o.id === addOrgId)) {
      setAddOrgId(availableOrgs[0]!.id);
    } else if (availableOrgs.length === 0) {
      setAddOrgId('');
    }
  }, [availableOrgs, addOrgId]);

  async function saveAccount() {
    setBusy(true);
    setError(null);
    setSavedFlash(false);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/users/${userId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: accountForm.email.trim() || undefined,
          displayName: accountForm.displayName.trim(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.users.edit.saveError'));
      }
      setSavedFlash(true);
      await fetchUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.users.edit.saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function updateRole(orgId: string, role: OrgRole) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/users/${userId}/organizations/${orgId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.users.edit.roleUpdateError'));
      }
      await fetchUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.users.edit.roleUpdateError'));
    } finally {
      setBusy(false);
    }
  }

  async function removeMembership(org: UserOrgMembership) {
    if (!window.confirm(t('admin.users.edit.confirmRemove', { organization: org.name }))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/users/${userId}/organizations/${org.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.users.edit.removeError'));
      }
      await fetchUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.users.edit.removeError'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleSuperAdmin() {
    if (!user) return;
    const isCurrentlySuperAdmin = user.is_super_admin === true;
    const confirmMsg = isCurrentlySuperAdmin
      ? t('admin.users.edit.superAdminRevokeConfirm')
      : t('admin.users.edit.superAdminGrantConfirm');
    if (!window.confirm(confirmMsg)) return;

    setBusy(true);
    setError(null);
    try {
      const url = isCurrentlySuperAdmin
        ? `${apiUrl}/api/v1/admin/users/${userId}/super-admin`
        : `${apiUrl}/api/v1/admin/users/${userId}/promote-super-admin`;
      const res = await fetch(url, {
        method: isCurrentlySuperAdmin ? 'DELETE' : 'POST',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.users.edit.superAdminFailed'));
      }
      await fetchUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.users.edit.superAdminFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function addMembership() {
    if (!addOrgId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/users/${userId}/organizations`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: addOrgId, role: addRole }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.users.edit.addError'));
      }
      await fetchUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.users.edit.addError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-8 max-w-3xl">
      <div className="mb-2 text-sm">
        <Link href="/admin/users" className="text-slate-500 hover:underline">
          {t('admin.users.edit.backToList')}
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-6">{t('admin.users.edit.title')}</h1>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {savedFlash && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {t('admin.users.edit.saved')}
        </div>
      )}

      <section className="mb-8 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          {t('admin.users.edit.accountSection')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-600">
            {t('admin.users.edit.email')}
            <input
              type="email"
              value={accountForm.email}
              onChange={(e) => setAccountForm((s) => ({ ...s, email: e.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            {t('admin.users.edit.displayName')}
            <input
              type="text"
              value={accountForm.displayName}
              onChange={(e) => setAccountForm((s) => ({ ...s, displayName: e.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => void saveAccount()}
          disabled={busy || !user}
          className="mt-4 rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
        >
          {t('admin.users.edit.save')}
        </button>
      </section>

      <section className="mb-8 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          {t('admin.users.edit.superAdminSection')}
        </h2>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-700">
            {user?.is_super_admin
              ? t('admin.users.edit.superAdminCurrent')
              : t('admin.users.edit.superAdminNotGranted')}
          </p>
          {currentUserId === userId ? (
            <span className="text-xs italic text-slate-500">
              {t('admin.users.edit.superAdminSelfDisabled')}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void toggleSuperAdmin()}
              disabled={busy || !user}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                user?.is_super_admin
                  ? 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                  : 'bg-purple-700 text-white hover:bg-purple-800'
              }`}
            >
              {user?.is_super_admin
                ? t('admin.users.edit.superAdminRevoke')
                : t('admin.users.edit.superAdminGrant')}
            </button>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          {t('admin.users.edit.organizationsSection')}
        </h2>

        {user && user.organizations.length === 0 ? (
          <p className="text-sm text-slate-500 italic">{t('admin.users.edit.empty')}</p>
        ) : (
          <ul className="mb-4 divide-y divide-slate-100">
            {(user?.organizations ?? []).map((org) => (
              <li key={org.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{org.name}</p>
                  <p className="font-mono text-xs text-slate-400">{org.slug}</p>
                </div>
                <select
                  value={org.role}
                  disabled={busy}
                  onChange={(e) => void updateRole(org.id, e.target.value as OrgRole)}
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                >
                  {ORG_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void removeMembership(org)}
                  disabled={busy}
                  className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
          <label className="text-xs font-medium text-slate-600">
            {t('admin.users.edit.organizationLabel')}
            <select
              value={addOrgId}
              onChange={(e) => setAddOrgId(e.target.value)}
              disabled={availableOrgs.length === 0 || busy}
              className="mt-1 block min-w-[12rem] rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              {availableOrgs.length === 0 ? (
                <option value="">{t('admin.users.edit.chooseOrganization')}</option>
              ) : (
                availableOrgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            {t('admin.users.edit.role')}
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as OrgRole)}
              disabled={busy}
              className="mt-1 block rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              {ORG_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void addMembership()}
            disabled={busy || !addOrgId}
            className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {busy ? t('admin.users.edit.adding') : t('admin.users.edit.add')}
          </button>
        </div>
      </section>
    </main>
  );
}
