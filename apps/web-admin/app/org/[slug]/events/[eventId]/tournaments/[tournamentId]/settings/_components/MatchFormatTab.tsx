'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useEffect, useMemo, useState } from 'react';

import { useToast } from '@myclash/ui';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

interface MatchFormat {
  pointCap: number;
  timerMode: 'countdown' | 'countup';
  timeLimitsSeconds: { pool: number | null; bracket: number | null; finals: number | null };
  softClockLimitSeconds: number;
  maxDoubleHits: number | null;
  afterblowMode: 'full' | 'deductive';
  scoringDirection: 'normal' | 'reverse_zero_loses';
  bestOf: { pool: number; bracket: number; finals: number };
}

const DEFAULTS: MatchFormat = {
  pointCap: 5,
  timerMode: 'countdown',
  timeLimitsSeconds: { pool: 180, bracket: 240, finals: 300 },
  softClockLimitSeconds: 60,
  maxDoubleHits: 3,
  afterblowMode: 'full',
  scoringDirection: 'normal',
  bestOf: { pool: 1, bracket: 1, finals: 1 },
};

// Best-of selector options — odd values only (the engine rejects even N).
// Keys, not strings: resolved at module init these bound to the EN-only
// module-level `t`, so the selector read English whatever the organiser chose.
const BEST_OF_OPTIONS = [
  { value: '1', labelKey: 'organizer.tournaments.settings.bestOfSingle' },
  { value: '3', labelKey: 'organizer.tournaments.settings.bestOf3' },
  { value: '5', labelKey: 'organizer.tournaments.settings.bestOf5' },
  { value: '7', labelKey: 'organizer.tournaments.settings.bestOf7' },
] as const;

