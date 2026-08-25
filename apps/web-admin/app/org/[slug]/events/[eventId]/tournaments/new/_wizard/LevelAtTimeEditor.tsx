'use client';

/**
 * The level-at-time chain editor — what the referee does when the clock runs
 * out and neither fighter leads.
 *
 * ONE component, used by both organiser surfaces (the creation wizard's Step 2
 * and the per-tournament settings tab), the way `MAX_DOUBLE_HIT_OUTCOME_OPTIONS`
 * is shared from `buildMatchFormatFromRow`. A second copy would let the two
 * offer different steps for the same setting, and the wizard is where an
 * organiser meets it first while the settings tab is where they fix it.
 *
 * Its own file rather than more lines in either surface: `Step2MatchFormat`'s
 * component function is already on the complexity ledger and `MatchFormatTab` is
 * a ledgered large file, and this is one coherent thing.
 *
 * IT BRINGS ITS OWN MARKUP. Both surfaces keep a PRIVATE copy of `SelectField` /
 * `NumberField`, so there is no shared field primitive to reach for; the classes
 * below mirror those copies rather than introducing a third styling voice. The
 * two copies are pre-existing and not this component's to merge.
 */

import type { LevelStep } from '@myclash/types';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** The three phases both organiser surfaces edit. Swiss inherits `pool`. */
export interface LevelAtTimeChains {
  pool: LevelStep[];
  bracket: LevelStep[];
  finals: LevelStep[];
}

export type LevelPhaseKey = keyof LevelAtTimeChains;

/**
 * The step kinds, as KEYS rather than resolved strings — resolved at module
 * init they would bind to the EN-only module-level `t` and the selector would
 * read English whatever the organiser chose. The caller's hook-provided `t`
 * maps them.
 */
export const LEVEL_STEP_OPTIONS = [
  { value: 'draw', labelKey: 'organizer.tournaments.settings.levelStepDraw' },
  { value: 'sudden_death', labelKey: 'organizer.tournaments.settings.levelStepSuddenDeath' },
  { value: 'extra_time', labelKey: 'organizer.tournaments.settings.levelStepExtraTime' },
] as const;

const PHASE_LABEL_KEYS: Array<{ key: LevelPhaseKey; labelKey: string }> = [
  { key: 'pool', labelKey: 'organizer.tournaments.settings.levelAtTimePool' },
  { key: 'bracket', labelKey: 'organizer.tournaments.settings.levelAtTimeBracket' },
  { key: 'finals', labelKey: 'organizer.tournaments.settings.levelAtTimeFinals' },
];

/** The default a newly added step starts as — terminal, so a chain stays valid. */
const NEW_STEP: LevelStep = { kind: 'sudden_death' };

/**
 * Does this chain end on a terminal step?
 *
 * The API refuses one that does not, and so does the engine's schema. Shown
 * here as well because a chain ending in extra time can come back level for
 * ever, and an organiser who has just built one deserves to be told before the
 * save rather than by a 400 that names a field they cannot see.
 */
export function chainIsValid(steps: LevelStep[]): boolean {
  return steps.length > 0 && steps[steps.length - 1]?.kind !== 'extra_time';
}

export function levelChainsAreValid(chains: LevelAtTimeChains): boolean {
  return PHASE_LABEL_KEYS.every(({ key }) => chainIsValid(chains[key]));
}

export function LevelAtTimeEditor({
  value,
  onChange,
  t,
}: {
  value: LevelAtTimeChains;
  onChange: (next: LevelAtTimeChains) => void;
  t: Translate;
}) {
  const setPhase = (key: LevelPhaseKey, steps: LevelStep[]) => onChange({ ...value, [key]: steps });

  return (
    <section className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-foreground">
        {t('organizer.tournaments.settings.levelAtTime')}
      </h3>
      <p className="mt-1 text-xs text-muted">
        {t('organizer.tournaments.settings.levelAtTimeHelp')}
      </p>

      <div className="mt-4 space-y-4">
        {PHASE_LABEL_KEYS.map(({ key, labelKey }) => (
          <PhaseChain
            key={key}
            label={t(labelKey)}
            steps={value[key]}
            onChange={(steps) => setPhase(key, steps)}
            t={t}
          />
        ))}
      </div>
    </section>
  );
}

interface PhaseChainProps {
  label: string;
  steps: LevelStep[];
  onChange: (steps: LevelStep[]) => void;
  t: Translate;
}

