'use client';

import { useI18n } from '@myclash/next-i18n/client';
import type { ReactNode } from 'react';
import {
  FORFEIT_RULE_REASONS,
  type BlackCardEffectName,
  type ForfeitReasonRule,
  type ForfeitRuleReason,
  type ForfeitRules,
  type ForfeitRulesInForce,
} from '@myclash/types/forfeit-rules';
import type { ForfeitLeaf } from './forfeit-leaves';

/**
 * What a forfeit does, as a penalty ruleset sets it (operator rulings 63-76, 2026-10-20): per
 * reason, what the bout counts as and what happens to the Fighter; "disqualify after N" (Off or
 * 1-10); and "a forfeit before the 1st bout disqualifies". A black card forfeit's 0-X is
 * `BlackCardScoreField`, beside the card settings. Controlled: the form that holds it saves it.
 * The server checks the values (`ForfeitRulesSchema`).
 *
 * A Tournament's block (`TournamentForfeitRules`, ruling 65) passes `affordance`, the badge and
 * Reset of each field, and `withCardSelects`, the two black card settings and the 0-X: its
 * changes hold them. The penalty editor passes neither: it keeps its own card selects, which
 * write the card COLUMNS, so each target keeps one owner.
 */
interface Props<R extends ForfeitRules> {
  value: R;
  onChange: (next: R) => void;
  disabled?: boolean;
  affordance?: ForfeitAffordance;
  withCardSelects?: R extends ForfeitRulesInForce ? true : never;
  /** The line under the title: a Tournament's block says whose rules these are. */
  help?: string;
}

/** What a field shows beside it, given its path and how a value of it reads. */
export type ForfeitAffordance = (leaf: ForfeitLeaf, label: (value: unknown) => string) => ReactNode;

const OUTCOMES: ForfeitReasonRule['outcome'][] = ['keep_current', 'fixed_loss'];
const FIGHTERS: ForfeitReasonRule['fighter'][] = ['continues', 'asks', 'withdrawn', 'disqualified'];
const AFTER = ['off', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const CARD_EFFECTS: BlackCardEffectName[] = ['match', 'tournament', 'none'];

const LABEL = 'block text-xs font-semibold text-foreground-secondary';
const FIELD =
  'mt-1 w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-background';

export function ForfeitRulesFields<R extends ForfeitRules>({
  value,
  onChange,
  disabled,
  affordance,
  withCardSelects,
  help,
}: Props<R>) {
  const { t } = useI18n();
  const setRule = (reason: ForfeitRuleReason, rule: ForfeitReasonRule) =>
    onChange({ ...value, reasons: { ...value.reasons, [reason]: rule } });

  return (
    <div className="rounded-md border border-border bg-surface p-5 shadow-sm">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
        {t('admin.penaltyRulesets.forfeits.title')}
      </h3>
      <p className="mb-3 text-xs text-muted">{help ?? t('admin.penaltyRulesets.forfeits.help')}</p>
      <div className="space-y-4">
        {FORFEIT_RULE_REASONS.map((reason) => (
          <ReasonRow
            key={reason}
            reason={reason}
            rule={value.reasons[reason]}
            disabled={disabled}
            affordance={affordance}
            onChange={(rule) => setRule(reason, rule)}
          />
        ))}
      </div>
      <CountFields value={value} onChange={onChange} disabled={disabled} affordance={affordance} />
      {withCardSelects && (
        // `withCardSelects` is typed to rules that hold the two cards.
        <CardFields
          value={value as unknown as ForfeitRulesInForce}
          onChange={onChange as unknown as (next: ForfeitRulesInForce) => void}
          disabled={disabled}
          affordance={affordance}
        />
      )}
    </div>
  );
}

/**
 * One reason's rule. The opponent's score counts on a loss only, but it is stored and checked
 * whatever the outcome, so its field stays live: the page refuses what the server would.
 */
interface ReasonRowProps {
  reason: ForfeitRuleReason;
  rule: ForfeitReasonRule;
  onChange: (rule: ForfeitReasonRule) => void;
  disabled?: boolean;
  affordance?: ForfeitAffordance;
}

function ReasonRow({ reason, rule, onChange, disabled, affordance }: ReasonRowProps) {
  const { t } = useI18n();
  const outcomeOf = (outcome: string) => t(`admin.penaltyRulesets.forfeits.outcomes.${outcome}`);
  const fighterOf = (fighter: string) => t(`admin.penaltyRulesets.forfeits.fighters.${fighter}`);
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
          labelOf={outcomeOf}
          onChange={(outcome) => onChange({ ...rule, outcome })}
          disabled={disabled}
          after={affordance?.(['reasons', reason, 'outcome'], (v) => outcomeOf(String(v)))}
        />
        <ScoreField
          testId={`forfeit-${reason}-score`}
          label={t('admin.penaltyRulesets.forfeits.opponentScore')}
          value={rule.opponentScore}
          onChange={(opponentScore) => onChange({ ...rule, opponentScore })}
          disabled={disabled}
          after={affordance?.(['reasons', reason, 'opponentScore'], String)}
        />
        <ChoiceField
          testId={`forfeit-${reason}-fighter`}
          label={t('admin.penaltyRulesets.forfeits.fighter')}
          value={rule.fighter}
          options={FIGHTERS}
          labelOf={fighterOf}
          onChange={(fighter) => onChange({ ...rule, fighter })}
          disabled={disabled}
          after={affordance?.(['reasons', reason, 'fighter'], (v) => fighterOf(String(v)))}
        />
      </div>
    </fieldset>
  );
}

