'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useId, useMemo } from 'react';

// One owner for the option list, so the two surfaces cannot offer different
// wording — or different values — for the same setting.
import {
  MATCH_FORMAT_FORM,
  matchFormatForm,
  MAX_DOUBLE_HIT_OUTCOME_OPTIONS,
  type WizardMatchFormat,
} from '../../../_shared/match-format-form';
import { LevelAtTimeEditor, levelChainsAreValid } from '../../../new/_wizard/LevelAtTimeEditor';
import { RulesFormState } from '../../../_shared/RulesFormState';
import { startAffordance } from '../../../_shared/start-affordance';
import { useTabRules } from './useTabRules';
import type { TabProps } from './tab-props';

type MatchFormat = WizardMatchFormat;

// Best-of selector options — odd values only (the engine rejects even N).
// Keys, not strings: resolved at module init these bound to the EN-only
// module-level `t`, so the selector read English whatever the organiser chose.
const BEST_OF_OPTIONS = [
  { value: '1', labelKey: 'organizer.tournaments.settings.bestOfSingle' },
  { value: '3', labelKey: 'organizer.tournaments.settings.bestOf3' },
  { value: '5', labelKey: 'organizer.tournaments.settings.bestOf5' },
  { value: '7', labelKey: 'organizer.tournaments.settings.bestOf7' },
] as const;

/**
 * The match format in force (`effectiveRules`), and a Save of only what the organiser changed
 * (operator rulings 43, 46). The "modified" badge and Reset compare with what the ruleset starts a
 * Tournament from at its pinned version (`start`, ruling 51); with no `start`, neither shows.
 */
export function MatchFormatTab({ tournamentId, readOnly, readOnlyWhy, ...props }: TabProps) {
  const { t } = useI18n();

  const bestOfOptions = useMemo(
    () => BEST_OF_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) })),
    [t],
  );
  const rules = useTabRules(tournamentId, MATCH_FORMAT_FORM, props);
  const { form: data, setForm: setData } = rules;

  const heading = (
    <>
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('organizer.tournaments.settings.matchFormat')}
      </h2>
      <p className="text-xs text-muted">{t('admin.orgTournaments.matchFormatHint')}</p>
    </>
  );
  if (!data) {
    return (
      <div className="space-y-4">
        {heading}
        <RulesFormState status={rules.status} onRetry={rules.reload} />
      </div>
    );
  }

  // Whether the ruleset HAS afterblow, driven from its grammar rather than a
  // `rulesetCode === 'TF_v1'` literal — so the afterblow-mode control survives
  // a "Customise this format" fork (code becomes custom_*, grammar unchanged).
  // Only `Generic_PointsCap` says it has no doubles ceiling.
  const grammar = rules.row?.['ruleset_grammar'] as
    { hasAfterblow?: boolean; hasMaxDoubles?: boolean } | undefined;
  const hasAfterblow = Boolean(grammar?.hasAfterblow);
  const hasMaxDoubles = grammar?.hasMaxDoubles !== false;
  const start = rules.rules?.start ? matchFormatForm(rules.rules.start) : null;
  const set = (next: Partial<MatchFormat>) => setData({ ...data, ...next });
  const setTime = (phase: 'pool' | 'bracket' | 'finals', v: number | null) =>
    set({ timeLimitsSeconds: { ...data.timeLimitsSeconds, [phase]: v } });
  const setBestOf = (phase: 'pool' | 'bracket' | 'finals', v: string) =>
    set({ bestOf: { ...data.bestOf, [phase]: Number(v) } });

  return (
    <div className="space-y-4">
      {heading}

      <NumberField
        label={t('organizer.tournaments.settings.pointCap')}
        hint={t('organizer.tournaments.settings.pointCapHelp')}
        value={data.pointCap}
        defaultValue={start?.pointCap}
        onChange={(v) => set({ pointCap: v })}
        min={1}
        max={50}
      />

      <SelectField
        label={t('organizer.tournaments.settings.timerMode')}
        hint={t('organizer.tournaments.settings.timerModeHelp')}
        value={data.timerMode}
        defaultValue={start?.timerMode}
        onChange={(v) => set({ timerMode: v as MatchFormat['timerMode'] })}
        options={[
          { value: 'countdown', label: t('organizer.tournaments.settings.timerCountdown') },
          { value: 'countup', label: t('organizer.tournaments.settings.timerCountup') },
        ]}
      />

      <NumberField
        label={t('organizer.tournaments.settings.timePool')}
        hint={t('organizer.tournaments.settings.timePoolHelp')}
        value={data.timeLimitsSeconds.pool}
        defaultValue={start?.timeLimitsSeconds.pool}
        onChange={(v) => setTime('pool', v)}
        min={0}
        max={3600}
        suffix="s"
      />
      <NumberField
        label={t('organizer.tournaments.settings.timeBracket')}
        hint={t('organizer.tournaments.settings.timeBracketHelp')}
        value={data.timeLimitsSeconds.bracket}
        defaultValue={start?.timeLimitsSeconds.bracket}
        onChange={(v) => setTime('bracket', v)}
        min={0}
        max={3600}
        suffix="s"
      />
      <NumberField
        label={t('organizer.tournaments.settings.timeFinals')}
        hint={t('organizer.tournaments.settings.timeFinalsHelp')}
        value={data.timeLimitsSeconds.finals}
        defaultValue={start?.timeLimitsSeconds.finals}
        onChange={(v) => setTime('finals', v)}
        min={0}
        max={3600}
        suffix="s"
      />

      <SelectField
        label={t('organizer.tournaments.settings.bestOfPool')}
        hint={t('organizer.tournaments.settings.bestOfHelp')}
        value={String(data.bestOf.pool)}
        defaultValue={start ? String(start.bestOf.pool) : undefined}
        onChange={(v) => setBestOf('pool', v)}
        options={bestOfOptions}
      />
      <SelectField
        label={t('organizer.tournaments.settings.bestOfBracket')}
        value={String(data.bestOf.bracket)}
        defaultValue={start ? String(start.bestOf.bracket) : undefined}
        onChange={(v) => setBestOf('bracket', v)}
        options={bestOfOptions}
      />
      <SelectField
        label={t('organizer.tournaments.settings.bestOfFinals')}
        value={String(data.bestOf.finals)}
        defaultValue={start ? String(start.bestOf.finals) : undefined}
        onChange={(v) => setBestOf('finals', v)}
        options={bestOfOptions}
      />

      <NumberField
        label={t('organizer.tournaments.settings.softClock')}
        hint={t('organizer.tournaments.settings.softClockHelp')}
        value={data.softClockLimitSeconds}
        defaultValue={start?.softClockLimitSeconds}
        onChange={(v) => set({ softClockLimitSeconds: v })}
        min={0}
        max={600}
        suffix="s"
      />

      {hasMaxDoubles && (
        <NumberField
          label={t('organizer.tournaments.settings.maxDoubleHits')}
          hint={t('organizer.tournaments.settings.maxDoubleHitsHelp')}
          value={data.maxDoubleHits}
          defaultValue={start?.maxDoubleHits}
          onChange={(v) => set({ maxDoubleHits: v })}
          min={0}
          max={20}
        />
      )}

      {hasMaxDoubles && (
        <SelectField
          label={t('organizer.tournaments.settings.maxDoubleHitOutcome')}
          hint={t('organizer.tournaments.settings.maxDoubleHitOutcomeHelp')}
          value={data.maxDoubleHitOutcome}
          defaultValue={start?.maxDoubleHitOutcome}
          onChange={(v) => set({ maxDoubleHitOutcome: v as MatchFormat['maxDoubleHitOutcome'] })}
          options={MAX_DOUBLE_HIT_OUTCOME_OPTIONS.map((o) => ({
            value: o.value,
            label: t(o.labelKey),
          }))}
        />
      )}

      <LevelAtTimeEditor
        value={data.levelAtTime}
        onChange={(levelAtTime) => set({ levelAtTime })}
        t={t}
      />

      {hasAfterblow && (
        <SelectField
          label={t('organizer.tournaments.settings.afterblowMode')}
          hint={t('organizer.tournaments.settings.afterblowModeHelp')}
          value={data.afterblowMode}
          defaultValue={start?.afterblowMode}
          onChange={(v) => set({ afterblowMode: v as MatchFormat['afterblowMode'] })}
          options={[
            { value: 'full', label: t('organizer.tournaments.settings.afterblowFull') },
            { value: 'deductive', label: t('organizer.tournaments.settings.afterblowDeductive') },
          ]}
        />
      )}

      <SelectField
        label={t('organizer.tournaments.settings.scoringDirection')}
        hint={t('organizer.tournaments.settings.scoringDirectionHelp')}
        value={data.scoringDirection}
        defaultValue={start?.scoringDirection}
        onChange={(v) => set({ scoringDirection: v as MatchFormat['scoringDirection'] })}
        options={[
          { value: 'normal', label: t('organizer.tournaments.settings.scoringNormal') },
          {
            value: 'reverse_zero_loses',
            label: t('organizer.tournaments.settings.scoringReverse'),
          },
        ]}
      />

      <button
        type="button"
        onClick={() => void rules.saveTab()}
        disabled={rules.saving || readOnly || !levelChainsAreValid(data.levelAtTime)}
        title={readOnlyWhy}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
      >
        {rules.saving ? t('common.saving') : t('organizer.tournaments.settings.save')}
      </button>
      {rules.auditDialog}
    </div>
  );
}

