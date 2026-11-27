'use client';

import { useI18n } from '@myclash/next-i18n/client';
import type { EntrantKind } from './entrant-kind';

interface CapacityFieldsProps {
  kind: EntrantKind;
  /** The fields' text: blank is no cap. */
  maxParticipants: string;
  maxWaitlist: string;
  onMaxParticipants: (text: string) => void;
  onMaxWaitlist: (text: string) => void;
}

/**
 * A Tournament's capacity caps, the same in the creator's Step 1 and the settings Basics tab.
 * Blank is no cap. A team Tournament caps its teams (`max_participants` counted over teams) and has
 * no waitlist: the waitlist field is not drawn, and the saves do not send it (`bodyForKind`).
 */
export function CapacityFields(props: CapacityFieldsProps) {
  const { kind, maxParticipants, maxWaitlist, onMaxParticipants, onMaxWaitlist } = props;
  const { t } = useI18n();
  const maxLabel =
    kind === 'team'
      ? t('organizer.tournaments.kind.maxTeams')
      : t('admin.orgTournaments.maxParticipants');
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block">
        <span className="block text-xs font-medium text-foreground-secondary mb-1">{maxLabel}</span>
        <input
          aria-label={maxLabel}
          type="number"
          min={1}
          value={maxParticipants}
          onChange={(e) => onMaxParticipants(e.target.value)}
          placeholder={t('admin.orgTournaments.noCap')}
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>
      {kind === 'individual' && (
        <label className="block">
          <span className="block text-xs font-medium text-foreground-secondary mb-1">
            {t('admin.orgTournaments.maxWaitlist')}
          </span>
          <input
            aria-label={t('admin.orgTournaments.maxWaitlist')}
            type="number"
            min={0}
            value={maxWaitlist}
            onChange={(e) => onMaxWaitlist(e.target.value)}
            placeholder={t('admin.orgTournaments.noCap')}
            className="w-full rounded-md border border-border px-3 py-2 text-sm"
          />
          {Number(maxWaitlist) > 0 && !maxParticipants && (
            <p className="mt-1 text-xs text-warning">
              {t('admin.orgTournaments.waitlistNeedsCap')}
            </p>
          )}
        </label>
      )}
    </div>
  );
}
