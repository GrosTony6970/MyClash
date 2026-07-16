'use client';

import { useI18n } from '../../i18n/I18nProvider';

interface Props {
  name?: string;
  code?: string;
  version?: string;
  description?: string | null;
  pointsByRank: Record<string, number>;
  tieBreakers: string[];
  className?: string;
}

/**
 * Read-only display of a league scoring system: points-by-rank table +
 * tie-breakers list + description. Used by the form's built-in
 * read-only banner, the version-history modal, and the leagues-edit
 * inline preview panel.
 */
export function ScoringSystemPreview({
  name,
  code,
  version,
  description,
  pointsByRank,
  tieBreakers,
  className,
}: Props) {
  const { t } = useI18n();

  const ranks = Object.keys(pointsByRank)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);

  if (ranks.length === 0 && tieBreakers.length === 0 && !description) {
    return (
      <div
        className={[
          'rounded-md border border-border bg-background px-4 py-3 text-sm text-muted',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {t('admin.rulesets.league.preview.empty')}
      </div>
    );
  }

  return (
    <div
      className={['rounded-md border border-border bg-surface p-4', className]
        .filter(Boolean)
        .join(' ')}
    >
      {(name || code || version) && (
        <div className="mb-3 flex flex-wrap items-baseline gap-2">
          {name && <span className="text-sm font-semibold text-foreground">{name}</span>}
          {code && <span className="font-mono text-xs text-muted">{code}</span>}
          {version && (
            <span className="rounded-full bg-background px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground-secondary">
              {t('admin.adminRulesetsReview.versionLabel', { version })}
            </span>
          )}
        </div>
      )}

      {description && <p className="mb-3 text-sm text-foreground-secondary">{description}</p>}

      {ranks.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('admin.rulesets.league.preview.ranksHeader')}
          </p>
          <div className="grid grid-cols-4 gap-1 sm:grid-cols-8">
            {ranks.map((rank) => (
              <div
                key={rank}
                className="rounded border border-border px-2 py-1 text-center text-xs"
              >
                <span className="block text-[10px] text-muted">#{rank}</span>
                <span className="block font-mono text-sm font-semibold text-foreground">
                  {pointsByRank[String(rank)]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tieBreakers.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('admin.rulesets.league.preview.tieBreakersHeader')}
          </p>
          <ol className="list-decimal space-y-0.5 pl-5 text-sm text-foreground-secondary">
            {tieBreakers.map((tb) => (
              <li key={tb}>{tieBreakerLabel(t, tb)}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function tieBreakerLabel(t: (key: string) => string, code: string): string {
  // The i18n object lookup pattern — keys live under
  // admin.rulesets.league.form.tieBreakerLabels.{total_points|...}
  return t(`admin.rulesets.league.form.tieBreakerLabels.${code}`);
}
