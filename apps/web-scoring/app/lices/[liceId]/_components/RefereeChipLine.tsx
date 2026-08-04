'use client';

import { SkillBadge } from '@myclash/ui';
import { useI18n } from '../../../../src/i18n/I18nProvider';
import type { LiceMatchReferee } from '../../../../src/components/lice-match-types';

/**
 * Who is officiating, and in what capacity.
 *
 * One line per referee: the role as a `SkillBadge` tinted with the skill's own
 * catalogue colour, then the name. The label is `referee_skills.name` — data,
 * not an i18n key — so custom skills read properly instead of falling through
 * to a raw id the way the public surfaces' hardcoded label map does.
 */
export function RefereeChipLine({ referees }: { referees: LiceMatchReferee[] }) {
  const { t } = useI18n();
  if (referees.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {referees.map((referee) => (
        <li
          key={`${referee.name}:${referee.role ?? ''}`}
          className="flex min-w-0 items-center gap-1.5 text-xs text-muted"
        >
          <span className="sr-only">{t('scoring.lice.refereeLabel')}: </span>
          {referee.roleLabel && (
            <SkillBadge color={referee.roleColor} label={referee.roleLabel} size="xs" />
          )}
          <span className="truncate">{referee.name}</span>
        </li>
      ))}
    </ul>
  );
}
