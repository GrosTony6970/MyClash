'use client';

/**
 * The ordered tiebreak chain — a closed whitelist, enable-toggled and reorderable.
 *
 * Closed on purpose: `applyRanking` reads `Number(row.stats[key] ?? 0)` and is
 * generic over unknown keys, which is what makes a configurable chain cheap and
 * also what makes a free-text one dangerous — a typo would rank every fighter
 * on 0 and the standings would look perfectly plausible.
 *
 * The primary key (`swissPts` or the ruleset score, per `rankBy`) is NOT in this
 * list: it is what the chain breaks ties *within*, so offering it here would let
 * an organiser rank on it twice.
 */

import { useI18n } from '@myclash/next-i18n/client';

// The picker offers exactly what the API accepts. This list used to be copied
// here under a comment saying it mirrored the API's; the copy is now the one in
// `@myclash/rules`, which the API's DTO validates against too.
export { SWISS_TIEBREAK_KEYS } from '@myclash/rules';
import { SWISS_TIEBREAK_KEYS } from '@myclash/rules';

export function TiebreakChainField({
  chain,
  disabled,
  onChange,
}: {
  chain: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const { t } = useI18n();

  const available = SWISS_TIEBREAK_KEYS.filter((key) => !chain.includes(key));

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= chain.length) return;
    const next = [...chain];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    onChange(next);
  }

  return (
    <fieldset className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">
        {t('organizer.swiss.configure.tiebreakTitle')}
      </legend>
      <p className="text-xs text-foreground-secondary">
        {t('organizer.swiss.configure.tiebreakExplainer')}
      </p>

      <ol className="space-y-1">
        {chain.map((key, index) => (
          <li
            key={key}
            className="flex items-center justify-between gap-2 rounded border border-border bg-background px-3 py-1.5 text-sm"
          >
            <span className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted">{index + 1}.</span>
              <span className="font-medium text-foreground">
                {t(`organizer.swiss.tiebreak.${key}`)}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
                aria-label={t('organizer.swiss.configure.moveUp', {
                  key: t(`organizer.swiss.tiebreak.${key}`),
                })}
                className="rounded border border-border px-2 py-0.5 text-xs text-foreground-secondary hover:bg-surface disabled:opacity-40"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={disabled || index === chain.length - 1}
                onClick={() => move(index, 1)}
                aria-label={t('organizer.swiss.configure.moveDown', {
                  key: t(`organizer.swiss.tiebreak.${key}`),
                })}
                className="rounded border border-border px-2 py-0.5 text-xs text-foreground-secondary hover:bg-surface disabled:opacity-40"
              >
                ↓
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(chain.filter((k) => k !== key))}
                className="rounded border border-danger/40 px-2 py-0.5 text-xs text-danger hover:bg-danger/10 disabled:opacity-40"
              >
                {t('organizer.swiss.configure.removeTiebreak')}
              </button>
            </span>
          </li>
        ))}
        {chain.length === 0 && (
          <li className="text-xs italic text-warning">
            {t('organizer.swiss.configure.tiebreakEmpty')}
          </li>
        )}
      </ol>

      {available.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {available.map((key) => (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onChange([...chain, key])}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground-secondary hover:border-accent hover:text-accent disabled:opacity-40"
            >
              + {t(`organizer.swiss.tiebreak.${key}`)}
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}
