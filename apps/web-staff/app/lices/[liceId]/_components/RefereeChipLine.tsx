'use client';

import { SkillBadge } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import type { LiceMatchReferee } from '../../../../src/components/lice-match-types';

/** Role chip + name. Phrasing content only, so it is legal in either wrapper. */
function RefereeEntry({ referee }: { referee: LiceMatchReferee }) {
  const { t } = useI18n();
  return (
    <>
      <span className="sr-only">{t('scoring.lice.refereeLabel')}: </span>
      {referee.roleLabel && (
        <SkillBadge color={referee.roleColor} label={referee.roleLabel} size="xs" />
      )}
      <span className="truncate">{referee.name}</span>
    </>
  );
}

const ENTRY_CLASS = 'flex min-w-0 items-center gap-1.5 text-xs text-muted';

/**
 * Who is officiating, and in what capacity.
 *
 * One entry per referee: the role as a `SkillBadge` tinted with the skill's own
 * catalogue colour, then the name. The label is `referee_skills.name` — data,
 * not an i18n key — so custom skills read properly instead of falling through
 * to a raw id the way the public surfaces' hardcoded label map does.
 *
 * `inline` swaps the `<ul>` for plain spans, wrapping on one line. Not a style
 * knob: the pool header renders this inside a `<button>`, whose content model
 * is phrasing content only — a list in there is invalid markup.
 */
export function RefereeChipLine({
  referees,
  inline = false,
}: {
  referees: LiceMatchReferee[];
  inline?: boolean;
}) {
  if (referees.length === 0) return null;

  if (inline) {
    return (
      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {referees.map((referee) => (
          <span key={`${referee.name}:${referee.role ?? ''}`} className={ENTRY_CLASS}>
            <RefereeEntry referee={referee} />
          </span>
        ))}
      </span>
    );
  }

  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {referees.map((referee) => (
        <li key={`${referee.name}:${referee.role ?? ''}`} className={ENTRY_CLASS}>
          <RefereeEntry referee={referee} />
        </li>
      ))}
    </ul>
  );
}
