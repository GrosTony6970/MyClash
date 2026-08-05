'use client';

import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { StaffLoginLink } from './StaffLoginLink';
import type { Lice, StaffAccount } from './types';

interface Props {
  account: StaffAccount;
  /** Every Lice of the event — the assignment checkboxes. */
  lices: Lice[];
  /** Public app origin, for the read-only display URLs. */
  publicAppUrl: string;
  /** Scoring pad origin, for the PIN sign-in link. */
  scoringUrl: string;
  /**
   * The event slug, or null while the event fetch has not landed. Both the
   * staff login and the public display resolve an event by SLUG only
   * (`staff.service.findEventBySlug`) — a link built on the id 404s, so there is
   * no URL to show until the slug is known.
   */
  eventSlug: string | null;
  onToggleStatus: (account: StaffAccount) => void;
  onResetPin: (account: StaffAccount) => void;
  onSetLices: (account: StaffAccount, liceId: string, checked: boolean) => void;
}

/**
 * One local staff account: identity, enable/disable + PIN reset, Lice
 * assignments, the account's own PIN sign-in link, and one labelled display URL
 * per assigned Lice.
 */
export function StaffAccountCard({
  account,
  lices,
  publicAppUrl,
  scoringUrl,
  eventSlug,
  onToggleStatus,
  onResetPin,
  onSetLices,
}: Props) {
  const { t } = useI18n();
  const liceMap = new Map(lices.map((lice) => [lice.id, lice.name]));

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display font-semibold text-lg sm:text-xl">{account.display_name}</h2>
          <p className="text-sm text-muted">
            {account.username} - {t(`organizer.staff.${account.status}`)}
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
            {account.status === 'active'
              ? t('organizer.staff.disable')
              : t('organizer.staff.enable')}
          </button>
        </div>
      </div>

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

      {eventSlug && (
        <div className="mt-4">
          <h3 className="text-sm font-bold text-foreground-secondary">
            {t('organizer.staff.staffLogin')}
          </h3>
          <div className="mt-2">
            <StaffLoginLink
              label={t('organizer.staff.staffLoginUrlFor', { name: account.display_name })}
              url={`${scoringUrl}/login?event=${encodeURIComponent(eventSlug)}&u=${encodeURIComponent(account.username)}`}
              withQr
            />
          </div>
        </div>
      )}

      {eventSlug && (
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
      )}
    </section>
  );
}
