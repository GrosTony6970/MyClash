'use client';

/**
 * Organization members — self-service member management.
 *
 * Before this page, POST /organizations/:id/members had no UI (and no
 * list/remove endpoints existed at all): only a super-admin could manage an
 * org's team. Org profile/branding lives on the dashboard's Branding card;
 * AI settings on the sibling /settings/ai page.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  useConfirm,
  useToast,
} from '@myclash/ui';
import { useI18n } from '../../../../src/i18n/I18nProvider';
import { getPublicApiUrl } from '@/lib/api-url';

interface OrgMember {
  userId: string;
  role: string;
  createdAt: string;
  name: string | null;
  email: string | null;
}

const MEMBER_ROLES = [
  'admin',
  'editor',
  'scorekeeper',
  'referee',
  'workshop_lead',
  'read_only',
] as const;

export default function OrgMembersPage() {
  const params = useParams<{ slug: string }>();
  const { slug } = params;
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [membersForbidden, setMembersForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<(typeof MEMBER_ROLES)[number]>('editor');
  const [adding, setAdding] = useState(false);

  const refreshMembers = useCallback(
    async (id: string) => {
      const res = await fetch(`${apiUrl}/api/v1/organizations/${id}/members`, {
        credentials: 'include',
      });
      if (res.status === 403) {
        setMembersForbidden(true);
        return;
      }
      if (res.ok) setMembers((await res.json()) as OrgMember[]);
    },
    [apiUrl],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`, {
          credentials: 'include',
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { id: string };
        if (cancelled) return;
        setOrgId(data.id);
        await refreshMembers(data.id);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, slug, refreshMembers]);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !newEmail.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/organizations/${orgId}/members`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail.trim(), role: newRole }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? t('organizer.orgSettings.addFailed'));
      }
      toast.success(t('organizer.orgSettings.memberAdded'));
      setNewEmail('');
      await refreshMembers(orgId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('organizer.orgSettings.addFailed'));
    } finally {
      setAdding(false);
    }
  }

  async function removeMember(member: OrgMember) {
    if (!orgId) return;
    const label = member.name ?? member.email ?? t('organizer.orgSettings.unknownUser');
    if (
      !(await confirm({
        title: t('organizer.orgSettings.removeConfirm', { name: label }),
        danger: true,
      }))
    )
      return;
    try {
      const res = await fetch(`${apiUrl}/api/v1/organizations/${orgId}/members/${member.userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? t('organizer.orgSettings.removeFailed'));
      }
      toast.success(t('organizer.orgSettings.memberRemoved'));
      await refreshMembers(orgId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('organizer.orgSettings.removeFailed'));
    }
  }

  if (loading) {
    return <p className="p-6 text-sm text-muted">{t('common.loading')}</p>;
  }
  if (!orgId) {
    return <p className="p-6 text-sm text-danger">{t('organizer.orgSettings.loadFailed')}</p>;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
          {t('organizer.orgSettings.membersTitle')}
        </h1>
        <p className="mt-1 text-sm text-muted">{t('organizer.orgSettings.membersSubtitle')}</p>
      </header>

      <section className="rounded-lg border border-border bg-surface p-5">
        {membersForbidden ? (
          <p className="text-sm text-muted">{t('organizer.orgSettings.membersForbidden')}</p>
        ) : (
          <>
            <DataTable>
              <DataTableHead>
                <DataTableCell as="th" scope="col">
                  {t('organizer.orgSettings.colMember')}
                </DataTableCell>
                <DataTableCell as="th" scope="col">
                  {t('organizer.orgSettings.colRole')}
                </DataTableCell>
                <DataTableCell as="th" scope="col" className="text-right">
                  {t('organizer.orgSettings.colActions')}
                </DataTableCell>
              </DataTableHead>
              <tbody>
                {(members ?? []).map((m) => (
                  <DataTableRow key={m.userId}>
                    <DataTableCell>
                      <p className="font-medium text-foreground">
                        {m.name ?? m.email ?? t('organizer.orgSettings.unknownUser')}
                      </p>
                      {m.name && m.email && <p className="text-xs text-muted">{m.email}</p>}
                    </DataTableCell>
                    <DataTableCell className="text-foreground">{m.role}</DataTableCell>
                    <DataTableCell className="text-right">
                      {m.role !== 'owner' && (
                        <button
                          type="button"
                          onClick={() => void removeMember(m)}
                          className="text-xs font-semibold text-danger underline hover:no-underline"
                        >
                          {t('organizer.orgSettings.remove')}
                        </button>
                      )}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </tbody>
            </DataTable>

            <form
              onSubmit={(e) => void addMember(e)}
              className="mt-5 flex flex-wrap items-end gap-3"
            >
              <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm font-medium text-foreground">
                {t('organizer.orgSettings.emailLabel')}
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                  placeholder={t('organizer.orgSettings.emailPlaceholder')}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                {t('organizer.orgSettings.roleLabel')}
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as (typeof MEMBER_ROLES)[number])}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  {MEMBER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={adding || !newEmail.trim()}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
              >
                {adding ? t('organizer.orgSettings.adding') : t('organizer.orgSettings.addMember')}
              </button>
            </form>
            <p className="mt-3 text-xs text-muted">{t('organizer.orgSettings.addHint')}</p>
          </>
        )}
      </section>

      {confirmDialog}
    </div>
  );
}
