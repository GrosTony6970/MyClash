'use client';

import { HelpTooltip } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import type { TeamSpread } from './pool-seats';

const CHOICES: Array<{ value: TeamSpread; labelKey: string }> = [
  { value: 'seed', labelKey: 'organizer.pools.configure.teamSpreadSeed' },
  { value: 'random', labelKey: 'organizer.pools.configure.teamSpreadRandom' },
];

/**
 * How a team Tournament's teams are spread over its Pools (ruling 971): by seed or by random draw.
 * It stands where an individual Tournament has its club and skill switches, which a team has no
 * club and no rating to use.
 */
export function TeamSpreadChoice({
  value,
  onChange,
}: {
  value: TeamSpread;
  onChange: (next: TeamSpread) => void;
}) {
  const { t } = useI18n();
  return (
    <fieldset className="space-y-1.5 text-sm">
      <legend className="mb-1 flex items-center">
        {t('organizer.pools.configure.teamSpread')}
        <HelpTooltip text={t('organizer.pools.configure.help.teamSpread')} />
      </legend>
      {CHOICES.map((choice) => (
        <label key={choice.value} className="flex items-center gap-2">
          <input
            type="radio"
            name="team-spread"
            value={choice.value}
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
          />
          {t(choice.labelKey)}
        </label>
      ))}
    </fieldset>
  );
}