/**
 * A field's name, linked to its control by id, with the "modified" badge and Reset beside it
 * (`startAffordance`, outside the `<label>`). A null start value (no limit) reads as the 0 the
 * field shows for it, and Reset puts the null back.
 */
function FieldHead<T>({
  id,
  label,
  value,
  start,
  onReset,
}: {
  id: string;
  label: string;
  value: T;
  start: T | undefined;
  onReset: (v: T) => void;
}) {
  const shown = startAffordance(value, start, (s) => String(s ?? 0), onReset);
  return (
    <div className="mb-1 flex items-center gap-2 text-xs font-medium text-foreground-secondary">
      <label htmlFor={id}>{label}</label>
      {shown.badge}
      <span className="ml-auto">{shown.reset}</span>
    </div>
  );
}

/** A number; a nullable one (a time limit, the doubles ceiling) shows its null as 0. */
function NumberField<T extends number | null>({
  label,
  value,
  defaultValue,
  onChange,
  min,
  max,
  suffix,
  hint,
}: {
  label: string;
  value: T;
  /** What the ruleset starts from; Reset puts it back. None: no badge, no Reset. */
  defaultValue?: T;
  onChange: (v: T) => void;
  min: number;
  max: number;
  suffix?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <FieldHead id={id} label={label} value={value} start={defaultValue} onReset={onChange} />
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          value={value ?? 0}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value) as T)}
          className="w-32 rounded-md border border-border px-3 py-2 text-sm"
        />
        {suffix && <span className="text-xs text-muted">{suffix}</span>}
      </div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function SelectField({
  label,
  value,
  defaultValue,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  /** What the ruleset starts from; Reset puts it back. None: no badge, no Reset. */
  defaultValue?: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <FieldHead id={id} label={label} value={value} start={defaultValue} onReset={onChange} />
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border px-3 py-2 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
