'use client';

/**
 * The protest button: one tap records a protest by one Fighter, with no
 * question, as a yellow card is given at the tap. The same button on the pad
 * (in the card-chip row of each Fighter's column), on the round-break screen
 * and on the result screen. It shows the Fighter's count of protests: the
 * server's and the ones waiting on the tablet, each counted once, over the
 * Tournament's limit when it has one, in the warning colour from the limit on.
 *
 * Drawn with tokens only: unlike the card chips, a protest has no domain colour.
 */
import { HandMark, protestAtLimit, protestChipText } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';

export interface ProtestButtonProps {
  count: number;
  /** The Tournament's limit (`protestRulesOf`); null: no limit. */
  limit: number | null;
  fighterName: string;
  disabled: boolean;
  onTap: () => void;
  /** `pad`: a chip beside the card chips. `dialog`: a break screen, where the Fighter is named. */
  size: 'pad' | 'dialog';
}

export function ProtestButton({
  count,
  limit,
  fighterName,
  disabled,
  onTap,
  size,
}: ProtestButtonProps) {
  const { t } = useI18n();
  const text = protestChipText(count, limit);
  const tone = protestAtLimit(count, limit)
    ? 'bg-warning/20 text-warning border-warning'
    : 'bg-surface text-foreground-secondary border-border';
  return (
    <button
      type="button"
      data-testid="protest-chip"
      data-count={count}
      aria-label={t('scoring.lice.protestButtonLabel', { fighter: fighterName, count: text })}
      title={t('scoring.lice.protestsChipTooltip', { fighter: fighterName })}
      disabled={disabled}
      onClick={onTap}
      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-2.5 font-bold tabular-nums hover:border-warning disabled:opacity-40 ${tone} ${
        size === 'pad' ? 'text-xs' : 'text-sm'
      }`}
    >
      <HandMark className="h-4 w-4 shrink-0" />
      {size === 'dialog' && <span className="truncate font-semibold">{fighterName}</span>}
      {text}
    </button>
  );
}

export interface ProtestPairProps {
  redName: string;
  blueName: string;
  /** A Fighter's count, by corner: the server's protests and the tablet's, each once. */
  count: (corner: 'red' | 'blue') => number;
  /** The Tournament's limit (`protestRulesOf`); null: no limit. */
  limit: number | null;
  live: boolean;
  onTap: (corner: 'red' | 'blue') => void;
}

/**
 * Both Fighters' protest buttons on a break screen: the round break and the
 * result. They never offer a card: the pad takes none there.
 */
export function ProtestPair({ redName, blueName, count, limit, live, onTap }: ProtestPairProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {(['red', 'blue'] as const).map((corner) => (
        <ProtestButton
          key={corner}
          count={count(corner)}
          limit={limit}
          fighterName={corner === 'red' ? redName : blueName}
          disabled={!live}
          onTap={() => onTap(corner)}
          size="dialog"
        />
      ))}
    </div>
  );
}
