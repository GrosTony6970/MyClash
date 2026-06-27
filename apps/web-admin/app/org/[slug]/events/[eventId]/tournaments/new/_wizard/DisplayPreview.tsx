'use client';

/* eslint-disable myclash/no-literal-string */

/**
 * Live sample for step-3 "Display": a compact mock scoreboard + scoring
 * buttons reflecting the chosen side colours, visible buttons and logo, so
 * the operator sees what it'll look like. Pure/presentational — reuses the
 * scoreboard palette via `displayPreviewModel` (sideStyle).
 */

import { t } from '@myclash/i18n';
import type { SideColorStyle } from '@myclash/ui';
import { displayPreviewModel } from './display-preview-model';
import type { DisplayState } from './buildDisplayConfigFromRow';

function FighterPanel({
  style,
  name,
  score,
}: {
  style: SideColorStyle;
  name: string;
  score: number;
}) {
  return (
    <div
      className="rounded-lg border-2 p-2 text-center"
      style={{ backgroundColor: style.panel, borderColor: style.border }}
    >
      <p
        className="truncate text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: style.muted }}
      >
        {name}
      </p>
      <p className="text-3xl font-black tabular-nums" style={{ color: style.text }}>
        {score}
      </p>
    </div>
  );
}

export function DisplayPreview({
  data,
  logoUrl,
  rulesetCode,
}: {
  data: DisplayState;
  logoUrl: string | null;
  rulesetCode: string;
}) {
  const m = displayPreviewModel({
    sideColors: data.sideColors,
    buttons: data.buttons,
    rulesetCode,
  });

  return (
    <aside className="mt-6 lg:mt-0 lg:sticky lg:top-6 lg:self-start">
      <p className="mb-2 text-xs font-medium text-foreground-secondary">
        {t('organizer.tournaments.wizard.displayPreviewTitle')}
      </p>
      <div className="rounded-xl border border-slate-200 bg-slate-900 p-3 shadow-sm">
        {logoUrl && (
          <div className="mb-2 flex justify-center">
            <img src={logoUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
          </div>
        )}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <FighterPanel
            style={m.red}
            name={t('organizer.tournaments.settings.sideFighter1')}
            score={3}
          />
          <span className="text-xs font-bold text-slate-400">VS</span>
          <FighterPanel
            style={m.blue}
            name={t('organizer.tournaments.settings.sideFighter2')}
            score={2}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {m.cleanButtons.map((b, i) => (
            <span
              key={`c${i}`}
              className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-100"
            >
              {b.label} (+{b.value})
            </span>
          ))}
          {m.afterblowButtons.map((b, i) => (
            <span
              key={`a${i}`}
              className="rounded border border-amber-600/60 bg-amber-900/30 px-2 py-1 text-[11px] font-semibold text-amber-200"
            >
              {b.label} {b.attackerPts}-{b.defenderPts}
            </span>
          ))}
        </div>
      </div>
    </aside>
  );
}
