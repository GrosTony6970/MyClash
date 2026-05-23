'use client';

import { useI18n } from '../../i18n/I18nProvider';

type PenaltyCard = 'yellow' | 'red' | 'black';

export interface PenaltyEntryDraft {
  groupNumber: number;
  refNumber: number;
  shortName: string;
  description: string;
  sanctions: PenaltyCard[];
}

interface Props {
  value: PenaltyEntryDraft[];
  disabled?: boolean;
  onChange: (entries: PenaltyEntryDraft[]) => void;
}

const CARD_ORDER: PenaltyCard[] = ['yellow', 'red', 'black'];

const CARD_CLASSES: Record<PenaltyCard, { active: string; inactive: string }> = {
  yellow: {
    active: 'bg-yellow-300 text-yellow-900 ring-yellow-500',
    inactive: 'bg-yellow-100/50 text-yellow-700/60',
  },
  red: {
    active: 'bg-red-500 text-white ring-red-700',
    inactive: 'bg-red-100/50 text-red-600/60',
  },
  black: {
    active: 'bg-slate-900 text-white ring-slate-900',
    inactive: 'bg-slate-300/40 text-slate-500/60',
  },
};

/**
 * Editable list of penalty ruleset entries. Each row binds to one
 * `penalty_ruleset_entries` record. Sanctions are an ordered list of card
 * colours — the first item is what gets recorded on the first offense, the
 * second on the second offense, etc. (See `computePenaltySanction` in
 * @myclash/rulesets for the runtime semantics.)
 */
export function PenaltyEntriesEditor({ value, disabled, onChange }: Props) {
  const { t } = useI18n();

  function update(index: number, patch: Partial<PenaltyEntryDraft>) {
    const next = value.slice();
    const existing = next[index];
    if (!existing) return;
    next[index] = { ...existing, ...patch };
    onChange(next);
  }

  function addRow() {
    if (disabled) return;
    onChange([
      ...value,
      {
        groupNumber: 1,
        refNumber: value.length + 1,
        shortName: '',
        description: '',
        sanctions: ['yellow'],
      },
    ]);
  }

  function removeRow(index: number) {
    if (disabled) return;
    onChange(value.filter((_, i) => i !== index));
  }

  function appendSanction(index: number, card: PenaltyCard) {
    const entry = value[index];
    if (!entry) return;
    update(index, { sanctions: [...entry.sanctions, card] });
  }

  function popSanction(index: number) {
    const entry = value[index];
    if (!entry || entry.sanctions.length === 0) return;
    update(index, { sanctions: entry.sanctions.slice(0, -1) });
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="w-16 px-3 py-2">{t('admin.penaltyRulesets.colGroup')}</th>
              <th className="w-16 px-3 py-2">{t('admin.penaltyRulesets.colRef')}</th>
              <th className="w-48 px-3 py-2">{t('admin.penaltyRulesets.colShortName')}</th>
              <th className="px-3 py-2">{t('admin.penaltyRulesets.colDescription')}</th>
              <th className="w-64 px-3 py-2">{t('admin.penaltyRulesets.colSanctions')}</th>
              <th className="w-12 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {value.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-sm italic text-slate-400">
                  {t('admin.penaltyRulesets.entriesEmpty')}
                </td>
              </tr>
            ) : (
              value.map((entry, idx) => (
                <tr key={idx} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={1}
                      value={entry.groupNumber}
                      disabled={disabled}
                      onChange={(e) => update(idx, { groupNumber: Number(e.target.value) || 1 })}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-sm disabled:bg-slate-100"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={1}
                      value={entry.refNumber}
                      disabled={disabled}
                      onChange={(e) => update(idx, { refNumber: Number(e.target.value) || 1 })}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-sm disabled:bg-slate-100"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={entry.shortName}
                      disabled={disabled}
                      onChange={(e) => update(idx, { shortName: e.target.value })}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={entry.description}
                      disabled={disabled}
                      onChange={(e) => update(idx, { description: e.target.value })}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {entry.sanctions.map((card, sIdx) => (
                        <span
                          key={sIdx}
                          className={`inline-block h-5 w-3 rounded-sm ring-1 ${CARD_CLASSES[card].active}`}
                          title={`#${sIdx + 1}: ${card}`}
                        />
                      ))}
                      {entry.sanctions.length === 0 && (
                        <span className="text-xs italic text-slate-400">
                          {t('admin.penaltyRulesets.sanctionsEmpty')}
                        </span>
                      )}
                      <div className="ml-2 flex gap-1">
                        {CARD_ORDER.map((card) => (
                          <button
                            key={card}
                            type="button"
                            onClick={() => appendSanction(idx, card)}
                            disabled={disabled}
                            className={`rounded px-1.5 py-0.5 text-xs font-mono ${CARD_CLASSES[card].active} hover:opacity-80 disabled:opacity-40`}
                            title={t('admin.penaltyRulesets.appendSanction').replace(
                              '{card}',
                              card,
                            )}
                          >
                            +{card.charAt(0).toUpperCase()}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => popSanction(idx)}
                          disabled={disabled || entry.sanctions.length === 0}
                          className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                          title={t('admin.penaltyRulesets.popSanction')}
                        >
                          −
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      disabled={disabled}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                      title={t('admin.penaltyRulesets.removeEntry')}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-slate-200 p-2">
        <button
          type="button"
          onClick={addRow}
          disabled={disabled}
          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          + {t('admin.penaltyRulesets.addEntry')}
        </button>
      </div>
    </div>
  );
}
