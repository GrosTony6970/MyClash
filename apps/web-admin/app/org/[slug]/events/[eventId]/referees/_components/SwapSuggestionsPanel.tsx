'use client';

/**
 * SwapSuggestionsPanel — R4 of the Staffing overhaul.
 *
 * The engine's `swapSuggestions[]` carries proposals like "swap A → B
 * to break a back-to-back chain on Pool X". This panel surfaces them
 * in a dedicated card below the assignment table, with one-click apply.
 *
 * Apply semantics: a swap is implemented as unassign-then-assign. We
 * do both in sequence inside `onApply` (caller-supplied) and refresh
 * the board afterwards. If the unassign succeeds but the assign fails,
 * the slot ends up empty — the operator sees the failure toast and
 * can retry manually. This is the same risk model as any two-step
 * mutation in the codebase; we don't add a transactional shim for it
 * because the failure rate is low and the recovery is trivial.
 *
 * Empty-state: when there are zero suggestions, the panel renders
 * nothing at all (no empty card, no heading). This keeps the
 * Assignments / Referees tabs clean when everything is fine.
 */

import { t } from '@myclash/i18n';

export interface SwapSuggestion {
  fromPoolId: string;
  fromSlotIndex: number;
  fromPersonId: string;
  fromPersonName: string;
  toPersonId: string;
  toPersonName: string;
  reason: 'breaks_back_to_back';
  detail: string;
}

interface Props {
  suggestions: SwapSuggestion[];
  isReadOnly: boolean;
  busy?: boolean;
  onApply: (suggestion: SwapSuggestion) => void | Promise<void>;
}

export function SwapSuggestionsPanel({ suggestions, isReadOnly, busy, onApply }: Props) {
  if (suggestions.length === 0) return null;

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
      <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-amber-800">
        {t('organizer.refereesPage.swapSuggestionsTitle')}
      </h3>
      <p className="mb-3 text-xs text-amber-700">
        {t('organizer.refereesPage.swapSuggestionsHelp', { count: suggestions.length })}
      </p>
      <ul className="space-y-1.5">
        {suggestions.map((s) => (
          <li
            key={`${s.fromPoolId}:${s.fromSlotIndex}:${s.fromPersonId}:${s.toPersonId}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <p className="text-gray-900">
                <span className="font-semibold">{s.fromPersonName}</span>
                <span className="mx-1 text-gray-400">→</span>
                <span className="font-semibold text-emerald-700">{s.toPersonName}</span>
              </p>
              <p className="text-xs text-gray-500">{s.detail}</p>
            </div>
            <button
              type="button"
              disabled={isReadOnly || busy}
              onClick={() => void onApply(s)}
              className="rounded border border-amber-600 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy
                ? t('organizer.refereesPage.swapApplying')
                : t('organizer.refereesPage.swapApply')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