function PhaseChain({ label, steps, onChange, t }: PhaseChainProps) {
  const replace = (index: number, step: LevelStep) =>
    onChange(steps.map((s, i) => (i === index ? step : s)));
  const move = (index: number, by: number) => {
    const next = [...steps];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(index + by, 0, moved);
    onChange(next);
  };

  return (
    <div>
      <span className="block text-xs font-medium text-foreground-secondary mb-1">{label}</span>
      <ol className="space-y-2">
        {steps.map((step, index) => (
          <StepRow
            key={index}
            phaseLabel={label}
            step={step}
            index={index}
            total={steps.length}
            onReplace={(next) => replace(index, next)}
            onMove={(by) => move(index, by)}
            onRemove={() => onChange(steps.filter((_, i) => i !== index))}
            t={t}
          />
        ))}
      </ol>

      <button
        type="button"
        onClick={() => onChange([...steps, NEW_STEP])}
        className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground-secondary hover:bg-background"
      >
        + {t('organizer.tournaments.settings.levelAddStep')}
      </button>

      {!chainIsValid(steps) && (
        <p className="mt-2 text-xs text-danger">
          {t('organizer.tournaments.settings.levelLastStepMustBeTerminal')}
        </p>
      )}
      {chainIsValid(steps) && <p className="mt-1 text-xs text-muted">{hintFor(steps, t)}</p>}
    </div>
  );
}

/** One step of one phase's chain: what it is, how long, and where it sits. */
interface StepRowProps {
  phaseLabel: string;
  step: LevelStep;
  index: number;
  /** How many steps the chain holds — the last one cannot move down, and a
   *  chain of one cannot lose its only step. */
  total: number;
  onReplace: (step: LevelStep) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
  t: Translate;
}

function StepRow({ phaseLabel, step, index, total, onReplace, onMove, onRemove, t }: StepRowProps) {
  const secondsLabel = t('organizer.tournaments.settings.levelStepSeconds');
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="w-5 text-xs text-muted">{index + 1}.</span>
      <select
        value={step.kind}
        aria-label={phaseLabel}
        onChange={(e) => onReplace(stepOfKind(e.target.value, step))}
        className="rounded-md border border-border px-3 py-2 text-sm"
      >
        {LEVEL_STEP_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.labelKey)}
          </option>
        ))}
      </select>
      {step.kind === 'extra_time' && (
        <>
          <input
            type="number"
            min={1}
            max={3600}
            value={step.seconds}
            aria-label={secondsLabel}
            onChange={(e) => onReplace({ kind: 'extra_time', seconds: Number(e.target.value) })}
            className="w-24 rounded-md border border-border px-3 py-2 text-sm"
          />
          <span className="text-xs text-muted">{secondsLabel}</span>
        </>
      )}
      <div className="ml-auto flex items-center gap-1">
        <RowButton
          label={t('organizer.tournaments.settings.levelMoveStepUp')}
          glyph="↑"
          disabled={index === 0}
          onClick={() => onMove(-1)}
        />
        <RowButton
          label={t('organizer.tournaments.settings.levelMoveStepDown')}
          glyph="↓"
          disabled={index === total - 1}
          onClick={() => onMove(1)}
        />
        <RowButton
          label={t('organizer.tournaments.settings.levelRemoveStep')}
          glyph="✕"
          // A chain needs at least one step: an empty one has no terminal step
          // to reach, which is the same bout-with-no-exit the terminal rule
          // exists to stop.
          disabled={total === 1}
          onClick={onRemove}
        />
      </div>
    </li>
  );
}

interface RowButtonProps {
  label: string;
  glyph: string;
  disabled: boolean;
  onClick: () => void;
}

function RowButton({ label, glyph, disabled, onClick }: RowButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-border px-2 py-1 text-xs text-foreground-secondary hover:bg-background disabled:opacity-40"
    >
      {glyph}
    </button>
  );
}

/**
 * Changing the KIND keeps the seconds the organiser already typed, so flipping
 * a step to a draw and back does not silently reset it to 60.
 */
function stepOfKind(kind: string, previous: LevelStep): LevelStep {
  if (kind === 'extra_time') {
    return { kind: 'extra_time', seconds: previous.kind === 'extra_time' ? previous.seconds : 60 };
  }
  return kind === 'draw' ? { kind: 'draw' } : { kind: 'sudden_death' };
}

/** What the chain's LAST step means, in a sentence, under the phase. */
function hintFor(steps: LevelStep[], t: Translate): string {
  const last = steps[steps.length - 1];
  return last?.kind === 'draw'
    ? t('organizer.tournaments.settings.levelStepDrawHint')
    : t('organizer.tournaments.settings.levelStepSuddenDeathHint');
}
