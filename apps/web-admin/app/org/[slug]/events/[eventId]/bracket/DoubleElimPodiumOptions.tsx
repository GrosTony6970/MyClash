'use client';

import { HelpTooltip } from '@myclash/ui';

type Translator = (key: string, values?: Record<string, string | number>) => string;

/**
 * The double-elimination podium options: who the losers bracket plays for, and
 * how far down the winners bracket a second chance reaches.
 *
 * Options are DISABLED rather than hidden when they don't apply. The three
 * settings only make sense in relation to each other — a grand-final reset is
 * meaningless without a grand final, a bronze match is meaningless when third
 * place is already the losers-bracket final's loser — and an organiser who
 * never sees the inapplicable option can't learn why. The API rejects those
 * combinations outright, so the disabled state is the UI telling the same
 * story rather than a second, softer rule.
 *
 * Extracted from the bracket page so both the generate form and the
 * post-generation config card render exactly the same controls.
 */

export type SecondChanceTarget = 'gold' | 'bronze';
export type RepechageEntrySize = 8 | 16 | 32 | null;

export interface PodiumOptionsValue {
  secondChanceTarget: SecondChanceTarget;
  grandFinalReset: boolean;
  bronzeMatch: boolean;
  repechageEntrySize: RepechageEntrySize;
}

interface Props {
  value: PodiumOptionsValue;
  onChange: (next: PodiumOptionsValue) => void;
  t: Translator;
  /**
   * Post-generation: the podium model and the cutoff decide which slots exist,
   * so they cannot be changed without rebuilding the bracket. Locked here and
   * refused by the API, with a hint pointing at Regenerate.
   */
  structuralLocked?: boolean;
}

const ENTRY_SIZES: RepechageEntrySize[] = [null, 32, 16, 8];

/**
 * The request body for these options — only the fields that APPLY in the
 * chosen mode. The API rejects a grand-final reset in bronze mode and a bronze
 * match in gold mode rather than ignoring them, so sending the full struct
 * would 400 on every submit.
 */
export function podiumPayload(value: PodiumOptionsValue): Record<string, unknown> {
  return {
    secondChanceTarget: value.secondChanceTarget,
    repechageEntrySize: value.repechageEntrySize,
    ...(value.secondChanceTarget === 'bronze'
      ? { bronzeMatch: value.bronzeMatch }
      : { grandFinalReset: value.grandFinalReset }),
  };
}

/** Read the podium model back off a generated bracket's config. */
export function podiumFromBracket(bracket: {
  secondChanceTarget?: string | null;
  grandFinalReset?: boolean | null;
  bronzeMatch?: boolean | null;
  repechageEntrySize?: number | null;
}): PodiumOptionsValue {
  return {
    secondChanceTarget: bracket.secondChanceTarget === 'bronze' ? 'bronze' : 'gold',
    grandFinalReset: bracket.grandFinalReset === true,
    bronzeMatch: bracket.bronzeMatch !== false,
    repechageEntrySize: (bracket.repechageEntrySize ?? null) as RepechageEntrySize,
  };
}

const fieldClass =
  'border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 ring-accent disabled:opacity-50 disabled:cursor-not-allowed';

function OptionCheckbox({
  checked,
  disabled,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  hint: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-sm ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
      title={disabled ? hint : undefined}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded"
      />
      <span className="text-foreground-secondary">{label}</span>
      <HelpTooltip text={hint} />
    </label>
  );
}

/** Label + help tooltip above a select, matching the rest of the bracket form. */
function FieldLabel({ label, help }: { label: string; help: string }) {
  return (
    <label className="mb-1 flex items-center text-xs font-medium text-foreground-secondary">
      {label}
      <HelpTooltip text={help} />
    </label>
  );
}

