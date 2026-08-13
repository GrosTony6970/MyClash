'use client';

import { StatusBadge, matchStatusSemantic } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { useScoringTheme } from '../../../../src/theme/ThemeProvider';

/**
 * THE match status chip for the two lice screens.
 *
 * There used to be three treatments of the same idea: the picker pulsed a red
 * pill, the detail card painted an amber one carrying a hardcoded, untranslated
 * "LIVE", and `StatusBadge` rendered live as green. Routing all of them through
 * `matchStatusSemantic` means a live bout looks the same everywhere — and that
 * paused stops reading as live, since `statusPillClass` only pulses `live`.
 *
 * `surface` is the chrome scope, not the pad scope: these two screens ARE the
 * app's light chrome. The palette is chosen in JS, so it cannot follow the CSS
 * `[data-theme]` cascade — it has to be told which surface it is on.
 */
export function MatchStatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  const { chromeScope } = useScoringTheme();
  const semantic = matchStatusSemantic(status);
  return (
    <StatusBadge semantic={semantic} surface={chromeScope} size="sm">
      {t(`scoring.lice.statuses.${semantic}`)}
    </StatusBadge>
  );
}
