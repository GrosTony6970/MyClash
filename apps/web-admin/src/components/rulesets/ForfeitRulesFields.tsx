'use client';

import { useI18n } from '@myclash/next-i18n/client';
import {
  FORFEIT_RULE_REASONS,
  type ForfeitReasonRule,
  type ForfeitRuleReason,
  type ForfeitRules,
} from '@myclash/types/forfeit-rules';

/**
 * What a forfeit does, as a penalty ruleset sets it (operator rulings 63-76, 2026-10-20): per
 * reason, what the bout counts as and what happens to the Fighter; "disqualify after N" (Off or
 * 1-10); and "a forfeit before the 1st bout disqualifies". A black card forfeit's 0-X is
 * `BlackCardScoreField`, beside the card settings. Controlled: the form that holds it saves it.
 * The server checks the values (`ForfeitRulesSchema`).
 */
interface Props {
  value: ForfeitRules;
  onChange: (next: ForfeitRules) => void;
  disabled?: boolean;
}

const OUTCOMES: ForfeitReasonRule['outcome'][] = ['keep_current', 'fixed_loss'];
const FIGHTERS: ForfeitReasonRule['fighter'][] = ['continues', 'asks', 'withdrawn', 'disqualified'];
const AFTER = ['off', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

const LABEL = 'block text-xs font-semibold text-foreground-secondary';
const FIELD =
  'mt-1 w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-background';

export function ForfeitRulesFields({ value, onChange, disabled }: Props) {
  const { t } = useI18n();
  const setRule = (reason: ForfeitRuleReason, rule: ForfeitReasonRule) =>
    onChange({ ...value, reasons: { ...value.reasons, [reason]: rule } });

  return (
    <div className="rounded-md border border-border bg-surface p-5 shadow-sm">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
        {t('admin.penaltyRulesets.forfeits.title')}
      </h3>
      <p className="mb-3 text-xs text-muted">{t('admin.penaltyRulesets.forfeits.help')}</p>
      <div className="space-y-4">
        {FORFEIT_RULE_REASONS.map((reason) => (
          <ReasonRow
            key={reason}
            reason={reason}
            rule={value.reasons[reason]}
            disabled={disabled}
            onChange={(rule) => setRule(reason, rule)}
          />
        ))}
      </div>
      <CountFields value={value} onChange={onChange} disabled={disabled} />
    </div>
  );
}

/**
 * One reason's rule. The opponent's score counts on a loss only, but it is stored and checked
 * whatever the outcome, so its field stays live: the page refuses what the server would.
 */
function ReasonRow({
  reason,
  rule,
  onChange,
  disabled,
}: {
  reason: ForfeitRuleReason;
  rule: ForfeitReasonRule;
  onChange: (rule: ForfeitReasonRule) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-foreground">
        {t(`admin.penaltyRulesets.forfeits.reason.${reason}`)}
      </legend>
      <div className="mt-1 grid gap-3 md:grid-cols-3">
        <ChoiceField
          testId={`forfeit-${reason}-outcome`}
          label={t('admin.penaltyRulesets.forfeits.outcome')}
          value={rule.outcome}
          options={OUTCOMES}
          labelOf={(outcome) => t(`admin.penaltyRulesets.forfeits.outcomes.${outcome}`)}
          onChange={(outcome) => onChange({ ...rule, outcome })}
          disabled={disabled}
        />
        <ScoreField
          testId={`forfeit-${reason}-score`}
          label={t('admin.penaltyRulesets.forfeits.opponentScore')}
          value={rule.opponentScore}
          onChange={(opponentScore) => onChange({ ...rule, opponentScore })}
          disabled={disabled}
        />
        <ChoiceField
          testId={`forfeit-${reason}-fighter`}
          label={t('admin.penaltyRulesets.forfeits.fighter')}
          value={rule.fighter}
          options={FIGHTERS}
          labelOf={(fighter) => t(`admin.penaltyRulesets.forfeits.fighters.${fighter}`)}
          onChange={(fighter) => onChange({ ...rule, fighter })}
          disabled={disabled}
        />
      </div>
    </fieldset>
  );
}

/**
 * A black card forfeit's 0-X (ruling 69). Part of the forfeit rules, but shown beside the two
 * black card settings, where an organiser looks for what a black card does.
 */
export function BlackCardScoreField({ value, onChange, disabled }: Props) {
  const { t } = useI18n();
  return (
    <ScoreField
      testId="forfeit-black-card-score"
      label={t('admin.penaltyRulesets.forfeits.blackCardScore')}
      value={value.blackCardOpponentScore}
      onChange={(score) => onChange({ ...value, blackCardOpponentScore: score })}
      disabled={disabled}
    />
  );
}

/** The disqualifications every reason shares. */
function CountFields({ value, onChange, disabled }: Props) {
  const { t } = useI18n();
  return (
    <>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <ChoiceField
          testId="forfeit-disqualify-after"
          label={t('admin.penaltyRulesets.forfeits.disqualifyAfter')}
          value={String(value.disqualifyAfter)}
          options={AFTER}
          labelOf={(after) => (after === 'off' ? t('admin.penaltyRulesets.forfeits.off') : after)}
          onChange={(after) =>
            onChange({ ...value, disqualifyAfter: after === 'off' ? 'off' : Number(after) })
          }
          disabled={disabled}
        />
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-foreground-secondary">
        <input
          data-testid="forfeit-before-first-bout"
          type="checkbox"
          checked={value.disqualifyBeforeFirstBout}
          onChange={(e) => onChange({ ...value, disqualifyBeforeFirstBout: e.target.checked })}
          disabled={disabled}
          className="h-4 w-4 cursor-pointer rounded border-border text-accent focus:ring-2 focus:ring-accent/30"
        />
        {t('admin.penaltyRulesets.forfeits.beforeFirstBout')}
      </label>
    </>
  );
}

interface FieldProps<T> {
  testId: string;
  label: string;
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
}

function ChoiceField<T extends string>({
  testId,
  label,
  value,
  options,
  labelOf,
  onChange,
  disabled,
}: FieldProps<T> & { options: readonly T[]; labelOf: (option: T) => string }) {
  return (
    <label className={LABEL}>
      {label}
      <select
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        disabled={disabled}
        className={FIELD}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labelOf(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A score of 1-99; the field's own min and max refuse what is out of range. */
function ScoreField({ testId, label, value, onChange, disabled }: FieldProps<number>) {
  return (
    <label className={LABEL}>
      {label}
      <input
        data-testid={testId}
        type="number"
        min={1}
        max={99}
        step={1}
        required
        value={value}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10) || 0)}
        disabled={disabled}
        className={`${FIELD} font-mono`}
      />
    </label>
  );
}
