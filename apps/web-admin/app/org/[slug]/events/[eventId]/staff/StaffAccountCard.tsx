'use client';

import { STAFF_ROLES, staffRoleUsesLices, type StaffRole } from '@myclash/types';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { StaffLoginLink } from './StaffLoginLink';
import { STAFF_TAB_LABEL_KEYS, type Lice, type StaffAccount } from './types';

interface Props {
  account: StaffAccount;
  /** Every Lice of the event — the assignment checkboxes. */
  lices: Lice[];
  /** Public app origin, for the read-only display URLs. */
  publicAppUrl: string;
  /** Staff app origin, for the PIN sign-in link. */
  staffUrl: string;
  /**
   * The event slug, or null while the event fetch has not landed. Both the
   * staff login and the public display resolve an event by SLUG only
   * (`staff.service.findEventBySlug`) — a link built on the id 404s, so there is
   * no URL to show until the slug is known.
   */
  eventSlug: string | null;
  onToggleStatus: (account: StaffAccount) => void;
  onResetPin: (account: StaffAccount) => void;
  onSetRole: (account: StaffAccount, role: StaffRole) => void;
  onSetLices: (account: StaffAccount, liceId: string, checked: boolean) => void;
}

// A literal map rather than a template literal interpolating the status. A
// template would hand the i18n reverse sweep the prefix organizer.staff. — and a
// prefix whitelists the WHOLE subtree under it, so every orphaned key on this
// page went invisible to the orphan check. Two exact literals keep it working.
// (Do not write the template form in this comment either: the sweep scans raw
// text, so an example in a comment re-derives the prefix just as the code did.)
const STATUS_KEYS = {
  active: 'organizer.staff.active',
  disabled: 'organizer.staff.disabled',
} as const;

/**
 * Piste assignments — rendered ONLY for a role that runs a piste.
 *
 * `event_staff_lice_assignments` is the piste-scoped gate on scoring writes and
 * nothing else reads it. For a check-in or gear account the checkboxes would
 * change a row that no code path consults, i.e. an assignment control that
 * gates nothing — which is the exact defect that got the previous `role` column
 * deleted in migration 0168. Not rendering it is the point, not a shortcut.
 */
function LiceAssignments({
  account,
  lices,
  onSetLices,
}: Pick<Props, 'account' | 'lices' | 'onSetLices'>) {
  const { t } = useI18n();
  if (!staffRoleUsesLices(account.role)) return null;

  return (
    <div className="mt-4">
      <h3 className="text-sm font-bold text-foreground-secondary">
        {t('organizer.staff.assignments')}
      </h3>
      <div className="mt-2 flex flex-wrap gap-3">
        {lices.map((lice) => (
          <label key={lice.id} className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={account.liceIds.includes(lice.id)}
              onChange={(event) => onSetLices(account, lice.id, event.target.checked)}
            />
            {lice.name}
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * The read-only display URL per assigned Lice. Empty — and therefore absent —
 * for any account with no assignments, which is every desk and gear account.
 */
function LiceDisplayLinks({
  account,
  lices,
  publicAppUrl,
  eventSlug,
}: Pick<Props, 'account' | 'lices' | 'publicAppUrl'> & { eventSlug: string }) {
  const { t } = useI18n();
  if (account.liceIds.length === 0) return null;
  const liceMap = new Map(lices.map((lice) => [lice.id, lice.name]));

  return (
    <div className="mt-4">
      <h3 className="text-sm font-bold text-foreground-secondary">
        {t('organizer.staff.displayUrls')}
      </h3>
      <div className="mt-2 space-y-2">
        {account.liceIds.map((liceId) => {
          const liceName = liceMap.get(liceId) ?? liceId;
          return (
            <StaffLoginLink
              key={liceId}
              label={t('organizer.staff.liceDisplayFor', { lice: liceName })}
              url={`${publicAppUrl}/e/${eventSlug}/lice/${encodeURIComponent(liceName)}/display`}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Move a mis-tabbed account to another role in place.
 *
 * Creating on the wrong tab is the mistake this page's implicit-role form
 * trades for; there is no delete verb, only disable, so without a correction
 * path a wrongly-created volunteer would be stranded. Explicit buttons rather
 * than a dropdown, matching the create form's reasoning: two visible targets
 * beat a control that can be left on the wrong value.
 */
function RoleSwitcher({ account, onSetRole }: Pick<Props, 'account' | 'onSetRole'>) {
  const { t } = useI18n();
  const others = STAFF_ROLES.filter((role) => role !== account.role);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">{t('organizer.staff.moveTo')}</span>
      {others.map((role) => (
        <button
          key={role}
          onClick={() => onSetRole(account, role)}
          className="rounded border border-border px-2 py-1 text-xs font-semibold"
        >
          {t(STAFF_TAB_LABEL_KEYS[role])}
        </button>
      ))}
    </div>
  );
}

/** Identity on the left, the two account-level actions on the right. */
function AccountHeader({
  account,
  onToggleStatus,
  onResetPin,
}: Pick<Props, 'account' | 'onToggleStatus' | 'onResetPin'>) {
  const { t } = useI18n();

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="font-display font-semibold text-lg sm:text-xl">{account.display_name}</h2>
        <p className="text-sm text-muted">
          {account.username} - {t(STATUS_KEYS[account.status])}
        </p>
      </div>
      <div className="flex gap-2">
        <button onClick={() => onResetPin(account)} className="rounded border px-3 py-2 text-sm">
          {t('organizer.staff.resetPin')}
        </button>
        <button
          onClick={() => onToggleStatus(account)}
          className="rounded border px-3 py-2 text-sm"
        >
          {account.status === 'active' ? t('organizer.staff.disable') : t('organizer.staff.enable')}
        </button>
      </div>
    </div>
  );
}

/**
 * One local staff account: identity, enable/disable + PIN reset, the role it
 * holds, its own PIN sign-in link, and — for a scoring account only — Lice
 * assignments and one labelled display URL per assigned Lice.
 */
export function StaffAccountCard({
  account,
  lices,
  publicAppUrl,
  staffUrl,
  eventSlug,
  onToggleStatus,
  onResetPin,
  onSetRole,
  onSetLices,
}: Props) {
  const { t } = useI18n();

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <AccountHeader account={account} onToggleStatus={onToggleStatus} onResetPin={onResetPin} />

      <RoleSwitcher account={account} onSetRole={onSetRole} />

      <LiceAssignments account={account} lices={lices} onSetLices={onSetLices} />

      {eventSlug && (
        <div className="mt-4">
          <h3 className="text-sm font-bold text-foreground-secondary">
            {t('organizer.staff.staffLogin')}
          </h3>
          <div className="mt-2">
            <StaffLoginLink
              label={t('organizer.staff.staffLoginUrlFor', { name: account.display_name })}
              url={`${staffUrl}/login?event=${encodeURIComponent(eventSlug)}&u=${encodeURIComponent(account.username)}`}
              withQr
            />
          </div>
        </div>
      )}

      {eventSlug && (
        <LiceDisplayLinks
          account={account}
          lices={lices}
          publicAppUrl={publicAppUrl}
          eventSlug={eventSlug}
        />
      )}
    </section>
  );
}
