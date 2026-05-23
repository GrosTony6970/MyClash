'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface RulesetConfigTF {
  winBonus: number;
  targetValues: { deepTarget: number; shallowTarget: number };
  forfeitPolicy: {
    forfeitDrawsCount: boolean;
    forfeitFighterBefore1stMatch: boolean;
    disqualifyAfter: number;
  };
}

const TF_DEFAULTS: RulesetConfigTF = {
  winBonus: 3,
  targetValues: { deepTarget: 2, shallowTarget: 1 },
  forfeitPolicy: {
    forfeitDrawsCount: false,
    forfeitFighterBefore1stMatch: false,
    disqualifyAfter: 2,
  },
};

export function Step4Advanced({
  tournamentId,
  onBack,
  onFinish,
}: {
  tournamentId: string;
  onBack: () => void;
  onFinish: (publish: boolean) => void;
}) {
  const toast = useToast();
  const [rulesetCode, setRulesetCode] = useState<string>('TF_v1');
  const [tf, setTf] = useState<RulesetConfigTF>(TF_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [publishOnFinish, setPublishOnFinish] = useState(false);

  useEffect(() => {
    fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (!row) return;
        setRulesetCode(row.ruleset_code);
        const rc = (row.ruleset_config ?? {}) as Partial<RulesetConfigTF>;
        setTf({
          winBonus: rc.winBonus ?? TF_DEFAULTS.winBonus,
          targetValues: { ...TF_DEFAULTS.targetValues, ...(rc.targetValues ?? {}) },
          forfeitPolicy: { ...TF_DEFAULTS.forfeitPolicy, ...(rc.forfeitPolicy ?? {}) },
        });
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
      <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
        <button
          type="button"
          onClick={() => onFinish(false)}
          className="font-medium text-amber-900 hover:underline"
        >
          {t('organizer.tournaments.wizard.useDefaultsAndFinish')} →
        </button>
      </div>

      <h2 className="font-display text-xl text-slate-900">
        {t('organizer.tournaments.wizard.advanced')}
      </h2>
      <p className="text-xs text-slate-500">
        These values come from the ruleset and can be overridden per tournament. Auto-lock is now
        configured separately from the tournament settings page after creation.
      </p>

      {rulesetCode === 'TF_v1' && (
        <fieldset className="space-y-3 rounded-md border border-slate-200 p-4">
          <legend className="px-2 text-xs font-medium text-slate-600">
            Ruleset (TF v1) — per-tournament overrides
          </legend>
          <NumField
            label="Win bonus"
            value={tf.winBonus}
            defaultValue={TF_DEFAULTS.winBonus}
            onChange={(v) => setTf({ ...tf, winBonus: v })}
            onReset={() => setTf({ ...tf, winBonus: TF_DEFAULTS.winBonus })}
            min={0}
            max={20}
          />
          <NumField
            label="Deep target points"
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
            min={0}
            max={20}
          />
          <NumField
            label="Shallow target points"
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
            min={0}
            max={20}
          />
          <BoolField
            label="Forfeit counts as draw"
            value={tf.forfeitPolicy.forfeitDrawsCount}
            defaultValue={TF_DEFAULTS.forfeitPolicy.forfeitDrawsCount}
            onChange={(v) =>
              setTf({ ...tf, forfeitPolicy: { ...tf.forfeitPolicy, forfeitDrawsCount: v } })
            }
            onReset={() =>
              setTf({
                ...tf,
                forfeitPolicy: {
                  ...tf.forfeitPolicy,
                  forfeitDrawsCount: TF_DEFAULTS.forfeitPolicy.forfeitDrawsCount,
                },
              })
            }
          />
          <BoolField
            label="Forfeit before 1st match → auto-DQ"
            value={tf.forfeitPolicy.forfeitFighterBefore1stMatch}
            defaultValue={TF_DEFAULTS.forfeitPolicy.forfeitFighterBefore1stMatch}
            onChange={(v) =>
              setTf({
                ...tf,
                forfeitPolicy: { ...tf.forfeitPolicy, forfeitFighterBefore1stMatch: v },
              })
            }
            onReset={() =>
              setTf({
                ...tf,
                forfeitPolicy: {
                  ...tf.forfeitPolicy,
                  forfeitFighterBefore1stMatch:
                    TF_DEFAULTS.forfeitPolicy.forfeitFighterBefore1stMatch,
                },
              })
            }
          />
          <NumField
            label="Disqualify after N forfeits"
            value={tf.forfeitPolicy.disqualifyAfter}
            defaultValue={TF_DEFAULTS.forfeitPolicy.disqualifyAfter}
            onChange={(v) =>
              setTf({ ...tf, forfeitPolicy: { ...tf.forfeitPolicy, disqualifyAfter: v } })
            }
            onReset={() =>
              setTf({
                ...tf,
                forfeitPolicy: {
                  ...tf.forfeitPolicy,
                  disqualifyAfter: TF_DEFAULTS.forfeitPolicy.disqualifyAfter,
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
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          {t('actions.back')}
        </button>
        <label className="flex items-center gap-2 text-xs text-slate-600">
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
          className="rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
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
      <span className="flex items-center gap-2 text-sm text-slate-700">
        {label}
        {modified && (
          <span
            title={`Default: ${defaultValue}`}
            className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800"
          >
            modified
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        {modified && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-slate-500 underline hover:text-slate-800"
            title={`Reset to ${defaultValue}`}
          >
            Reset
          </button>
        )}
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
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
      <span className="flex items-center gap-2 text-sm text-slate-700">
        {label}
        {modified && (
          <span
            title={`Default: ${String(defaultValue)}`}
            className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800"
          >
            modified
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        {modified && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-slate-500 underline hover:text-slate-800"
            title={`Reset to ${String(defaultValue)}`}
          >
            Reset
          </button>
        )}
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      </span>
    </label>
  );
}
