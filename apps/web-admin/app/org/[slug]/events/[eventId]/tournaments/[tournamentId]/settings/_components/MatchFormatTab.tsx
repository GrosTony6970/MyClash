'use client';

import { useI18n } from '@myclash/next-i18n/client';

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
import { NumberField, SelectField, VenuesFields } from './match-format-fields';
import { useTabRules } from './useTabRules';
import type { TabProps } from './tab-props';
import { bestOfOptions } from '@/lib/best-of-options';

type MatchFormat = WizardMatchFormat;

/**
 * The match format in force (`effectiveRules`), and a Save of only what the organiser changed
 * (operator rulings 43, 46). The "modified" badge and Reset compare with what the ruleset starts a
 * Tournament from at its pinned version (`start`, ruling 51); with no `start`, neither shows.
 */
export function MatchFormatTab({ tournamentId, readOnly, readOnlyWhy, ...props }: TabProps) {
  const { t } = useI18n();

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
    { hasAfterblow?: boolean; hasMaxDoubles?: boolean; hasVenues?: boolean } | undefined;
  const hasAfterblow = Boolean(grammar?.hasAfterblow);
  const hasMaxDoubles = grammar?.hasMaxDoubles !== false;
  // Only a ruleset that says it has no venues (Points cap) hides the choice: the server forces points there.
  const hasVenues = grammar?.hasVenues !== false;
  // Venues mode counts up from nothing: no point cap, no direction (the server resolves 'normal').
  const venues = hasVenues && data.scoringUnit === 'venues';
  const start = rules.rules?.start ? matchFormatForm(rules.rules.start) : null;
  // The best-of read: a select keeps offering it after another pick (a 9 is no standard choice).
  const loaded = rules.rules?.matchFormat.bestOf;
  const set = (next: Partial<MatchFormat>) => setData({ ...data, ...next });
  const setTime = (phase: 'pool' | 'bracket' | 'finals', v: number | null) =>
    set({ timeLimitsSeconds: { ...data.timeLimitsSeconds, [phase]: v } });
  const setBestOf = (phase: 'pool' | 'bracket' | 'finals', v: string) =>
    set({ bestOf: { ...data.bestOf, [phase]: Number(v) } });

  return (
    <div className="space-y-4">
      {heading}

      {hasVenues && (
        <SelectField
          label={t('organizer.tournaments.settings.scoringUnitLabel')}
          value={data.scoringUnit}
          defaultValue={start?.scoringUnit}
          onChange={(v) => set({ scoringUnit: v as MatchFormat['scoringUnit'] })}
          options={[
            { value: 'points', label: t('organizer.tournaments.settings.scoringUnitPoints') },
            { value: 'venues', label: t('organizer.tournaments.settings.scoringUnitVenues') },
          ]}
        />
      )}

      {venues && <VenuesFields data={data} start={start} set={set} t={t} />}

      {!venues && (
        <NumberField
          label={t('organizer.tournaments.settings.pointCap')}
          hint={t('organizer.tournaments.settings.pointCapHelp')}
          value={data.pointCap}
          defaultValue={start?.pointCap}
          onChange={(v) => set({ pointCap: v })}
          min={1}
          max={50}
        />
      )}

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
        options={bestOfOptions(t, data.bestOf.pool, start?.bestOf.pool, loaded?.pool)}
      />
      <SelectField
        label={t('organizer.tournaments.settings.bestOfBracket')}
        value={String(data.bestOf.bracket)}
        defaultValue={start ? String(start.bestOf.bracket) : undefined}
        onChange={(v) => setBestOf('bracket', v)}
        options={bestOfOptions(t, data.bestOf.bracket, start?.bestOf.bracket, loaded?.bracket)}
      />
      <SelectField
        label={t('organizer.tournaments.settings.bestOfFinals')}
        value={String(data.bestOf.finals)}
        defaultValue={start ? String(start.bestOf.finals) : undefined}
        onChange={(v) => setBestOf('finals', v)}
        options={bestOfOptions(t, data.bestOf.finals, start?.bestOf.finals, loaded?.finals)}
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

      {!venues && (
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
      )}

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
