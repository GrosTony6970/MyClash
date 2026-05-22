'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface RulesetConfigTF {
  winBonus: number;
  targetValues: { deepTarget: number; shallowTarget: number };
}
interface LockConfig {
  autoLockEnabled: boolean;
  autoLockDelayMinutes: number;
  autoLockCompletedPools: boolean;
  autoLockCompletedBrackets: boolean;
}

const TF_DEFAULTS: RulesetConfigTF = {
  winBonus: 3,
  targetValues: { deepTarget: 2, shallowTarget: 1 },
};
const LOCK_DEFAULTS: LockConfig = {
  autoLockEnabled: false,
  autoLockDelayMinutes: 30,
  autoLockCompletedPools: false,
  autoLockCompletedBrackets: false,
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
  const [lock, setLock] = useState<LockConfig>(LOCK_DEFAULTS);
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
        });
        const lc = (row.lock_config ?? {}) as Partial<LockConfig>;
        setLock({
          autoLockEnabled: lc.autoLockEnabled ?? LOCK_DEFAULTS.autoLockEnabled,
          autoLockDelayMinutes: lc.autoLockDelayMinutes ?? LOCK_DEFAULTS.autoLockDelayMinutes,
          autoLockCompletedPools: lc.autoLockCompletedPools ?? LOCK_DEFAULTS.autoLockCompletedPools,
          autoLockCompletedBrackets:
            lc.autoLockCompletedBrackets ?? LOCK_DEFAULTS.autoLockCompletedBrackets,
        });
      });
  }, [tournamentId]);

  async function saveAndFinish() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { lockConfig: lock };
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

      {rulesetCode === 'TF_v1' && (
        <fieldset className="space-y-3 rounded-md border border-slate-200 p-4">
          <legend className="px-2 text-xs font-medium text-slate-600">
            TF_v1 ruleset internals
          </legend>
          <NumField
            label="Win bonus"
            value={tf.winBonus}
            onChange={(v) => setTf({ ...tf, winBonus: v })}
            min={0}
            max={20}
          />
          <NumField
            label="Deep target points"
            value={tf.targetValues.deepTarget}
            onChange={(v) => setTf({ ...tf, targetValues: { ...tf.targetValues, deepTarget: v } })}
            min={0}
            max={20}
          />
          <NumField
            label="Shallow target points"
            value={tf.targetValues.shallowTarget}
            onChange={(v) =>
              setTf({ ...tf, targetValues: { ...tf.targetValues, shallowTarget: v } })
            }
            min={0}
            max={20}
          />
        </fieldset>
      )}

      <fieldset className="space-y-3 rounded-md border border-slate-200 p-4">
        <legend className="px-2 text-xs font-medium text-slate-600">Auto-lock</legend>
        <BoolField
          label="Auto-lock enabled"
          value={lock.autoLockEnabled}
          onChange={(v) => setLock({ ...lock, autoLockEnabled: v })}
        />
        <NumField
          label="Auto-lock delay (minutes)"
          value={lock.autoLockDelayMinutes}
          onChange={(v) => setLock({ ...lock, autoLockDelayMinutes: v })}
          min={0}
          max={1440}
        />
        <BoolField
          label="Auto-lock completed pools"
          value={lock.autoLockCompletedPools}
          onChange={(v) => setLock({ ...lock, autoLockCompletedPools: v })}
        />
        <BoolField
          label="Auto-lock completed brackets"
          value={lock.autoLockCompletedBrackets}
          onChange={(v) => setLock({ ...lock, autoLockCompletedBrackets: v })}
        />
      </fieldset>

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
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-700">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
      />
    </label>
  );
}

function BoolField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-700">{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
