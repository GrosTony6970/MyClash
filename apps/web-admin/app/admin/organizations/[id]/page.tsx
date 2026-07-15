'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useConfirm, useToast, StatusBadge } from '@myclash/ui';
import { localeToBcp47 } from '@myclash/time';
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
  actorName: string | null;
  actorEmail: string | null;
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
  is_super_admin?: boolean;
}

interface PlatformAccountListResponse {
  users: PlatformAccount[];
}

interface Props {
  params: Promise<{ id: string }>;
}

type PickerMode = 'reassign' | 'addMember';

const ADDABLE_ROLES = [
  'admin',
  'editor',
  'scorekeeper',
  'referee',
  'workshop_lead',
  'read_only',
] as const;
type AddableRole = (typeof ADDABLE_ROLES)[number];

const ASSIGNABLE_ROLES = [
  'admin',
  'editor',
  'scorekeeper',
  'referee',
  'workshop_lead',
  'read_only',
];

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
  const { t, locale } = useI18n();
  const { confirm, confirmDialog } = useConfirm();
  const toast = useToast();
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
  const [addRole, setAddRole] = useState<AddableRole>('admin');
  const [assignMode, setAssignMode] = useState<'new' | 'existing'>('existing');
  const [assignEmail, setAssignEmail] = useState('');
  const [assignDisplayName, setAssignDisplayName] = useState('');

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
    if (
      !(await confirm({
        title: t('admin.organizations.actions.confirm', { action: labels[action] }),
      }))
    )
      return;

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
      toast.error(data?.message ?? t('admin.organizations.actions.failed'));
    }
  }

  function openReassignPicker() {
    setPickerMode('reassign');
    setPickerSearch('');
    setPlatformError(null);
    setAssignMode('existing');
    setAssignEmail('');
    setAssignDisplayName('');
    void loadPlatformAccounts('');
  }

  function openAddMemberPicker() {
    setPickerMode('addMember');
    setPickerSearch('');
    setPlatformError(null);
    setAddRole('admin');
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

  async function submitAssignOwner(body: Record<string, unknown>, confirmLabel?: string) {
    if (!orgId || actionLoading) return;
    if (confirmLabel && !(await confirm({ title: confirmLabel }))) return;

    setActionLoading(true);
    const res = await fetch(`${apiUrl}/api/v1/admin/organizations/${orgId}/reassign-owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    setActionLoading(false);

    if (res.ok || res.status === 204) {
      window.location.reload();
    } else {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      toast.error(data?.message ?? t('admin.organizations.detail.reassignFailed'));
    }
  }

  async function handlePickExistingUser(userId: string, label: string) {
    await submitAssignOwner(
      { ownerUserId: userId },
      t('admin.organizations.detail.confirmReassignOwner', { account: label }),
    );
  }

  async function handleAssignByEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignEmail.trim()) return;
    await submitAssignOwner({
      ownerEmail: assignEmail.trim(),
      ownerDisplayName: assignDisplayName.trim() || undefined,
    });
  }

  async function handleAddMember(account: PlatformAccount) {
    if (!orgId || actionLoading) return;
    setActionLoading(true);
    const res = await fetch(`${apiUrl}/api/v1/admin/users/${account.id}/organizations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ organizationId: orgId, role: addRole }),
    });
    setActionLoading(false);
    if (res.ok || res.status === 204) {
      closePicker();
      window.location.reload();
    } else {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      toast.error(data?.message ?? t('admin.organizations.detail.addMemberFailed'));
    }
  }

  async function handleUpdateMemberRole(member: Member, role: string) {
    if (!orgId || actionLoading) return;
    setActionLoading(true);
    const res = await fetch(
      `${apiUrl}/api/v1/admin/users/${member.user_id}/organizations/${orgId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role }),
      },
    );
    setActionLoading(false);
    if (res.ok || res.status === 204) {
      window.location.reload();
    } else {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      toast.error(data?.message ?? t('admin.organizations.detail.roleUpdateFailed'));
    }
  }

  async function handleRemoveMember(member: Member) {
    if (!orgId || actionLoading) return;
    if (
      !(await confirm({
        title: t('admin.organizations.detail.confirmRemoveMember', {
          account: member.username || member.email || member.user_id,
        }),
        danger: true,
      }))
    ) {
      return;
    }
    setActionLoading(true);
    const res = await fetch(
      `${apiUrl}/api/v1/admin/users/${member.user_id}/organizations/${orgId}`,
      {
        method: 'DELETE',
        credentials: 'include',
      },
    );
    setActionLoading(false);
    if (res.ok || res.status === 204) {
      window.location.reload();
    } else {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      toast.error(data?.message ?? t('admin.organizations.detail.removeMemberFailed'));
    }
  }

  if (loading) {
    return (
      <main className="p-8">
        <p className="text-sm text-muted">{t('admin.organizations.loading')}</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="p-8">
        <p className="text-sm text-danger">{error}</p>
      </main>
    );
  }

  if (!org) return null;
  const filteredMembers = org.members.filter((member) => memberMatchesSearch(member, pickerSearch));
  const hasOwner = Boolean(org.owner_username || org.owner_email);

  return (
    <main className="max-w-4xl p-8">
      <div className="mb-2">
        <Link href="/admin/organizations" className="text-sm text-muted hover:underline">
          {t('admin.organizations.detail.back')}
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl">{org.name}</h1>
          <p className="mt-0.5 font-mono text-sm text-muted">{org.slug}</p>
          {!hasOwner && (
            <span className="mt-2 inline-block rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
              {t('admin.organizations.detail.noOwnerAssigned')}
            </span>
          )}
        </div>
        <StatusBadge
          variant={org.status === 'active' ? 'active' : 'suspended'}
          className="mt-1 text-sm"
        >
          {t(`admin.organizations.status.${org.status}`)}
        </StatusBadge>
      </div>

      {org.is_protected ? (
        <div className="mb-6 rounded-md border border-info/30 bg-info/10 px-4 py-3 text-sm text-info">
          {t('admin.organizations.detail.protectedNote')}
        </div>
      ) : null}

      <div className="mb-8 grid grid-cols-3 gap-4">
        {[
          { label: t('admin.organizations.table.members'), value: org.member_count },
          { label: t('admin.organizations.table.events'), value: org.event_count },
          {
            label: t('admin.organizations.table.created'),
            value: new Date(org.created_at).toLocaleDateString(localeToBcp47(locale)),
          },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-border p-4">
            <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
            <p className="mt-1 text-xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <section className="mb-8">
        <h2 className="mb-3 font-display font-semibold text-lg sm:text-xl">
          {t('admin.organizations.table.actions')}
        </h2>
        <div className="flex flex-wrap gap-2">
          {org.status === 'active' && !org.is_protected ? (
            <button
              onClick={() => {
                void handleAction('suspend');
              }}
              className="rounded-md bg-warning/10 px-4 py-2 text-sm font-medium text-warning transition-colors hover:bg-warning/20"
            >
              {t('admin.organizations.actions.suspend')}
            </button>
          ) : org.status === 'suspended' ? (
            <button
              onClick={() => {
                void handleAction('reactivate');
              }}
              className="rounded-md bg-success/10 px-4 py-2 text-sm font-medium text-success transition-colors hover:bg-success/20"
            >
              {t('admin.organizations.actions.reactivate')}
            </button>
          ) : null}
          {org.status === 'active' && org.is_protected ? (
            <span className="rounded-md bg-background px-4 py-2 text-sm font-medium text-muted">
              {t('admin.organizations.actions.protected')}
            </span>
          ) : null}
          <button
            onClick={() => {
              openReassignPicker();
            }}
            className="rounded-md bg-info/10 px-4 py-2 text-sm font-medium text-info transition-colors hover:bg-info/20"
          >
            {hasOwner
              ? t('admin.organizations.detail.reassignOwner')
              : t('admin.organizations.detail.assignOwner')}
          </button>
          {org.is_protected ? null : (
            <button
              onClick={() => {
                void handleAction('delete');
              }}
              className="rounded-md bg-danger/10 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/20"
            >
              {t('admin.organizations.actions.deleteHard')}
            </button>
          )}
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display font-semibold text-lg sm:text-xl">
            {t('admin.organizations.detail.membersTitle', { count: org.members.length })}
          </h2>
          <button
            type="button"
            onClick={() => openAddMemberPicker()}
            className="rounded-md bg-info px-3 py-1.5 text-sm font-semibold text-white hover:bg-info/90"
          >
            {t('admin.organizations.detail.addMember')}
          </button>
        </div>
        {org.members.length === 0 ? (
          <p className="text-sm text-muted">{t('admin.organizations.detail.noMembers')}</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-2 pr-4">{t('admin.organizations.detail.user')}</th>
                <th className="py-2 pr-4">{t('admin.organizations.detail.role')}</th>
                <th className="py-2 pr-4">{t('admin.organizations.detail.joined')}</th>
                <th className="py-2">{t('admin.organizations.detail.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {org.members.map((member) => (
                <tr key={member.user_id} className="border-b border-border">
                  <td className="py-2 pr-4">
                    <div className="font-medium text-foreground-secondary">{member.username}</div>
                    {member.email && member.email !== member.username ? (
                      <div className="text-xs text-muted">{member.email}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4">
                    {member.role === 'owner' ? (
                      <span className="inline-block rounded bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold">
                        {member.role}
                      </span>
                    ) : (
                      <select
                        value={member.role}
                        disabled={actionLoading}
                        onChange={(e) => void handleUpdateMemberRole(member, e.target.value)}
                        className="rounded-md border border-border px-2 py-1 text-xs"
                      >
                        {ASSIGNABLE_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-muted">
                    {new Date(member.joined_at).toLocaleDateString(localeToBcp47(locale))}
                  </td>
                  <td className="py-2">
                    {member.role !== 'owner' ? (
                      <button
                        type="button"
                        onClick={() => void handleRemoveMember(member)}
                        disabled={actionLoading}
                        className="rounded-md border border-danger/30 px-2 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
                      >
                        {t('admin.organizations.detail.removeMember')}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display font-semibold text-lg sm:text-xl">
          {t('admin.organizations.detail.auditLog')}
        </h2>
        {org.recent_audit_log.length === 0 ? (
          <p className="text-sm text-muted">{t('admin.organizations.detail.noAuditLog')}</p>
        ) : (
          <div className="space-y-2">
            {org.recent_audit_log.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-3 border-b border-border pb-2 text-sm"
              >
                <span className="mt-0.5 whitespace-nowrap text-xs text-muted">
                  {new Date(entry.created_at).toLocaleString(localeToBcp47(locale))}
                </span>
                <span className="rounded bg-background px-1.5 py-0.5 font-mono text-xs text-foreground-secondary">
                  {entry.action}
                </span>
                <span className="font-mono text-xs text-muted">
                  {t('admin.organizations.detail.auditBy', {
                    actor: entry.actorName ?? entry.actorEmail ?? t('admin.common.unknownUser'),
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {pickerMode ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={
            pickerMode === 'reassign'
              ? hasOwner
                ? t('admin.organizations.detail.selectOwnerTitle')
                : t('admin.organizations.detail.assignOwnerTitle')
              : t('admin.organizations.detail.addMemberTitle')
          }
        >
          <div className="w-full max-w-2xl rounded-lg border border-border bg-surface shadow-xl">
            <div className="border-b border-border p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
                    {pickerMode === 'reassign'
                      ? hasOwner
                        ? t('admin.organizations.detail.selectOwnerTitle')
                        : t('admin.organizations.detail.assignOwnerTitle')
                      : t('admin.organizations.detail.addMemberTitle')}
                  </h2>
                  <p className="mt-1 text-sm text-foreground-secondary">
                    {pickerMode === 'reassign'
                      ? hasOwner
                        ? t('admin.organizations.detail.selectOwnerDescription')
                        : t('admin.organizations.detail.assignOwnerDescription')
                      : t('admin.organizations.detail.addMemberDescription')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closePicker}
                  className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground-secondary hover:bg-background"
                >
                  {t('actions.cancel')}
                </button>
              </div>
              {pickerMode === 'addMember' ? (
                <label className="mt-4 block text-sm font-semibold text-foreground-secondary">
                  {t('admin.organizations.detail.addMemberRole')}
                  <select
                    value={addRole}
                    onChange={(e) => setAddRole(e.target.value as AddableRole)}
                    className="mt-1 block rounded-md border border-border px-3 py-2 text-sm"
                  >
                    {ADDABLE_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {pickerMode === 'reassign' ? (
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAssignMode('existing')}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                      assignMode === 'existing'
                        ? 'bg-strong text-strong-foreground'
                        : 'border border-border bg-surface text-foreground-secondary hover:bg-background'
                    }`}
                  >
                    {t('admin.organizations.detail.assignModeExistingUser')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssignMode('new')}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                      assignMode === 'new'
                        ? 'bg-strong text-strong-foreground'
                        : 'border border-border bg-surface text-foreground-secondary hover:bg-background'
                    }`}
                  >
                    {t('admin.organizations.detail.assignModeNewAccount')}
                  </button>
                </div>
              ) : null}
              {pickerMode === 'reassign' && assignMode === 'existing' ? (
                <label className="mt-4 block text-sm font-semibold text-foreground-secondary">
                  {t('admin.organizations.detail.memberSearch')}
                  <input
                    type="search"
                    value={pickerSearch}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPickerSearch(value);
                      void loadPlatformAccounts(value);
                    }}
                    placeholder={t('admin.organizations.detail.reassignSearchPlaceholder')}
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </label>
              ) : pickerMode === 'addMember' ? (
                <label className="mt-4 block text-sm font-semibold text-foreground-secondary">
                  {t('admin.organizations.detail.memberSearch')}
                  <input
                    type="search"
                    value={pickerSearch}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPickerSearch(value);
                      void loadPlatformAccounts(value);
                    }}
                    placeholder={t('admin.organizations.detail.promoteSearchPlaceholder')}
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </label>
              ) : null}
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-3">
              {pickerMode === 'reassign' && assignMode === 'new' ? (
                <form
                  onSubmit={(event) => {
                    void handleAssignByEmail(event);
                  }}
                  className="space-y-3 p-3"
                >
                  <label className="block text-sm font-semibold text-foreground-secondary">
                    {t('admin.organizations.detail.assignNewAccountEmail')}
                    <input
                      required
                      type="email"
                      value={assignEmail}
                      onChange={(e) => setAssignEmail(e.target.value)}
                      className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </label>
                  <label className="block text-sm font-semibold text-foreground-secondary">
                    {t('admin.organizations.detail.assignNewAccountDisplayName')}
                    <input
                      minLength={2}
                      maxLength={100}
                      value={assignDisplayName}
                      onChange={(e) => setAssignDisplayName(e.target.value)}
                      className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </label>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={actionLoading}
                      className="rounded-md bg-info px-4 py-2 text-sm font-semibold text-white hover:bg-info/90 disabled:opacity-60"
                    >
                      {actionLoading
                        ? t('admin.organizations.detail.assignNewAccountSubmitting')
                        : t('admin.organizations.detail.assignNewAccountSubmit')}
                    </button>
                  </div>
                </form>
              ) : null}

              {(pickerMode === 'addMember' ||
                (pickerMode === 'reassign' && assignMode === 'existing')) &&
              platformLoading ? (
                <p className="p-4 text-sm text-muted">
                  {t('admin.organizations.detail.accountSearchLoading')}
                </p>
              ) : null}
              {(pickerMode === 'addMember' ||
                (pickerMode === 'reassign' && assignMode === 'existing')) &&
              platformError ? (
                <p className="p-4 text-sm text-danger">{platformError}</p>
              ) : null}

              <div className="space-y-2">
                {pickerMode === 'reassign' && assignMode === 'existing'
                  ? // Merge org members with platform accounts (dedup by user_id) so
                    // the operator can pick from either. Members come first.
                    [
                      ...filteredMembers.map((m) => ({
                        id: m.user_id,
                        email: m.email,
                        display_name: m.display_name,
                        username: m.username,
                        isMember: true,
                        role: m.role,
                      })),
                      ...platformAccounts
                        .filter((a) => !org.members.some((m) => m.user_id === a.id))
                        .map((a) => ({
                          id: a.id,
                          email: a.email ?? null,
                          display_name: a.display_name ?? null,
                          username: a.email ?? a.id,
                          isMember: false,
                          role: null as string | null,
                        })),
                    ].map((row) => {
                      const isCurrentOwner = row.role === 'owner';
                      const label = row.display_name?.trim() || row.email || row.username || row.id;
                      return (
                        <button
                          key={row.id}
                          type="button"
                          disabled={actionLoading || isCurrentOwner}
                          onClick={() => {
                            void handlePickExistingUser(row.id, label);
                          }}
                          className="w-full rounded-md border border-border px-4 py-3 text-left transition hover:border-info/30 hover:bg-info/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span className="block font-semibold text-foreground">
                            {label}
                            {isCurrentOwner ? (
                              <span className="ml-2 rounded bg-gold/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gold">
                                {t('admin.adminMisc.ownerBadge')}
                              </span>
                            ) : row.isMember ? (
                              <span className="ml-2 rounded bg-background px-1.5 py-0.5 text-[10px] font-semibold uppercase text-foreground-secondary">
                                {row.role}
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-1 block text-sm text-foreground-secondary">
                            {row.email || t('admin.users.noEmail')}
                          </span>
                        </button>
                      );
                    })
                  : pickerMode === 'addMember'
                    ? platformAccounts
                        .filter((acc) => !org.members.some((m) => m.user_id === acc.id))
                        .map((account) => {
                          const isSuperAdmin = account.is_super_admin === true;
                          return (
                            <button
                              key={account.id}
                              type="button"
                              disabled={actionLoading || isSuperAdmin}
                              onClick={() => {
                                if (isSuperAdmin) return;
                                void handleAddMember(account);
                              }}
                              title={
                                isSuperAdmin
                                  ? 'Super-admin — cannot belong to an organization.'
                                  : undefined
                              }
                              className="w-full rounded-md border border-border px-4 py-3 text-left transition hover:border-info/30 hover:bg-info/10 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <span className="block font-semibold text-foreground">
                                {accountLabel(account)}
                                {isSuperAdmin && (
                                  <span className="ml-2 rounded-full bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold">
                                    {t('admin.adminMisc.superAdminBadge')}
                                  </span>
                                )}
                              </span>
                              <span className="mt-1 block text-sm text-foreground-secondary">
                                {account.email || t('admin.users.noEmail')}
                              </span>
                            </button>
                          );
                        })
                    : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {confirmDialog}
    </main>
  );
}
