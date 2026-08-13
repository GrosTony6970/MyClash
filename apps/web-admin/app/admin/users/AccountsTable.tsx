'use client';

import Link from 'next/link';
import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  rowActionClasses,
  type RowActionVariant,
} from '@myclash/ui';
import { localeToBcp47, type AppLocale } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { isDisabled, roleLabelKey, type AdminUser, type UsersTab } from './types';

function formatDate(value: string | null | undefined, fallback: string, locale: AppLocale) {
  return value ? new Date(value).toLocaleDateString(localeToBcp47(locale)) : fallback;
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
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 rounded-md bg-strong px-3 py-2 text-left text-xs font-medium leading-5 text-strong-foreground shadow-lg group-hover:block group-focus-within:block">
        {description}
      </span>
    </span>
  );
}

/** Org membership pills — the Role column on the Organisers tab. */
function OrgPills({ user }: { user: AdminUser }) {
  const orgs = user.organizations ?? [];
  if (orgs.length === 0) return <span className="text-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {orgs.slice(0, 3).map((org) => (
        <span
          key={org.id}
          className="rounded-full border border-border bg-background px-2 py-0.5"
          title={org.name}
        >
          {org.name} <span className="text-muted">· {org.role}</span>
        </span>
      ))}
      {orgs.length > 3 && (
        <span className="rounded-full bg-background px-2 py-0.5 text-muted">
          +{orgs.length - 3}
        </span>
      )}
    </div>
  );
}

/** The Role column — the only cell whose meaning changes between tabs. */
function RoleCell({ user, tab }: { user: AdminUser; tab: UsersTab }) {
  const { t } = useI18n();

  if (tab === 'platform') {
    return (
      <span className="inline-flex rounded-full bg-gold/10 px-2 py-0.5 text-xs font-semibold text-gold-text">
        {t(roleLabelKey(user.platform_role))}
      </span>
    );
  }
  if (tab === 'organizer') return <OrgPills user={user} />;
  // The user tab is defined by absence — there is no role to name.
  return <span className="text-muted">—</span>;
}

export interface AccountsTableProps {
  tab: UsersTab;
  users: AdminUser[];
  onToggle: (user: AdminUser, action: 'disable' | 'enable') => void;
  onDelete: (user: AdminUser, mode: 'safe' | 'cleanup') => void;
}

/**
 * The accounts table.
 *
 * ## No column sorting, deliberately
 *
 * Paging is server-side, so a client-side sort would order the visible page
 * while presenting itself as a table-wide sort — misleading in a way that no
 * sort at all is not. The server orders by search relevance, then email.
 */
export function AccountsTable({ tab, users, onToggle, onDelete }: AccountsTableProps) {
  const { t, locale } = useI18n();

  return (
    <DataTable className="min-w-[980px]">
      <DataTableHead>
        <DataTableCell as="th">{t('admin.users.table.displayName')}</DataTableCell>
        <DataTableCell as="th">{t('admin.users.table.email')}</DataTableCell>
        <DataTableCell as="th">{t('admin.users.table.role')}</DataTableCell>
        {/*
          Organizations stays on the PLATFORM tab so a dual account's overlap is
          visible where it would otherwise surprise: the same row also appears
          under Organisers.
        */}
        {tab === 'platform' && (
          <DataTableCell as="th">{t('admin.users.table.organizations')}</DataTableCell>
        )}
        <DataTableCell as="th">{t('admin.users.table.created')}</DataTableCell>
        <DataTableCell as="th">{t('admin.users.table.lastSignIn')}</DataTableCell>
        <DataTableCell as="th">{t('admin.users.table.status')}</DataTableCell>
        <DataTableCell as="th">{t('admin.users.table.actions')}</DataTableCell>
      </DataTableHead>
      <tbody>
        {users.map((user) => {
          const disabled = isDisabled(user);
          return (
            <DataTableRow key={user.id}>
              <DataTableCell className="font-medium text-foreground">
                {user.display_name?.trim() || t('admin.users.noDisplayName')}
              </DataTableCell>
              <DataTableCell className="font-medium text-foreground">
                {user.email ?? t('admin.users.noEmail')}
              </DataTableCell>
              <DataTableCell className="text-xs text-foreground-secondary">
                <RoleCell user={user} tab={tab} />
              </DataTableCell>
              {tab === 'platform' && (
                <DataTableCell className="text-xs text-foreground-secondary">
                  <OrgPills user={user} />
                </DataTableCell>
              )}
              <DataTableCell className="text-foreground-secondary">
                {formatDate(user.created_at, t('admin.users.missingDate'), locale)}
              </DataTableCell>
              <DataTableCell className="text-foreground-secondary">
                {formatDate(user.last_sign_in_at, t('admin.users.missingDate'), locale)}
              </DataTableCell>
              <DataTableCell>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                    disabled ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'
                  }`}
                >
                  {disabled ? t('admin.users.status.disabled') : t('admin.users.status.active')}
                </span>
              </DataTableCell>
              <DataTableCell>
                <div className="flex gap-2">
                  <Link href={`/admin/users/${user.id}`} className={rowActionClasses('edit')}>
                    {t('admin.users.actions.edit')}
                  </Link>
                  <ActionButton
                    label={
                      disabled ? t('admin.users.actions.enable') : t('admin.users.actions.disable')
                    }
                    description={
                      disabled
                        ? t('admin.users.actions.enableHelp')
                        : t('admin.users.actions.disableHelp')
                    }
                    onClick={() => onToggle(user, disabled ? 'enable' : 'disable')}
                    variant={disabled ? 'success' : 'warning'}
                  />
                  <ActionButton
                    label={t('admin.users.actions.safeDelete')}
                    description={t('admin.users.actions.safeDeleteHelp')}
                    onClick={() => onDelete(user, 'safe')}
                    variant="neutral"
                  />
                  <ActionButton
                    label={t('admin.users.actions.cleanupDelete')}
                    description={t('admin.users.actions.cleanupDeleteHelp')}
                    onClick={() => onDelete(user, 'cleanup')}
                    variant="danger"
                  />
                </div>
              </DataTableCell>
            </DataTableRow>
          );
        })}
      </tbody>
    </DataTable>
  );
}
