'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface LockConfig {
  autoLockEnabled: boolean;
  autoLockDelayMinutes: number;
  autoLockCompletedPools: boolean;
  autoLockCompletedBrackets: boolean;
}

const LOCK_DEFAULTS: LockConfig = {
  autoLockEnabled: false,
  autoLockDelayMinutes: 30,
  autoLockCompletedPools: false,
  autoLockCompletedBrackets: false,
};

export function LocksTab({ tournamentId }: { tournamentId: string }) {
  const toast = useToast();
  const [lock, setLock] = useState<LockConfig>(LOCK_DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (!row) return;
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

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockConfig: lock }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success(t('organizer.tournaments.settings.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl text-slate-900">Auto-lock</h2>
        <p className="mt-1 text-sm text-slate-500">
          Locks completed pools or brackets after a delay so referees can&apos;t keep editing them.
          This is a tournament-level setting, separate from the ruleset.
        </p>
      </div>

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
