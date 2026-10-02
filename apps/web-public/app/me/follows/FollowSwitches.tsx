'use client';

import { Switch } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import type { PersonFollowing } from './personContext';

/** A switch of a follow of ONE Event. */
export type NotifyKey = 'notifyMatchStart' | 'notifyWorkshopStart' | 'notifyRefereeStart';

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-muted">{label}</span>
      <Switch checked={checked} onChange={onChange} ariaLabel={label} />
    </label>
  );
}

/**
 * The alert switches of a card of the "Following" tab: the ONE owner of them.
 *
 * Three sit on the follow of one Event, and show only when an active Event follow backs them.
 * The fourth is the hub follow's own (ruling 217): "notify when refereeing", in every Event where
 * the follower has no Event follow of that person. It is on every card, so a person followed
 * from the People hub alone, who referees from the directory, can be asked for.
 */
export function FollowSwitches({
  follow,
  onToggle,
  onHubToggle,
}: {
  follow: PersonFollowing;
  onToggle: (key: NotifyKey, value: boolean) => void;
  onHubToggle: (value: boolean) => void;
}) {
  const { t } = useI18n();
  const eventFollow = follow.eventFollow?.active ? follow.eventFollow : null;
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      {eventFollow && (
        <>
          <SwitchRow
            label={t('publicApp.me.follows.notifyMatch')}
            checked={eventFollow.notifyMatchStart}
            onChange={(value) => onToggle('notifyMatchStart', value)}
          />
          <SwitchRow
            label={t('publicApp.me.follows.notifyReferee')}
            checked={eventFollow.notifyRefereeStart}
            onChange={(value) => onToggle('notifyRefereeStart', value)}
          />
          <SwitchRow
            label={t('publicApp.me.follows.notifyWorkshop')}
            checked={eventFollow.notifyWorkshopStart}
            onChange={(value) => onToggle('notifyWorkshopStart', value)}
          />
        </>
      )}
      <SwitchRow
        label={t(
          eventFollow
            ? 'publicApp.me.follows.notifyRefereeElsewhere'
            : 'publicApp.me.follows.notifyReferee',
        )}
        checked={follow.hubFollow.notifyRefereeStart}
        onChange={onHubToggle}
      />
    </div>
  );
}
