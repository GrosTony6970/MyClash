'use client';

import type { StaffRole } from '@myclash/types';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { StaffAccountCard } from './StaffAccountCard';
import { STAFF_TAB_EMPTY_KEYS, type Lice, type StaffAccount } from './types';

interface Props {
  /** Already filtered to the active tab by the page. */
  accounts: StaffAccount[];
  role: StaffRole;
  lices: Lice[];
  loading: boolean;
  publicAppUrl: string;
  staffUrl: string;
  eventSlug: string | null;
  onToggleStatus: (account: StaffAccount) => void;
  onResetPin: (account: StaffAccount) => void;
  onSetRole: (account: StaffAccount, role: StaffRole) => void;
  onSetLices: (account: StaffAccount, liceId: string, checked: boolean) => void;
}

/**
 * The accounts of one role, or that role's own empty state.
 *
 * The empty copy is per role rather than one generic "no staff accounts yet":
 * an organiser landing on the Gear check tab of a fully-staffed event needs to
 * read that THIS role has nobody, not that the event does.
 */
export function StaffAccountList({ accounts, role, loading, ...card }: Props) {
  const { t } = useI18n();

  if (loading) return <p className="mt-8 text-sm text-muted">{t('organizer.staff.loading')}</p>;

  if (accounts.length === 0) {
    return (
      <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-sm text-muted">
        {t(STAFF_TAB_EMPTY_KEYS[role])}
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {accounts.map((account) => (
        <StaffAccountCard key={account.id} account={account} {...card} />
      ))}
    </div>
  );
}
