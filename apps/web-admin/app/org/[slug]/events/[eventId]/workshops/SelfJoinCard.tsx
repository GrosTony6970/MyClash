'use client';

import { Switch } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { useSelfJoinSwitch } from './use-self-join-switch';

/**
 * "People may join this Event by themselves" (rulings 516, 568): with it on, a signed-in account
 * that is not on the list may put itself on it from a Workshop page and book. Every member sees it,
 * as the photo mode and the menu card; the server refuses a save by a non-admin, and the switch
 * then goes back with the refusal shown.
 */
export function SelfJoinCard({
  apiUrl,
  eventId,
  readOnly,
}: {
  apiUrl: string;
  eventId: string;
  readOnly: boolean;
}) {
  const { t } = useI18n();
  const { on, saving, error, save } = useSelfJoinSwitch(apiUrl, eventId);
  return (
    <section className="mb-6 rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <label htmlFor="workshopSelfJoin" className="text-sm font-semibold text-foreground">
            {t('organizer.selfJoin.title')}
          </label>
          <p className="mt-1 text-sm text-muted">{t('organizer.selfJoin.help')}</p>
        </div>
        <Switch
          id="workshopSelfJoin"
          checked={on === true}
          disabled={on === null || saving || readOnly}
          onChange={(next) => void save(next)}
        />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
