import type { Locale } from '@myclash/i18n';
import { localeToBcp47 } from '@myclash/time';
import type { PublicSparLine, SparStars } from '@myclash/types';

type Say = (key: string, values?: Record<string, string | number>) => string;

/** "★ 4.3 (7)": one decimal, the locale's separator. The one owner of the star format. */
export function formatStars(stars: SparStars, t: Say, locale: Locale): string {
  const average = new Intl.NumberFormat(localeToBcp47(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(stars.average);
  return t('publicApp.fightBook.stars', { average, count: stars.count });
}

/**
 * "Sparred N times" and, when the fighter switched them on, their stars. Takes `t` and `locale`
 * so the server page and the client settings panel both render it. Nothing for no line, or a
 * fighter with no spar and no stars.
 */
export function SparredLine({
  line,
  t,
  locale,
}: {
  line: PublicSparLine | null;
  t: Say;
  locale: Locale;
}) {
  if (!line || (line.sparred === 0 && !line.stars)) return null;
  const sparred =
    line.sparred === 0
      ? null
      : line.sparred === 1
        ? t('publicApp.fightBook.sparredOne')
        : t('publicApp.fightBook.sparredMany', { count: line.sparred });
  const parts = [sparred, line.stars ? formatStars(line.stars, t, locale) : null];
  return <p className="mt-1 text-xs text-muted">{parts.filter(Boolean).join(' · ')}</p>;
}
