'use client';

import { useI18n, type Translator } from '@myclash/next-i18n/client';
import { bestOfOptions } from '@/lib/best-of-options';
import { CheckField, NumberField, SelectField } from './RulesetFormFields';
import {
  acceptsLeaf,
  differsFromEngine,
  engineLeaf,
  shownLeaf,
  withOwn,
  withoutOwn,
  type BestOfLeaf,
  type LeafValue,
  type MatchFormatLeaf,
  type OwnMatchFormat,
} from './ruleset-own-values';

interface Props {
  own: OwnMatchFormat;
  /** What the ruleset stored when the form opened: a best-of select keeps offering its value. */
  loaded: OwnMatchFormat;
  onChange: (own: OwnMatchFormat) => void;
  /** Called with a field's key and whether its typed value can be saved. */
  onValidity: (leaf: MatchFormatLeaf, valid: boolean) => void;
  /** False for an engine with no doubles ceiling (Points cap): the field is not shown. */
  hasMaxDoubles: boolean;
  /** False for an engine that scores in points only (Points cap): no unit choice, no venue fields. */
  hasVenues: boolean;
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

/** A phase's won-venues count: 1 to 50. */
const VENUES = { min: 1, max: 50 };

/** What every field of the box shares: its badge, its Reset and its edit. */
function affordanceOf({ own, onChange, disabled }: Props, leaf: MatchFormatLeaf) {
  return {
    modified: differsFromEngine(own, leaf),
    onReset: () => onChange(withoutOwn(own, leaf)),
    onChange: (v: LeafValue) => onChange(withOwn(own, leaf, v)),
    disabled,
  };
}

/** The box's kinds of field, each wired to one leaf of the ruleset's own match format. */
function leafFields(props: Props, t: Translator) {
  const { own, loaded, onChange, onValidity } = props;
  const affordance = (leaf: MatchFormatLeaf) => affordanceOf(props, leaf);
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
  // The select answers a string; the engine takes a number ("3" would be stored and refused).
  const bestOf = (leaf: BestOfLeaf, label: string) => {
    const shown = shownLeaf(own, leaf) as number;
    const options = bestOfOptions(t, shown, shownLeaf(loaded, leaf) as number);
    return (
      <SelectField
        {...affordance(leaf)}
        onChange={(v) => onChange(withOwn(own, leaf, Number(v)))}
        label={label}
        value={String(shown)}
        engineLabel={options.find((o) => o.value === String(engineLeaf(leaf)))?.label}
        options={options}
      />
    );
  };
  const check = (leaf: MatchFormatLeaf, label: string, hint: string) => (
    <CheckField
      {...affordance(leaf)}
      label={label}
      hint={hint}
      checked={shownLeaf(own, leaf) as boolean}
      engineLabel={t(engineLeaf(leaf) ? 'admin.common.yes' : 'admin.common.no')}
    />
  );
  return { number, select, bestOf, check };
}

/** The "Score by" choice, and in venues mode the won venues per phase and the stop flag. */
function venueFields(
  { number, select, check }: ReturnType<typeof leafFields>,
  venues: boolean,
  t: Translator,
) {
  return (
    <>
      {select('scoringUnit', t('organizer.tournaments.settings.scoringUnitLabel'), {
        points: t('organizer.tournaments.settings.scoringUnitPoints'),
        venues: t('organizer.tournaments.settings.scoringUnitVenues'),
      })}
      {venues && (
        <>
          {number('venuesPerRoundPool', {
            label: t('organizer.tournaments.settings.venuesPerRoundPool'),
            ...VENUES,
          })}
          {number('venuesPerRoundBracket', {
            label: t('organizer.tournaments.settings.venuesPerRoundBracket'),
            ...VENUES,
          })}
          {number('venuesPerRoundFinals', {
            label: t('organizer.tournaments.settings.venuesPerRoundFinals'),
            ...VENUES,
          })}
          {check(
            'stopWhenDecided',
            t('organizer.tournaments.settings.stopWhenDecidedLabel'),
            t('organizer.tournaments.settings.stopWhenDecidedHelp'),
          )}
        </>
      )}
    </>
  );
}

/**
 * The "Match format defaults" box of the ruleset editor. Every field shows the value a new
 * Tournament on this ruleset starts from: the ruleset's own, else the engine's (operator ruling
 * 59). An edit stores only that field; Reset, or the engine's value typed back, empties it.
 */
export function RulesetMatchFormatBox(props: Props) {
  const { t } = useI18n();
  const fields = leafFields(props, t);
  const { number, select, bestOf } = fields;
  // Venues mode counts up from nothing: no point cap, no direction (the server forces 'normal').
  const venues = props.hasVenues && shownLeaf(props.own, 'scoringUnit') === 'venues';

  return (
    <div className="rounded-md border border-border bg-surface p-5 shadow-sm">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
        {t('admin.srcComponents.matchFormatDefaultsTitle')}
      </h3>
      <p className="mb-3 text-xs text-muted">{t('admin.srcComponents.matchFormatDefaultsHelp')}</p>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {props.hasVenues && venueFields(fields, venues, t)}
        {!venues &&
          number('pointCap', { label: t('admin.srcComponents.pointCapLabel'), min: 1, max: 50 })}
        {select('timerMode', t('admin.srcComponents.timerModeLabel'), {
          countdown: t('admin.srcComponents.timerModeCountdown'),
          countup: t('admin.srcComponents.timerModeCountup'),
        })}
        {!venues &&
          select('scoringDirection', t('admin.srcComponents.scoringDirectionLabel'), {
            normal: t('admin.srcComponents.scoringDirectionNormal'),
            reverse_zero_loses: t('admin.srcComponents.scoringDirectionReverse'),
          })}
        {number('pool', { label: t('admin.srcComponents.timeLimitPoolLabel'), ...TIME })}
        {number('bracket', { label: t('admin.srcComponents.timeLimitBracketLabel'), ...TIME })}
        {number('finals', { label: t('admin.srcComponents.timeLimitFinalsLabel'), ...TIME })}
        {bestOf('bestOfPool', t('organizer.tournaments.settings.bestOfPool'))}
        {bestOf('bestOfBracket', t('organizer.tournaments.settings.bestOfBracket'))}
        {bestOf('bestOfFinals', t('organizer.tournaments.settings.bestOfFinals'))}
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
