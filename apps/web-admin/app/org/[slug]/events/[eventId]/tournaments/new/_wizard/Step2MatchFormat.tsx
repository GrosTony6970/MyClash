'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';
import {
  buildMatchFormatFromRow,
  MATCH_FORMAT_DEFAULTS,
  type WizardMatchFormat,
} from './buildMatchFormatFromRow';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

type MatchFormat = WizardMatchFormat;
const DEFAULTS: MatchFormat = MATCH_FORMAT_DEFAULTS;

export function Step2MatchFormat({
  tournamentId,
  onNext,
  onBack,
}: {
  tournamentId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<MatchFormat>(DEFAULTS);
  const [rulesetCode, setRulesetCode] = useState<string>('TF_v1');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (!row) return;
        setRulesetCode(row.ruleset_code);
        // Pluck-not-spread to keep stray engine/legacy keys out of the
        // PATCH body — same discipline as Step 4. See buildMatchFormatFromRow.
        setData(
          buildMatchFormatFromRow(
            (row.ruleset_config ?? {}) as Record<string, unknown>,
            (row.scoring_config_json ?? {}) as Record<string, unknown>,
            DEFAULTS,
          ),
        );
      });
  }, [tournamentId]);

  async function saveAndAdvance() {
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
              bestOf: data.bestOf,
            },
          },
          scoringConfig: { afterblowMode: data.afterblowMode },
        }),
      });
      if (!res.ok) throw new Error(t('admin.common.saveFailed'));
      toast.success(t('organizer.tournaments.settings.saved'));
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}?id=${tournamentId}&step=3`,
      );
      onNext();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('admin.common.somethingWentWrong'));
    } finally {
      setSaving(false);
    }
  }

  const isTfV1 = rulesetCode === 'TF_v1';

  return (
    <div className="space-y-4">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('organizer.tournaments.wizard.matchFormat')}
      </h2>

      <NumberField
        label={t('organizer.tournaments.settings.pointCap')}
        hint={t('organizer.tournaments.settings.pointCapHelp')}
        value={data.pointCap}
        onChange={(v) => setData({ ...data, pointCap: v })}
        min={1}
        max={50}
      />

      <SelectField
        label={t('organizer.tournaments.settings.timerMode')}
        hint={t('organizer.tournaments.settings.timerModeHelp')}
        value={data.timerMode}
        onChange={(v) => setData({ ...data, timerMode: v as 'countdown' | 'countup' })}
        options={[
          { value: 'countdown', label: t('organizer.tournaments.settings.timerCountdown') },
          { value: 'countup', label: t('organizer.tournaments.settings.timerCountup') },
        ]}
      />

      <NumberField
        label={t('organizer.tournaments.settings.timePool')}
        hint={t('organizer.tournaments.settings.timePoolHelp')}
        value={data.timeLimitsSeconds.pool ?? 0}
        onChange={(v) =>
          setData({ ...data, timeLimitsSeconds: { ...data.timeLimitsSeconds, pool: v } })
        }
        min={0}
        max={3600}
        suffix="s"
      />
      <NumberField
        label={t('organizer.tournaments.settings.timeBracket')}
        hint={t('organizer.tournaments.settings.timeBracketHelp')}
        value={data.timeLimitsSeconds.bracket ?? 0}
        onChange={(v) =>
          setData({ ...data, timeLimitsSeconds: { ...data.timeLimitsSeconds, bracket: v } })
        }
        min={0}
        max={3600}
        suffix="s"
      />
      <NumberField
        label={t('organizer.tournaments.settings.timeFinals')}
        hint={t('organizer.tournaments.settings.timeFinalsHelp')}
        value={data.timeLimitsSeconds.finals ?? 0}
        onChange={(v) =>
          setData({ ...data, timeLimitsSeconds: { ...data.timeLimitsSeconds, finals: v } })
        }
        min={0}
        max={3600}
        suffix="s"
      />

      <SelectField
        label={t('organizer.tournaments.settings.bestOfPool')}
        hint={t('organizer.tournaments.settings.bestOfHelp')}
        value={String(data.bestOf.pool)}
        onChange={(v) => setData({ ...data, bestOf: { ...data.bestOf, pool: Number(v) } })}
        options={[
          { value: '1', label: t('organizer.tournaments.settings.bestOfSingle') },
          { value: '3', label: t('organizer.tournaments.settings.bestOf3') },
          { value: '5', label: t('organizer.tournaments.settings.bestOf5') },
          { value: '7', label: t('organizer.tournaments.settings.bestOf7') },
        ]}
      />
      <SelectField
        label={t('organizer.tournaments.settings.bestOfBracket')}
        value={String(data.bestOf.bracket)}
        onChange={(v) => setData({ ...data, bestOf: { ...data.bestOf, bracket: Number(v) } })}
        options={[
          { value: '1', label: t('organizer.tournaments.settings.bestOfSingle') },
          { value: '3', label: t('organizer.tournaments.settings.bestOf3') },
          { value: '5', label: t('organizer.tournaments.settings.bestOf5') },
          { value: '7', label: t('organizer.tournaments.settings.bestOf7') },
        ]}
      />
      <SelectField
        label={t('organizer.tournaments.settings.bestOfFinals')}
        value={String(data.bestOf.finals)}
        onChange={(v) => setData({ ...data, bestOf: { ...data.bestOf, finals: Number(v) } })}
        options={[
          { value: '1', label: t('organizer.tournaments.settings.bestOfSingle') },
          { value: '3', label: t('organizer.tournaments.settings.bestOf3') },
          { value: '5', label: t('organizer.tournaments.settings.bestOf5') },
          { value: '7', label: t('organizer.tournaments.settings.bestOf7') },
        ]}
      />

      <NumberField
        label={t('organizer.tournaments.settings.softClock')}
        hint={t('organizer.tournaments.settings.softClockHelp')}
        value={data.softClockLimitSeconds}
        onChange={(v) => setData({ ...data, softClockLimitSeconds: v })}
        min={0}
        max={600}
        suffix="s"
      />

      <NumberField
        label={t('organizer.tournaments.settings.maxDoubleHits')}
        hint={t('organizer.tournaments.settings.maxDoubleHitsHelp')}
        value={data.maxDoubleHits ?? 0}
        onChange={(v) => setData({ ...data, maxDoubleHits: v })}
        min={0}
        max={20}
      />

      {isTfV1 && (
        <SelectField
          label={t('organizer.tournaments.settings.afterblowMode')}
          hint={t('organizer.tournaments.settings.afterblowModeHelp')}
          value={data.afterblowMode}
          onChange={(v) => setData({ ...data, afterblowMode: v as 'full' | 'deductive' })}
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
        onChange={(v) =>
          setData({ ...data, scoringDirection: v as MatchFormat['scoringDirection'] })
        }
        options={[
          { value: 'normal', label: t('organizer.tournaments.settings.scoringNormal') },
          {
            value: 'reverse_zero_loses',
            label: t('organizer.tournaments.settings.scoringReverse'),
          },
        ]}
      />

      <div className="flex justify-between mt-6">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background"
        >
          {t('actions.back')}
        </button>
        <button
          type="button"
          onClick={() => void saveAndAdvance()}
          disabled={saving}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? t('common.saving') : t('actions.next')}
        </button>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-foreground-secondary mb-1">{label}</span>
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
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-foreground-secondary mb-1">{label}</span>
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
