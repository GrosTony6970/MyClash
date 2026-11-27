'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { protestLimitValid, type DisplayState } from './display-form';
import type { PenaltyEntry } from './usePenaltyEntries';

/**
 * A Tournament's protest limit, and the penalty of its list the pad offers past it: the ONE owner
 * of this markup, on the Display tab and in wizard Step 3. The caller's Save (or Next) also checks
 * `protestLimitValid`: this block says why a limit is refused, it blocks nothing.
 *
 * A stored penalty the list no longer holds is shown as missing once the list was read, and a
 * limit with no penalty to offer says the pad will offer none.
 */
export function ProtestLimitFields({
  data,
  setData,
  penaltyEntries,
  penaltyListRead,
}: {
  data: DisplayState;
  setData: (next: DisplayState) => void;
  penaltyEntries: readonly PenaltyEntry[];
  penaltyListRead: boolean;
}) {
  const { t } = useI18n();
  const limitInvalid = !protestLimitValid(data.protestLimit);
  const offerRef = data.protestOfferRef;
  const offerListed = penaltyEntries.some((e) => e.ref_number === offerRef);
  const offerMissing = offerRef !== null && !offerListed && penaltyListRead;
  const noOffer = data.protestLimit !== '' && (offerRef === null || offerMissing);

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="sm:w-48">
          <span className="block text-xs font-medium text-foreground-secondary mb-1">
            {t('organizer.tournaments.settings.protestLimit')}
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={data.protestLimit}
            onChange={(e) => setData({ ...data, protestLimit: e.target.value })}
            aria-invalid={limitInvalid}
            className="w-full rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex-1">
          <span className="block text-xs font-medium text-foreground-secondary mb-1">
            {t('organizer.tournaments.settings.protestOfferPenalty')}
          </span>
          <select
            value={offerRef ?? ''}
            onChange={(e) => setData({ ...data, protestOfferRef: e.target.value || null })}
            className="w-full rounded-md border border-border px-3 py-2 text-sm"
          >
            <option value="">{t('organizer.tournaments.settings.protestOfferNone')}</option>
            {offerRef !== null && !offerListed && (
              <option value={offerRef}>
                {offerMissing
                  ? t('organizer.tournaments.settings.protestOfferMissing', { ref: offerRef })
                  : offerRef}
              </option>
            )}
            {penaltyEntries.map((e) => (
              <option key={e.id} value={e.ref_number}>
                {`${e.ref_number} · ${e.short_name}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {limitInvalid && (
        <p role="alert" className="text-[11px] text-danger">
          {t('organizer.tournaments.settings.protestLimitInvalid')}
        </p>
      )}
      <p className="text-[11px] text-muted">
        {t('organizer.tournaments.settings.protestLimitHelp')}
      </p>
      {noOffer && (
        <p className="text-[11px] text-warning">
          {t('organizer.tournaments.settings.protestNoOfferNote')}
        </p>
      )}
    </div>
  );
}
