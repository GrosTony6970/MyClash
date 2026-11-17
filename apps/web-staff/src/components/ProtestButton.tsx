'use client';

/**
 * The protest button: one tap records a protest by one Fighter, with no
 * question, as a yellow card is given at the tap. The same button on the pad
 * (in the card-chip row of each Fighter's column), on the round-break screen
 * and on the result screen. It shows the Fighter's count of protests: the
 * server's and the ones waiting on the tablet, each counted once.
 *
 * Drawn with tokens only: unlike the card chips, a protest has no domain colour.
 */
import { HandMark } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';

export interface ProtestButtonProps {
  count: number;
  fighterName: string;
  disabled: boolean;
  onTap: () => void;
  /** `pad`: a chip beside the card chips. `dialog`: a break screen, where the Fighter is named. */
  size: 'pad' | 'dialog';
}

export function ProtestButton({ count, fighterName, disabled, onTap, size }: ProtestButtonProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      data-testid="protest-chip"
      data-count={count}
      aria-label={t('scoring.lice.protestButtonLabel', {
        fighter: fighterName,
        count: String(count),
      })}
      title={t('scoring.lice.protestsChipTooltip', { fighter: fighterName })}
      disabled={disabled}
      onClick={onTap}
      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-surface text-foreground-secondary border border-border px-2.5 font-bold tabular-nums hover:border-warning disabled:opacity-40 ${
        size === 'pad' ? 'text-xs' : 'text-sm'
      }`}
    >
      <HandMark className="h-4 w-4 shrink-0" />
      {size === 'dialog' && <span className="truncate font-semibold">{fighterName}</span>}
      {count}
    </button>
  );
}

export interface ProtestPairProps {
  redName: string;
  blueName: string;
  /** A Fighter's count, by corner: the server's protests and the tablet's, each once. */
  count: (corner: 'red' | 'blue') => number;
  live: boolean;
  onTap: (corner: 'red' | 'blue') => void;
}

/** Both Fighters' protest buttons on a break screen: the round break and the result. */
export function ProtestPair({ redName, blueName, count, live, onTap }: ProtestPairProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {(['red', 'blue'] as const).map((corner) => (
        <ProtestButton
          key={corner}
          count={count(corner)}
          fighterName={corner === 'red' ? redName : blueName}
          disabled={!live}
          onTap={() => onTap(corner)}
          size="dialog"
        />
      ))}
    </div>
  );
}