/**
 * A black card forfeit's 0-X (ruling 69). Part of the forfeit rules, but shown beside the two
 * black card settings, where an organiser looks for what a black card does.
 */
export function BlackCardScoreField({
  value,
  onChange,
  disabled,
  after,
}: Props<ForfeitRules> & { after?: ReactNode }) {
  const { t } = useI18n();
  return (
    <ScoreField
      testId="forfeit-black-card-score"
      label={t('admin.penaltyRulesets.forfeits.blackCardScore')}
      value={value.blackCardOpponentScore}
      onChange={(score) => onChange({ ...value, blackCardOpponentScore: score })}
      disabled={disabled}
      after={after}
    />
  );
}

/** The disqualifications every reason shares. */
function CountFields<R extends ForfeitRules>({ value, onChange, disabled, affordance }: Props<R>) {
  const { t } = useI18n();
  const afterOf = (after: string) =>
    after === 'off' ? t('admin.penaltyRulesets.forfeits.off') : after;
  const yesNo = (v: unknown) =>
    t(v ? 'common.rulesChange.value.yes' : 'common.rulesChange.value.no');
  return (
    <>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <ChoiceField
          testId="forfeit-disqualify-after"
          label={t('admin.penaltyRulesets.forfeits.disqualifyAfter')}
          value={String(value.disqualifyAfter)}
          options={AFTER}
          labelOf={afterOf}
          onChange={(after) =>
            onChange({ ...value, disqualifyAfter: after === 'off' ? 'off' : Number(after) })
          }
          disabled={disabled}
          after={affordance?.(['disqualifyAfter'], (v) => afterOf(String(v)))}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-semibold text-foreground-secondary">
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
        {affordance?.(['disqualifyBeforeFirstBout'], yesNo)}
      </div>
    </>
  );
}

/** A Tournament's black card settings and its card forfeit's 0-X (`withCardSelects`). */
function CardFields({ value, onChange, disabled, affordance }: Props<ForfeitRulesInForce>) {
  const { t } = useI18n();
  const effectOf = (effect: string) => t(`admin.penaltyRulesets.forfeitScope.${effect}`);
  const card = (key: 'firstBlackCard' | 'secondBlackCard', label: string) => (
    <ChoiceField
      testId={`forfeit-${key}`}
      label={label}
      value={value[key]}
      options={CARD_EFFECTS}
      labelOf={effectOf}
      onChange={(effect) => onChange({ ...value, [key]: effect })}
      disabled={disabled}
      after={affordance?.([key], (v) => effectOf(String(v)))}
    />
  );
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      {card('firstBlackCard', t('admin.penaltyRulesets.firstBlackCardForfeit'))}
      {card('secondBlackCard', t('admin.penaltyRulesets.secondBlackCardForfeit'))}
      <BlackCardScoreField
        value={value}
        onChange={(next) => onChange({ ...value, ...next })}
        disabled={disabled}
        after={affordance?.(['blackCardOpponentScore'], String)}
      />
    </div>
  );
}

interface FieldProps<T> {
  testId: string;
  label: string;
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  /** Beside the field, outside its `<label>`: a Tournament's badge and Reset. */
  after?: ReactNode;
}

function ChoiceField<T extends string>({
  testId,
  label,
  value,
  options,
  labelOf,
  onChange,
  disabled,
  after,
}: FieldProps<T> & { options: readonly T[]; labelOf: (option: T) => string }) {
  return (
    <div>
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
      {after && <div className="mt-1 flex items-center gap-2">{after}</div>}
    </div>
  );
}

/** A score of 1-99; the field's own min and max refuse what is out of range. */
function ScoreField({ testId, label, value, onChange, disabled, after }: FieldProps<number>) {
  return (
    <div>
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
      {after && <div className="mt-1 flex items-center gap-2">{after}</div>}
    </div>
  );
}
