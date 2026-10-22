'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { NumberField, SelectField } from './RulesetFormFields';
import {
  acceptsLeaf,
  differsFromEngine,
  engineLeaf,
  shownLeaf,
  withOwn,
  withoutOwn,
  type MatchFormatLeaf,
  type OwnMatchFormat,
} from './ruleset-own-values';

interface Props {
  own: OwnMatchFormat;
  onChange: (own: OwnMatchFormat) => void;
  /** Called with a field's key and whether its typed value can be saved. */
  onValidity: (leaf: MatchFormatLeaf, valid: boolean) => void;
  /** False for an engine with no doubles ceiling (Points cap): the field is not shown. */
  hasMaxDoubles: boolean;
  disabled?: boolean;
}

interface NumberSpec {
  label: string;
  min: number;
  max: number;
  /** A time limit or the doubles ceiling: 0 means "none". */
  nullable?: boolean;
}

const TIME = { min: 0, max: 3600, nullable: true };

/** The box's two kinds of field, each wired to one leaf of the ruleset's own match format. */
function leafFields({ own, onChange, onValidity, disabled }: Props) {
  const affordance = (leaf: MatchFormatLeaf) => ({
    modified: differsFromEngine(own, leaf),
    onReset: () => onChange(withoutOwn(own, leaf)),
    onChange: (v: number | string | null) => onChange(withOwn(own, leaf, v)),
    disabled,
  });
  const number = (leaf: MatchFormatLeaf, spec: NumberSpec) => (
    <NumberField
      {...spec}
      {...affordance(leaf)}
      value={shownLeaf(own, leaf) as number | null}
      engineLabel={String(engineLeaf(leaf) ?? 0)}
      onValidity={(valid) => onValidity(leaf, valid)}
      accepts={(v) => acceptsLeaf(leaf, v)}
    />
  );
  const select = (leaf: MatchFormatLeaf, label: string, options: Record<string, string>) => (
    <SelectField
      {...affordance(leaf)}
      label={label}
      value={shownLeaf(own, leaf) as string}
      engineLabel={options[engineLeaf(leaf) as string]}
      options={Object.entries(options).map(([value, text]) => ({ value, label: text }))}
    />
  );
  return { number, select };
}

/**
 * The "Match format defaults" box of the ruleset editor. Every field shows the value a new
 * Tournament on this ruleset starts from: the ruleset's own, else the engine's (operator ruling
 * 59). An edit stores only that field; Reset, or the engine's value typed back, empties it.
 */
export function RulesetMatchFormatBox(props: Props) {
  const { t } = useI18n();
  const { number, select } = leafFields(props);

  return (
    <div className="rounded-md border border-border bg-surface p-5 shadow-sm">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
        {t('admin.srcComponents.matchFormatDefaultsTitle')}
      </h3>
      <p className="mb-3 text-xs text-muted">{t('admin.srcComponents.matchFormatDefaultsHelp')}</p>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {number('pointCap', { label: t('admin.srcComponents.pointCapLabel'), min: 1, max: 50 })}
        {select('timerMode', t('admin.srcComponents.timerModeLabel'), {
          countdown: t('admin.srcComponents.timerModeCountdown'),
          countup: t('admin.srcComponents.timerModeCountup'),
        })}
        {select('scoringDirection', t('admin.srcComponents.scoringDirectionLabel'), {
          normal: t('admin.srcComponents.scoringDirectionNormal'),
          reverse_zero_loses: t('admin.srcComponents.scoringDirectionReverse'),
        })}
        {number('pool', { label: t('admin.srcComponents.timeLimitPoolLabel'), ...TIME })}
        {number('bracket', { label: t('admin.srcComponents.timeLimitBracketLabel'), ...TIME })}
        {number('finals', { label: t('admin.srcComponents.timeLimitFinalsLabel'), ...TIME })}
        {number('softClockLimitSeconds', {
          label: t('admin.srcComponents.softClockLabel'),
          min: 0,
          max: 600,
        })}
        {props.hasMaxDoubles &&
          number('maxDoubleHits', {
            label: t('admin.srcComponents.maxDoubleHitsLabel'),
            min: 0,
            max: 20,
            nullable: true,
          })}
      </div>
    </div>
  );
}
