'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface MatchFormat {
  pointCap: number;
  timerMode: 'countdown' | 'countup';
  timeLimitsSeconds: { pool: number | null; bracket: number | null; finals: number | null };
  softClockLimitSeconds: number;
  maxDoubleHits: number | null;
  afterblowMode: 'full' | 'deductive';
  scoringDirection: 'normal' | 'reverse_zero_loses';
}

const DEFAULTS: MatchFormat = {
  pointCap: 5,
  timerMode: 'countdown',
  timeLimitsSeconds: { pool: 180, bracket: 240, finals: 300 },
  softClockLimitSeconds: 60,
  maxDoubleHits: 3,
  afterblowMode: 'full',
  scoringDirection: 'normal',
};

export function MatchFormatTab({ tournamentId }: { tournamentId: string }) {
  const toast = useToast();
  const [data, setData] = useState<MatchFormat>(DEFAULTS);
  const [rulesetCode, setRulesetCode] = useState<string>('TF_v1');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (!row) return;
        setRulesetCode(row.ruleset_code);
        const rc = (row.ruleset_config ?? {}) as { matchFormat?: Partial<MatchFormat> };
        const mf = rc.matchFormat ?? {};
        const sc = (row.scoring_config_json ?? {}) as Partial<MatchFormat>;
        setData({
          pointCap: mf.pointCap ?? DEFAULTS.pointCap,
          timerMode: mf.timerMode ?? DEFAULTS.timerMode,
          timeLimitsSeconds: { ...DEFAULTS.timeLimitsSeconds, ...(mf.timeLimitsSeconds ?? {}) },
          softClockLimitSeconds: mf.softClockLimitSeconds ?? DEFAULTS.softClockLimitSeconds,
          maxDoubleHits: mf.maxDoubleHits ?? DEFAULTS.maxDoubleHits,
          scoringDirection: mf.scoringDirection ?? DEFAULTS.scoringDirection,
          afterblowMode: sc.afterblowMode ?? DEFAULTS.afterblowMode,
        });
      });
  }, [tournamentId]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rulesetConfig: {
            matchFormat: {
              pointCap: data.pointCap,
              scoringDirection: data.scoringDirection,
              timerMode: data.timerMode,
              timeLimitsSeconds: data.timeLimitsSeconds,
              softClockLimitSeconds: data.softClockLimitSeconds,
              maxDoubleHits: data.maxDoubleHits,
            },
          },
          scoringConfig: { afterblowMode: data.afterblowMode },
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success(t('organizer.tournaments.settings.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  const isTfV1 = rulesetCode === 'TF_v1';

  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl text-slate-900">
        {t('organizer.tournaments.settings.matchFormat')}
      </h2>

      <p className="text-xs text-slate-500">
        Defaults come from the ruleset. Any value you change here is stored as a per-tournament
        override; use the Reset link to restore the ruleset default.
      </p>

      <NumberField
        label={t('organizer.tournaments.settings.pointCap')}
        value={data.pointCap}
        defaultValue={DEFAULTS.pointCap}
        onChange={(v) => setData({ ...data, pointCap: v })}
        onReset={() => setData({ ...data, pointCap: DEFAULTS.pointCap })}
        min={1}
        max={50}
      />

      <SelectField
        label={t('organizer.tournaments.settings.timerMode')}
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

      <NumberField
        label={t('organizer.tournaments.settings.softClock')}
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
        value={data.maxDoubleHits ?? 0}
        defaultValue={DEFAULTS.maxDoubleHits ?? 0}
        onChange={(v) => setData({ ...data, maxDoubleHits: v })}
        onReset={() => setData({ ...data, maxDoubleHits: DEFAULTS.maxDoubleHits })}
        min={0}
        max={20}
      />

      {isTfV1 && (
        <SelectField
          label={t('organizer.tournaments.settings.afterblowMode')}
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
        className="rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
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
}: {
  label: string;
  value: number;
  defaultValue?: number;
  onChange: (v: number) => void;
  onReset?: () => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  const modified = defaultValue !== undefined && value !== defaultValue;
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-600">
        {label}
        {modified && (
          <span
            title={`Default: ${defaultValue}`}
            className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800"
          >
            modified
          </span>
        )}
        {modified && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="ml-auto text-xs text-slate-500 underline hover:text-slate-800"
            title={`Reset to ${defaultValue}`}
          >
            Reset
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
          className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        {suffix && <span className="text-xs text-slate-500">{suffix}</span>}
      </div>
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
}: {
  label: string;
  value: string;
  defaultValue?: string;
  onChange: (v: string) => void;
  onReset?: () => void;
  options: Array<{ value: string; label: string }>;
}) {
  const modified = defaultValue !== undefined && value !== defaultValue;
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-600">
        {label}
        {modified && (
          <span
            title={`Default: ${defaultValue}`}
            className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800"
          >
            modified
          </span>
        )}
        {modified && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="ml-auto text-xs text-slate-500 underline hover:text-slate-800"
            title={`Reset to ${defaultValue}`}
          >
            Reset
          </button>
        )}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
