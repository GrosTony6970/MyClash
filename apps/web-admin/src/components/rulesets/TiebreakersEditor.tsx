'use client';

import { FORMULA_VARIABLE_KEYS } from '@myclash/rulesets';
import type { RankingRule, Tiebreaker, VariableKey } from '@myclash/rulesets';
import { useI18n } from '../../i18n/I18nProvider';

interface Props {
  value: Tiebreaker[];
  onChange: (next: Tiebreaker[]) => void;
  disabled?: boolean;
  /** When `value` is empty AND this fallback is provided, render the fallback
   *  as a read-only list with a "Read-only" badge instead of the "no
   *  tie-breakers configured" message. Used for is_system rulesets whose
   *  real ranking rules live on the coded `rankingChain` (with keys that
   *  don't map to the FORMULA_VARIABLE_KEYS whitelist). */
  systemFallback?: RankingRule[];
}

export function TiebreakersEditor({ value, onChange, disabled, systemFallback }: Props) {
  const { t } = useI18n();

  function formatRankingKey(key: string): string {
    const i18nKey = `admin.rulesets.rankingKey_${key}`;
    const translated = t(i18nKey);
    return translated === i18nKey ? key : translated;
  }
  function formatDirection(direction: 'asc' | 'desc'): string {
    return direction === 'desc'
      ? t('admin.rulesets.systemPanelDirectionHighest')
      : t('admin.rulesets.systemPanelDirectionLowest');
  }

  function update(idx: number, patch: Partial<Tiebreaker>) {
    if (disabled) return;
    onChange(value.map((tb, i) => (i === idx ? { ...tb, ...patch } : tb)));
  }
  function remove(idx: number) {
    if (disabled) return;
    onChange(value.filter((_, i) => i !== idx));
  }
  function move(idx: number, delta: -1 | 1) {
    if (disabled) return;
    const target = idx + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    onChange(next);
  }
  function add() {
    if (disabled) return;
    onChange([...value, { variable: 'victories', direction: 'desc' }]);
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      {value.length === 0 ? (
        systemFallback && systemFallback.length > 0 ? (
          <ol className="mb-3 space-y-2">
            {systemFallback.map((rule, idx) => (
              <li
                key={`${rule.key}-${idx}`}
                className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <span className="w-6 font-mono text-xs text-slate-500">{idx + 1}.</span>
                <span className="font-medium text-slate-800">{formatRankingKey(rule.key)}</span>
                <span className="ml-auto rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  {formatDirection(rule.direction)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm italic text-slate-400">{t('admin.rulesets.tiebreakersEmpty')}</p>
        )
      ) : (
        <ol className="mb-3 space-y-2">
          {value.map((tb, idx) => (
            <li
              key={idx}
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <span className="w-6 font-mono text-xs text-slate-500">{idx + 1}.</span>

              <select
                value={tb.variable}
                onChange={(e) => update(idx, { variable: e.target.value as VariableKey })}
                disabled={disabled}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              >
                {FORMULA_VARIABLE_KEYS.map((v) => (
                  <option key={v} value={v}>
                    {t(`admin.rulesets.variables.${v}`)}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => update(idx, { direction: tb.direction === 'desc' ? 'asc' : 'desc' })}
                disabled={disabled}
                className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                  tb.direction === 'desc'
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
                } disabled:opacity-50`}
                title={
                  tb.direction === 'desc'
                    ? t('admin.rulesets.directionHighest')
                    : t('admin.rulesets.directionLowest')
                }
              >
                {tb.direction === 'desc'
                  ? `▼ ${t('admin.rulesets.directionHighest')}`
                  : `▲ ${t('admin.rulesets.directionLowest')}`}
              </button>

              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(idx, -1)}
                  disabled={disabled || idx === 0}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                  aria-label={t('admin.rulesets.moveUp')}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(idx, 1)}
                  disabled={disabled || idx === value.length - 1}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                  aria-label={t('admin.rulesets.moveDown')}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  disabled={disabled}
                  className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                  aria-label={t('admin.rulesets.removeTiebreaker')}
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <button
        type="button"
        onClick={add}
        disabled={disabled}
        className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
      >
        + {t('admin.rulesets.addTiebreaker')}
      </button>
    </div>
  );
}
