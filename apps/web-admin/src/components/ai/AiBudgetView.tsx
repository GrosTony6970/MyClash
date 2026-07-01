'use client';

import { useState } from 'react';

function eur(n: number): string {
  return `€${n.toFixed(4)}`;
}

export function AiBudgetView({
  budgetEur,
  spentEur,
  onSave,
  t,
  disabled = false,
}: {
  budgetEur: number | null;
  spentEur: number;
  onSave: (value: number | null) => Promise<void>;
  t: (key: string) => string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(budgetEur == null ? '' : String(budgetEur));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ratio = budgetEur && budgetEur > 0 ? spentEur / budgetEur : 0;
  const near = ratio >= 0.8 && ratio < 1;
  const reached = budgetEur != null && spentEur >= budgetEur;

  async function save() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const trimmed = value.trim();
      const parsed = trimmed === '' ? null : Number(trimmed);
      if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) {
        throw new Error(t('admin.aiSettings.budgetError'));
      }
      await onSave(parsed);
      setMessage(t('admin.aiSettings.budgetSaved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.aiSettings.budgetError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          {t('admin.aiSettings.budgetSpent')}
        </p>
        <p className="mt-1 text-xl font-semibold text-foreground">
          {eur(spentEur)}
          {budgetEur != null && (
            <span className="ml-1 text-sm font-normal text-muted"> / {eur(budgetEur)}</span>
          )}
        </p>
        {budgetEur != null && budgetEur > 0 && (
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-border">
            <div
              className={[
                'h-full rounded-full',
                reached ? 'bg-danger' : near ? 'bg-warning' : 'bg-accent',
              ].join(' ')}
              style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
            />
          </div>
        )}
        {budgetEur == null && (
          <p className="mt-1 text-xs text-muted">{t('admin.aiSettings.budgetUnlimited')}</p>
        )}
      </div>

      {reached && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {t('admin.aiSettings.budgetReached')}
        </div>
      )}
      {near && !reached && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {t('admin.aiSettings.budgetNear')}
        </div>
      )}

      <label className="block text-sm font-medium text-foreground-secondary" htmlFor="ai-budget">
        {t('admin.aiSettings.budgetLabel')}
        <input
          id="ai-budget"
          type="number"
          min={0}
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
        />
      </label>
      <p className="text-xs text-muted">{t('admin.aiSettings.budgetHint')}</p>

      {message && <p className="text-sm text-success">{message}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || disabled}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
      >
        {t('admin.aiSettings.saveBudget')}
      </button>
    </div>
  );
}