export function MatchFormatTab({ tournamentId }: { tournamentId: string }) {
  const { t } = useI18n();

  const toast = useToast();
  const bestOfOptions = useMemo(
    () => BEST_OF_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) })),
    [t],
  );
  const [data, setData] = useState<MatchFormat>(DEFAULTS);
  // Whether the ruleset HAS afterblow, driven from its grammar rather than a
  // `rulesetCode === 'TF_v1'` literal — so the afterblow-mode control survives
  // a "Customise this format" fork (code becomes custom_*, grammar unchanged).
  const [hasAfterblow, setHasAfterblow] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Silent read: the tab shows the coded defaults until the row lands, and
    // the save below reports its own refusal.
    void apiRequest<Record<string, unknown>>(apiUrl, `/api/v1/tournaments/${tournamentId}`).then(
      (r) => {
        if (r.ok) {
          const row = r.data;
          setHasAfterblow(
            Boolean(
              (row['ruleset_grammar'] as { hasAfterblow?: boolean } | undefined)?.hasAfterblow,
            ),
          );
          const rc = (row['ruleset_config'] ?? {}) as { matchFormat?: Partial<MatchFormat> };
          const mf = rc.matchFormat ?? {};
          const sc = (row['scoring_config_json'] ?? {}) as Partial<MatchFormat>;
          setData({
            pointCap: mf.pointCap ?? DEFAULTS.pointCap,
            timerMode: mf.timerMode ?? DEFAULTS.timerMode,
            timeLimitsSeconds: { ...DEFAULTS.timeLimitsSeconds, ...(mf.timeLimitsSeconds ?? {}) },
            softClockLimitSeconds: mf.softClockLimitSeconds ?? DEFAULTS.softClockLimitSeconds,
            maxDoubleHits: mf.maxDoubleHits ?? DEFAULTS.maxDoubleHits,
            scoringDirection: mf.scoringDirection ?? DEFAULTS.scoringDirection,
            afterblowMode: sc.afterblowMode ?? DEFAULTS.afterblowMode,
            bestOf: { ...DEFAULTS.bestOf, ...(mf.bestOf ?? {}) },
          });
        }
      },
    );
  }, [tournamentId]);

  async function save() {
    setSaving(true);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        body: {
          rulesetConfig: {
            matchFormat: {
              pointCap: data.pointCap,
              scoringDirection: data.scoringDirection,
              timerMode: data.timerMode,
              timeLimitsSeconds: data.timeLimitsSeconds,
              softClockLimitSeconds: data.softClockLimitSeconds,
              maxDoubleHits: data.maxDoubleHits,
              bestOf: data.bestOf,
            },
          },
          scoringConfig: { afterblowMode: data.afterblowMode },
        },
      });
      if (!r.ok) {
        // A match format refused by class-validator names every bad field, not
        // just the first — a point cap and a time limit both out of range are
        // fixed in one pass now.
        const message = failureMessage(r, t, t('admin.common.saveFailed'));
        if (message) toast.error(message);
        return;
      }
      toast.success(t('organizer.tournaments.settings.saved'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('organizer.tournaments.settings.matchFormat')}
      </h2>

      <p className="text-xs text-muted">{t('admin.orgTournaments.matchFormatHint')}</p>

      <NumberField
        label={t('organizer.tournaments.settings.pointCap')}
        hint={t('organizer.tournaments.settings.pointCapHelp')}
        value={data.pointCap}
        defaultValue={DEFAULTS.pointCap}
        onChange={(v) => setData({ ...data, pointCap: v })}
        onReset={() => setData({ ...data, pointCap: DEFAULTS.pointCap })}
        min={1}
        max={50}
      />

      <SelectField
        label={t('organizer.tournaments.settings.timerMode')}
        hint={t('organizer.tournaments.settings.timerModeHelp')}
        value={data.timerMode}
        defaultValue={DEFAULTS.timerMode}
        onChange={(v) => setData({ ...data, timerMode: v as 'countdown' | 'countup' })}
        onReset={() => setData({ ...data, timerMode: DEFAULTS.timerMode })}
        options={[
          { value: 'countdown', label: t('organizer.tournaments.settings.timerCountdown') },
          { value: 'countup', label: t('organizer.tournaments.settings.timerCountup') },
        ]}
      />

      <NumberField
        label={t('organizer.tournaments.settings.timePool')}
        hint={t('organizer.tournaments.settings.timePoolHelp')}
        value={data.timeLimitsSeconds.pool ?? 0}
        defaultValue={DEFAULTS.timeLimitsSeconds.pool ?? 0}
        onChange={(v) =>
          setData({ ...data, timeLimitsSeconds: { ...data.timeLimitsSeconds, pool: v } })
        }
        onReset={() =>
          setData({
            ...data,
            timeLimitsSeconds: { ...data.timeLimitsSeconds, pool: DEFAULTS.timeLimitsSeconds.pool },
          })
        }
        min={0}
        max={3600}
        suffix="s"
      />
      <NumberField
        label={t('organizer.tournaments.settings.timeBracket')}
        hint={t('organizer.tournaments.settings.timeBracketHelp')}
        value={data.timeLimitsSeconds.bracket ?? 0}
        defaultValue={DEFAULTS.timeLimitsSeconds.bracket ?? 0}
        onChange={(v) =>
          setData({ ...data, timeLimitsSeconds: { ...data.timeLimitsSeconds, bracket: v } })
        }
        onReset={() =>
          setData({
            ...data,
            timeLimitsSeconds: {
              ...data.timeLimitsSeconds,
              bracket: DEFAULTS.timeLimitsSeconds.bracket,
            },
          })
        }
        min={0}
        max={3600}
        suffix="s"
      />
      <NumberField
        label={t('organizer.tournaments.settings.timeFinals')}
        hint={t('organizer.tournaments.settings.timeFinalsHelp')}
        value={data.timeLimitsSeconds.finals ?? 0}
        defaultValue={DEFAULTS.timeLimitsSeconds.finals ?? 0}
        onChange={(v) =>
          setData({ ...data, timeLimitsSeconds: { ...data.timeLimitsSeconds, finals: v } })
        }
        onReset={() =>
          setData({
            ...data,
            timeLimitsSeconds: {
              ...data.timeLimitsSeconds,
              finals: DEFAULTS.timeLimitsSeconds.finals,
            },
          })
        }
        min={0}
        max={3600}
        suffix="s"
      />

      <SelectField
        label={t('organizer.tournaments.settings.bestOfPool')}
        hint={t('organizer.tournaments.settings.bestOfHelp')}
        value={String(data.bestOf.pool)}
        defaultValue={String(DEFAULTS.bestOf.pool)}
        onChange={(v) => setData({ ...data, bestOf: { ...data.bestOf, pool: Number(v) } })}
        onReset={() => setData({ ...data, bestOf: { ...data.bestOf, pool: DEFAULTS.bestOf.pool } })}
        options={bestOfOptions}
      />
      <SelectField
        label={t('organizer.tournaments.settings.bestOfBracket')}
        value={String(data.bestOf.bracket)}
        defaultValue={String(DEFAULTS.bestOf.bracket)}
        onChange={(v) => setData({ ...data, bestOf: { ...data.bestOf, bracket: Number(v) } })}
        onReset={() =>
          setData({ ...data, bestOf: { ...data.bestOf, bracket: DEFAULTS.bestOf.bracket } })
        }
        options={bestOfOptions}
      />
      <SelectField
        label={t('organizer.tournaments.settings.bestOfFinals')}
        value={String(data.bestOf.finals)}
        defaultValue={String(DEFAULTS.bestOf.finals)}
        onChange={(v) => setData({ ...data, bestOf: { ...data.bestOf, finals: Number(v) } })}
        onReset={() =>
          setData({ ...data, bestOf: { ...data.bestOf, finals: DEFAULTS.bestOf.finals } })
        }
        options={bestOfOptions}
      />

      <NumberField
        label={t('organizer.tournaments.settings.softClock')}
        hint={t('organizer.tournaments.settings.softClockHelp')}
        value={data.softClockLimitSeconds}
        defaultValue={DEFAULTS.softClockLimitSeconds}
        onChange={(v) => setData({ ...data, softClockLimitSeconds: v })}
        onReset={() => setData({ ...data, softClockLimitSeconds: DEFAULTS.softClockLimitSeconds })}
        min={0}
        max={600}
        suffix="s"
      />

      <NumberField
        label={t('organizer.tournaments.settings.maxDoubleHits')}
        hint={t('organizer.tournaments.settings.maxDoubleHitsHelp')}
        value={data.maxDoubleHits ?? 0}
        defaultValue={DEFAULTS.maxDoubleHits ?? 0}
        onChange={(v) => setData({ ...data, maxDoubleHits: v })}
        onReset={() => setData({ ...data, maxDoubleHits: DEFAULTS.maxDoubleHits })}
        min={0}
        max={20}
      />

      {hasAfterblow && (
        <SelectField
          label={t('organizer.tournaments.settings.afterblowMode')}
          hint={t('organizer.tournaments.settings.afterblowModeHelp')}
          value={data.afterblowMode}
          defaultValue={DEFAULTS.afterblowMode}
          onChange={(v) => setData({ ...data, afterblowMode: v as 'full' | 'deductive' })}
          onReset={() => setData({ ...data, afterblowMode: DEFAULTS.afterblowMode })}
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
        defaultValue={DEFAULTS.scoringDirection}
        onChange={(v) =>
          setData({ ...data, scoringDirection: v as MatchFormat['scoringDirection'] })
        }
        onReset={() => setData({ ...data, scoringDirection: DEFAULTS.scoringDirection })}
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
        onClick={() => void save()}
        disabled={saving}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
      >
        {saving ? t('common.saving') : t('organizer.tournaments.settings.save')}
      </button>
    </div>
  );
}

function NumberField({
  label,
  value,
  defaultValue,
  onChange,
  onReset,
  min,
  max,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  defaultValue?: number;
  onChange: (v: number) => void;
  onReset?: () => void;
  min: number;
  max: number;
  suffix?: string;
  hint?: string;
}) {
  const { t } = useI18n();

  const modified = defaultValue !== undefined && value !== defaultValue;
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-xs font-medium text-foreground-secondary">
        {label}
        {modified && (
          <span
            title={`Default: ${defaultValue}`}
            className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warning"
          >
            {t('admin.orgTournaments.modifiedBadge')}
          </span>
        )}
        {modified && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="ml-auto text-xs text-muted underline hover:text-foreground"
            title={`Reset to ${defaultValue}`}
          >
            {t('admin.orgTournaments.reset')}
          </button>
        )}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-32 rounded-md border border-border px-3 py-2 text-sm"
        />
        {suffix && <span className="text-xs text-muted">{suffix}</span>}
      </div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </label>
  );
}

function SelectField({
  label,
  value,
  defaultValue,
  onChange,
  onReset,
  options,
  hint,
}: {
  label: string;
  value: string;
  defaultValue?: string;
  onChange: (v: string) => void;
  onReset?: () => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
}) {
  const { t } = useI18n();

  const modified = defaultValue !== undefined && value !== defaultValue;
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-xs font-medium text-foreground-secondary">
        {label}
        {modified && (
          <span
            title={`Default: ${defaultValue}`}
            className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warning"
          >
            {t('admin.orgTournaments.modifiedBadge')}
          </span>
        )}
        {modified && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="ml-auto text-xs text-muted underline hover:text-foreground"
            title={`Reset to ${defaultValue}`}
          >
            {t('admin.orgTournaments.reset')}
          </button>
        )}
      </span>
      <select
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
    </label>
  );
}
