'use client';

import { Switch } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import type { NotifyKey } from './card-switches';
import type { PersonFollowing } from './personContext';

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
 * Three speak for every coming Event where the person is followed (ruling 239): one set, on only
 * when on in every one of them, and shown only when there is such an Event.
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
  const { eventFollow } = follow;
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
