'use client';

import { useEffect, useState } from 'react';
import type {
  DoublePenaltySpec,
  FormulaConstants,
  FormulaNode,
  Target,
  Tiebreaker,
} from '@myclash/rulesets';
import { useI18n } from '../../i18n/I18nProvider';

interface PreviewRow {
  stats: { victories: number; ties: number; losses: number };
  score: number;
}

interface ValidateResponse {
  ok: boolean;
  errors: string[];
  preview: { rows: PreviewRow[]; hasNonFinite: boolean } | null;
}

/**
 * Live validate + preview for the authoring form: debounce-POSTs the current
 * config to /rulesets/validate and shows the sample scores + any problems. The
 * evaluator stays server-side (the reason the old chip never evaluated the AST),
 * so this replaces that placeholder with a real per-fighter preview.
 *
 * All state updates happen in async callbacks (never synchronously in the
 * effect) to satisfy react-hooks/set-state-in-effect.
 */
export function RulesetPreviewPanel({
  validateUrl,
  scoreFormula,
  constants,
  tiebreakers,
  doublePenaltyFormula,
  targets,
}: {
  validateUrl: string;
  scoreFormula: FormulaNode | null;
  constants: FormulaConstants;
  tiebreakers: Tiebreaker[];
  doublePenaltyFormula: DoublePenaltySpec | null;
  targets: Target[];
}) {
  const { t } = useI18n();
  const [result, setResult] = useState<ValidateResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const body = JSON.stringify({
    scoreFormula,
    constants,
    tiebreakers,
    doublePenaltyFormula,
    targets,
  });

  useEffect(() => {
    if (!scoreFormula) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      setLoading(true);
      void fetch(validateUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
        .then((r) => (r.ok ? (r.json() as Promise<ValidateResponse>) : null))
        .then((data) => {
          if (cancelled) return;
          setResult(data);
          setLoading(false);
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [validateUrl, body, scoreFormula]);

  if (!scoreFormula) return null;

  const errors = result?.errors ?? [];
  const rows = result?.preview?.rows ?? [];

  return (
    <div className="mt-3 rounded-md border border-border bg-background p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.srcComponents.rulesetPreviewTitle')}
        </span>
        {loading && (
          <span className="text-xs text-muted">
            {t('admin.srcComponents.rulesetPreviewChecking')}
          </span>
        )}
      </div>

      {errors.length > 0 && (
        <ul className="mt-2 space-y-1">
          {errors.map((error, i) => (
            <li key={i} className="text-xs text-danger">
              {error}
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <ul className="mt-2 space-y-1">
          {rows.map((row, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 text-xs text-foreground-secondary"
            >
              <span>
                {t('admin.srcComponents.rulesetPreviewRow', {
                  n: i + 1,
                  wins: row.stats.victories,
                  ties: row.stats.ties,
                  losses: row.stats.losses,
                })}
              </span>
              <span className="font-mono font-semibold text-foreground">
                {Number.isFinite(row.score) ? row.score.toFixed(2) : '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
