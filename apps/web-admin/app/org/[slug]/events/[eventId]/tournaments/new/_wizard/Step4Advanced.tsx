'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';
import { buildTfFromRow, type RulesetConfigTF, TF_DEFAULTS } from './buildTfFromRow';
import { TournamentVenuesEditor } from '../../_components/TournamentVenuesEditor';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export function Step4Advanced({
  tournamentId,
  eventId,
  onBack,
  onFinish,
}: {
  tournamentId: string;
  eventId: string;
  onBack: () => void;
  onFinish: (publish: boolean) => void;
}) {
  const toast = useToast();
  const [rulesetCode, setRulesetCode] = useState<string>('TF_v1');
  const [tf, setTf] = useState<RulesetConfigTF>(TF_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [publishOnFinish, setPublishOnFinish] = useState(false);

  useEffect(() => {
    void fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (!row) return;
        setRulesetCode(row.ruleset_code);
        // Pluck-not-spread: see buildTfFromRow.ts for the rationale.
        // The previous spread merge leaked the rulesets-engine
        // `forfeitPolicy.reasons` blob into the PATCH body and tripped
        // the API's strict `forbidNonWhitelisted` validator with a 400.
        setTf(
          buildTfFromRow(
            (row.ruleset_config ?? {}) as Partial<RulesetConfigTF> & Record<string, unknown>,
            TF_DEFAULTS,
          ),
        );
      });
  }, [tournamentId]);

  async function saveAndFinish() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (rulesetCode === 'TF_v1') body['rulesetConfig'] = tf;
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Save failed (${res.status}): ${errBody.slice(0, 200)}`);
      }
      onFinish(publishOnFinish);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
        <button
          type="button"
          onClick={() => onFinish(false)}
          className="font-medium text-warning hover:underline"
        >
          {t('organizer.tournaments.wizard.useDefaultsAndFinish')} →
        </button>
      </div>

      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('organizer.tournaments.wizard.advanced')}
      </h2>
      <p className="text-xs text-muted">{t('admin.orgTournaments.advancedWizardHint')}</p>

      <div className="rounded-md border border-border p-4">
        <TournamentVenuesEditor tournamentId={tournamentId} eventId={eventId} />
      </div>

      {rulesetCode === 'TF_v1' && (
        <fieldset className="space-y-3 rounded-md border border-border p-4">
          <legend className="px-2 text-xs font-medium text-foreground-secondary">
            {t('admin.orgTournaments.tfRulesetLegend')}
          </legend>
          <NumField
            label={t('admin.orgTournaments.winBonus')}
            value={tf.winBonus}
            defaultValue={TF_DEFAULTS.winBonus}
            onChange={(v) => setTf({ ...tf, winBonus: v })}
            onReset={() => setTf({ ...tf, winBonus: TF_DEFAULTS.winBonus })}
            min={0}
            max={20}
          />
          <NumField
            label={t('admin.orgTournaments.deepTarget')}
            value={tf.targetValues.deepTarget}
            defaultValue={TF_DEFAULTS.targetValues.deepTarget}
            onChange={(v) => setTf({ ...tf, targetValues: { ...tf.targetValues, deepTarget: v } })}
            onReset={() =>
              setTf({
                ...tf,
                targetValues: {
                  ...tf.targetValues,
                  deepTarget: TF_DEFAULTS.targetValues.deepTarget,
                },
              })
            }
            min={1}
            max={10}
          />
          <NumField
            label={t('admin.orgTournaments.shallowTarget')}
            value={tf.targetValues.shallowTarget}
            defaultValue={TF_DEFAULTS.targetValues.shallowTarget}
            onChange={(v) =>
              setTf({ ...tf, targetValues: { ...tf.targetValues, shallowTarget: v } })
            }
            onReset={() =>
              setTf({
                ...tf,
                targetValues: {
                  ...tf.targetValues,
                  shallowTarget: TF_DEFAULTS.targetValues.shallowTarget,
                },
              })
            }
            min={1}
            max={10}
          />
          <BoolField
            label={t('admin.orgTournaments.forfeitDrawsCount')}
            value={tf.tournamentPolicy.forfeitDrawsCount}
            defaultValue={TF_DEFAULTS.tournamentPolicy.forfeitDrawsCount}
            onChange={(v) =>
              setTf({ ...tf, tournamentPolicy: { ...tf.tournamentPolicy, forfeitDrawsCount: v } })
            }
            onReset={() =>
              setTf({
                ...tf,
                tournamentPolicy: {
                  ...tf.tournamentPolicy,
                  forfeitDrawsCount: TF_DEFAULTS.tournamentPolicy.forfeitDrawsCount,
                },
              })
            }
          />
          <BoolField
            label={t('admin.orgTournaments.forfeitBeforeFirstMatchDq')}
            value={tf.tournamentPolicy.forfeitFighterBefore1stMatch}
            defaultValue={TF_DEFAULTS.tournamentPolicy.forfeitFighterBefore1stMatch}
            onChange={(v) =>
              setTf({
                ...tf,
                tournamentPolicy: { ...tf.tournamentPolicy, forfeitFighterBefore1stMatch: v },
              })
            }
            onReset={() =>
              setTf({
                ...tf,
                tournamentPolicy: {
                  ...tf.tournamentPolicy,
                  forfeitFighterBefore1stMatch:
                    TF_DEFAULTS.tournamentPolicy.forfeitFighterBefore1stMatch,
                },
              })
            }
          />
          <NumField
            label={t('admin.orgTournaments.disqualifyAfter')}
            value={tf.tournamentPolicy.disqualifyAfter}
            defaultValue={TF_DEFAULTS.tournamentPolicy.disqualifyAfter}
            onChange={(v) =>
              setTf({ ...tf, tournamentPolicy: { ...tf.tournamentPolicy, disqualifyAfter: v } })
            }
            onReset={() =>
              setTf({
                ...tf,
                tournamentPolicy: {
                  ...tf.tournamentPolicy,
                  disqualifyAfter: TF_DEFAULTS.tournamentPolicy.disqualifyAfter,
                },
              })
            }
            min={1}
            max={10}
          />
        </fieldset>
      )}

      <div className="flex items-center gap-3 justify-between mt-6">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background"
        >
          {t('actions.back')}
        </button>
        <label className="flex items-center gap-2 text-xs text-foreground-secondary">
          <input
            type="checkbox"
            checked={publishOnFinish}
            onChange={(e) => setPublishOnFinish(e.target.checked)}
          />
          {t('organizer.tournaments.wizard.publishOnFinish')}
        </label>
        <button
          type="button"
          onClick={() => void saveAndFinish()}
          disabled={saving}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? t('common.saving') : t('organizer.tournaments.wizard.finish')}
        </button>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  defaultValue,
  onChange,
  onReset,
  min,
  max,
}: {
  label: string;
  value: number;
  defaultValue?: number;
  onChange: (v: number) => void;
  onReset?: () => void;
  min: number;
  max: number;
}) {
  const modified = defaultValue !== undefined && value !== defaultValue;
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm text-foreground-secondary">
        {label}
        {modified && (
          <span
            title={`Default: ${defaultValue}`}
            className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warning"
          >
            {t('admin.orgTournaments.modifiedBadge')}
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        {modified && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-muted underline hover:text-foreground"
            title={`Reset to ${defaultValue}`}
          >
            {t('admin.orgTournaments.reset')}
          </button>
        )}
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 rounded-md border border-border px-3 py-1.5 text-sm"
        />
      </span>
    </label>
  );
}

function BoolField({
  label,
  value,
  defaultValue,
  onChange,
  onReset,
}: {
  label: string;
  value: boolean;
  defaultValue?: boolean;
  onChange: (v: boolean) => void;
  onReset?: () => void;
}) {
  const modified = defaultValue !== undefined && value !== defaultValue;
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm text-foreground-secondary">
        {label}
        {modified && (
          <span
            title={`Default: ${String(defaultValue)}`}
            className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warning"
          >
            {t('admin.orgTournaments.modifiedBadge')}
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        {modified && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-muted underline hover:text-foreground"
            title={`Reset to ${String(defaultValue)}`}
          >
            {t('admin.orgTournaments.reset')}
          </button>
        )}
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      </span>
    </label>
  );
}
