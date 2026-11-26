'use client';

import { PointValueBar, type Translator } from '@myclash/ui';
import type { WeaponTargetStats } from './types';

function weaponLabel(weapon: string | null, t: Translator): string {
  return weapon ?? t('organizer.eventStats.pointDistribution.noWeapon');
}

// ── Deep-target hunters (top 5 per weapon) ──────────────────────────────────
function HuntersCard({ w, t }: { w: WeaponTargetStats; t: Translator }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h5 className="font-display text-base font-semibold capitalize text-foreground">
        {weaponLabel(w.weapon, t)}
      </h5>
      <p className="mb-3 text-xs text-muted">
        {t('organizer.eventStats.deepTargets.caption', { points: w.maxValue ?? 0 })}
      </p>
      {w.hunters.length === 0 ? (
        <p className="text-sm text-muted">{t('organizer.eventStats.deepTargets.empty')}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {w.hunters.map((h, i) => (
            <div
              key={h.personId}
              className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2"
            >
              <span className="w-4 text-right text-sm font-bold text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{h.name}</span>
                {h.club ? (
                  <span className="block truncate text-xs text-muted">{h.club}</span>
                ) : null}
              </span>
              <span className="font-mono text-sm font-bold text-foreground">{h.cleanHits}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 1pt / 2pt / 3pt distribution bar (per weapon) ───────────────────────────
function DistributionCard({ w, t }: { w: WeaponTargetStats; t: Translator }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h5 className="mb-3 font-display text-base font-semibold capitalize text-foreground">
        {weaponLabel(w.weapon, t)}
      </h5>
      <PointValueBar distribution={w.distribution} t={t} />
    </div>
  );
}

/**
 * Event-level, per-weapon comparison: "deep-target hunters" (top-5 by clean hits
 * at the ruleset's highest point value) + the 1pt/2pt(/3pt) point distribution.
 * Weapons render side-by-side. Renders nothing when there's no clean-hit data.
 */
export function WeaponPointStatsSection({
  breakdown,
  t,
}: {
  breakdown: WeaponTargetStats[];
  t: Translator;
}) {
  if (breakdown.length === 0) return null;
  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('organizer.eventStats.deepTargets.title')}
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {breakdown.map((w) => (
            <HuntersCard key={w.weapon ?? '__none__'} w={w} t={t} />
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('organizer.eventStats.pointDistribution.title')}
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {breakdown.map((w) => (
            <DistributionCard key={w.weapon ?? '__none__'} w={w} t={t} />
          ))}
        </div>
      </section>
    </div>
  );
}
