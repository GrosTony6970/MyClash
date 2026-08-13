'use client';

import { useEffect, useState } from 'react';
import { SegmentedTabs, usePrompt } from '@myclash/ui';
import { STAFF_ROLES, type StaffRole } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';
import { CreateStaffAccountForm } from './CreateStaffAccountForm';
import { StaffAccountList } from './StaffAccountList';
import { isStaffRoleTab, STAFF_TAB_HINT_KEYS, STAFF_TAB_LABEL_KEYS } from './types';
import type { StaffAccount } from './types';
import type { useStaffAccounts } from './useStaffAccounts';

interface Props {
  staff: ReturnType<typeof useStaffAccounts>;
  staffUrl: string;
  publicAppUrl: string;
  eventSlug: string | null;
}

/**
 * The role-scoped half of the page: which tab, the create form for that tab,
 * and that tab's accounts.
 *
 * Owns the tab state rather than taking it as a prop, because nothing above it
 * needs to know: the event-level header and sign-in links are identical for all
 * three roles. That keeps the page a straight composition of two independent
 * sections.
 */
export function StaffRoleSection({ staff, staffUrl, publicAppUrl, eventSlug }: Props) {
  const { t } = useI18n();
  const { prompt, promptDialog } = usePrompt();
  const [tab, setTab] = useState<StaffRole>('scoring');
  useTabInUrl(tab, setTab);

  async function askForPin(account: StaffAccount) {
    const pin = await prompt({ title: t('organizer.staff.pin'), masked: true });
    if (pin) await staff.resetPin(account, pin);
  }

  return (
    <>
      <RoleTabs accounts={staff.accounts} tab={tab} onChange={setTab} />

      <CreateStaffAccountForm role={tab} onCreate={staff.createAccount} />

      {staff.error && <p className="mt-4 text-sm text-danger">{staff.error}</p>}
      {staff.notice && <p className="mt-4 text-sm text-success">{staff.notice}</p>}

      <StaffAccountList
        accounts={staff.accounts.filter((account) => account.role === tab)}
        role={tab}
        lices={staff.lices}
        loading={staff.loading}
        publicAppUrl={publicAppUrl}
        staffUrl={staffUrl}
        eventSlug={eventSlug}
        onToggleStatus={(target) => void staff.toggleStatus(target)}
        onResetPin={(target) => void askForPin(target)}
        onSetRole={(target, role) => void staff.setRole(target, role)}
        onSetLices={(target, liceId, checked) =>
          void staff.setAccountLices(target, liceId, checked)
        }
      />

      {promptDialog}
    </>
  );
}

/**
 * The three tabs, each carrying its own live count, plus the hint that says
 * what the selected role actually does — an organiser meeting these tabs for
 * the first time on an event morning should not have to infer "gear" from the
 * word alone.
 */
function RoleTabs({
  accounts,
  tab,
  onChange,
}: {
  accounts: ReadonlyArray<{ role: StaffRole }>;
  tab: StaffRole;
  onChange: (next: StaffRole) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="mt-6">
      <SegmentedTabs
        tabs={STAFF_ROLES.map((role) => ({
          value: role,
          label: `${t(STAFF_TAB_LABEL_KEYS[role])} (${countByRole(accounts, role)})`,
        }))}
        value={tab}
        onChange={onChange}
        aria-label={t('organizer.staff.tabsLabel')}
        className="max-w-2xl"
      />
      <p className="mt-2 text-sm text-muted">{t(STAFF_TAB_HINT_KEYS[tab])}</p>
    </div>
  );
}

function countByRole(accounts: ReadonlyArray<{ role: StaffRole }>, role: StaffRole): number {
  return accounts.filter((account) => account.role === role).length;
}

/**
 * Deep-link `?tab=` without next/navigation's `useSearchParams` — that hook
 * makes the React Compiler bail out of the whole component, costing the
 * memoization the list relies on. Read once on mount, write back on change.
 * Same shape as the platform accounts console.
 */
function useTabInUrl(tab: StaffRole, setTab: (next: StaffRole) => void) {
  // A one-time deep-link read on mount. The URL is not readable during SSR, so
  // this cannot move into the useState initializer without a hydration
  // mismatch. (No eslint-disable needed here, unlike the same code written
  // inline in a component: `setTab` arrives as a parameter, so
  // react-hooks/set-state-in-effect cannot see it is a state setter. That is
  // the rule going blind, not the pattern becoming safe — keep the effect
  // one-shot.)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    if (isStaffRoleTab(q)) setTab(q);
  }, [setTab]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('tab') === tab) return;
    url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, [tab]);
}
