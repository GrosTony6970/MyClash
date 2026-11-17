import * as React from 'react';

import type { MatchProtest } from '../types/match-events';
import { liveProtestsOf, protestAtLimit, protestChipText } from '../utils/protest-chip';
import { HandMark } from './hand-mark';

/**
 * A fighter's protests, beside the card chips on the TV scoreboard: the count,
 * or `count/limit` with a Tournament limit, in the warning colour from the
 * limit on. Voided protests and the other fighter's are not counted.
 *
 * Warning ink (`--color-warning` #b45309) on the chip's own fill, `bg-warning/20`
 * blended over `--color-stage` #030712, is 3.47:1, over the 3:1 a stage-size
 * glyph needs. Against the bare stage the ink alone is 4.01:1.
 */
export function TvProtestChip({
  protests,
  registrationId,
  limit,
  fighterName,
  t,
}: {
  protests: MatchProtest[];
  registrationId: string;
  limit: number | null;
  fighterName: string;
  t: (key: string, params?: Record<string, string>) => string;
}): React.ReactElement {
  const count = liveProtestsOf(protests, registrationId).length;
  const atLimit = protestAtLimit(count, limit);
  // Like the card chips, the chip fades at zero; the warning wins over the fade.
  const tone = atLimit
    ? 'bg-warning/20 text-warning'
    : `bg-stage-foreground/10 text-stage-foreground ${count === 0 ? 'opacity-30' : ''}`;
  return (
    <span
      title={t('scoring.lice.protestsChipTooltip', { fighter: fighterName })}
      className={`text-stage-club inline-flex items-center gap-2 rounded-full px-4 py-1.5 font-bold ${tone}`}
    >
      <HandMark className="h-[1em] w-[1em]" />
      {protestChipText(count, limit)}
    </span>
  );
}