/** Does the losers bracket play for gold or for bronze? */
function SecondChanceSelect({ value, onChange, t, structuralLocked }: Props) {
  return (
    <div>
      <FieldLabel
        label={t('organizer.bracketPage.secondChanceLabel')}
        help={t('organizer.bracketPage.secondChanceHelp')}
      />
      <select
        value={value.secondChanceTarget}
        disabled={structuralLocked}
        onChange={(e) =>
          onChange({ ...value, secondChanceTarget: e.target.value as SecondChanceTarget })
        }
        className={fieldClass}
        title={structuralLocked ? t('organizer.bracketPage.structuralLockedHint') : undefined}
      >
        <option value="gold">{t('organizer.bracketPage.secondChanceGold')}</option>
        <option value="bronze">{t('organizer.bracketPage.secondChanceBronze')}</option>
      </select>
    </div>
  );
}

/** How deep a winners-bracket defeat still earns a second chance. */
function RepechageEntrySelect({ value, onChange, t, structuralLocked }: Props) {
  return (
    <div>
      <FieldLabel
        label={t('organizer.bracketPage.repechageEntryLabel')}
        help={t('organizer.bracketPage.repechageEntryHelp')}
      />
      <select
        value={value.repechageEntrySize === null ? '' : String(value.repechageEntrySize)}
        disabled={structuralLocked}
        onChange={(e) =>
          onChange({
            ...value,
            repechageEntrySize:
              e.target.value === '' ? null : (Number(e.target.value) as RepechageEntrySize),
          })
        }
        className={fieldClass}
        title={structuralLocked ? t('organizer.bracketPage.structuralLockedHint') : undefined}
      >
        {ENTRY_SIZES.map((size) => (
          <option key={size ?? 'all'} value={size === null ? '' : String(size)}>
            {size === null
              ? t('organizer.bracketPage.repechageEntryAll')
              : t('organizer.bracketPage.repechageEntryLastN', { n: size })}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The plain-language consequences of the current selection. */
function PodiumNotes({ value, t, structuralLocked }: Omit<Props, 'onChange'>) {
  const isBronze = value.secondChanceTarget === 'bronze';
  const notes = [
    isBronze
      ? t('organizer.bracketPage.secondChanceBronzeNote')
      : t('organizer.bracketPage.secondChanceGoldNote'),
    isBronze && !value.bronzeMatch ? t('organizer.bracketPage.bronzeMatchOffNote') : null,
    value.repechageEntrySize !== null
      ? t('organizer.bracketPage.repechageEntryNote', { n: value.repechageEntrySize })
      : null,
    structuralLocked ? t('organizer.bracketPage.structuralLockedHint') : null,
  ].filter((note): note is string => note !== null);

  return (
    <>
      {notes.map((note) => (
        <p key={note} className="max-w-3xl text-xs text-muted">
          {note}
        </p>
      ))}
    </>
  );
}

export function DoubleElimPodiumOptions(props: Props) {
  const { value, onChange, t, structuralLocked } = props;
  const isBronze = value.secondChanceTarget === 'bronze';
  const set = (patch: Partial<PodiumOptionsValue>) => onChange({ ...value, ...patch });

  return (
    <div className="flex w-full flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-end gap-6">
        <SecondChanceSelect {...props} />
        <RepechageEntrySelect {...props} />

        {/* Both checkboxes stay VISIBLE in either mode — exactly one is ever
            active, which is what makes the gold/bronze distinction legible. */}
        <OptionCheckbox
          checked={!isBronze && value.grandFinalReset}
          disabled={isBronze}
          label={t('organizer.bracketPage.grandFinalReset')}
          hint={
            isBronze
              ? t('organizer.bracketPage.grandFinalResetNotApplicable')
              : t('organizer.bracketPage.grandFinalResetHelp')
          }
          onChange={(next) => set({ grandFinalReset: next })}
        />

        <OptionCheckbox
          checked={isBronze && value.bronzeMatch}
          disabled={!isBronze || structuralLocked === true}
          label={t('organizer.bracketPage.bronzeMatchLabel')}
          hint={
            !isBronze
              ? t('organizer.bracketPage.bronzeMatchNotApplicable')
              : structuralLocked
                ? t('organizer.bracketPage.structuralLockedHint')
                : t('organizer.bracketPage.bronzeMatchHelp')
          }
          onChange={(next) => set({ bronzeMatch: next })}
        />
      </div>

      <PodiumNotes value={value} t={t} structuralLocked={structuralLocked} />
    </div>
  );
}
