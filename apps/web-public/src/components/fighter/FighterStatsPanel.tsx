'use client';

import { useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import {
  ZERO_WEAPON_STAT,
  matchHemaRating,
  weaponKey,
  type FighterMedal,
  type FighterPlacement,
  type TFn,
  type WeaponStat,
} from '@/lib/weapon-stats';

/** Already-fetched data the panel renders. All three slices are independently
 *  nullable so the panel degrades gracefully when an endpoint is unavailable. */
export interface FighterStatsPanelData {
  fighter: {
    weapons: Array<{
      favorite?: boolean;
      style?: string | null;
      weapon_catalog?: { id?: string | null; slug?: string | null; name?: string | null } | null;
    }>;
    hemaRatingsId: string | null;
    hemaRatings: {
      detailsUrl?: string;
      ratings: Array<{ weapon: string; rank: number | null; weightedRating: number }>;
    } | null;
    medals: FighterMedal[];
  } | null;
  career: {
    stats: { overall: WeaponStat; byWeapon: Array<WeaponStat & { weapon: string }> };
    tournamentPlacements: FighterPlacement[];
  } | null;
  refereeStats: {
    totalMatches: number;
    averageRefereeTimeMs: number;
    eventsWorked: number;
    cards: { yellow: number; red: number; black: number };
  } | null;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <p className="text-[11px] uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-1 text-base font-black tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function formatDuration(ms: number, t: TFn): string {
  if (ms <= 0) return t('common.none');
  return t('publicApp.fighterProfile.minutes', { count: Math.round(ms / 60000) });
}

/**
 * The weapon-aware fighter stats view shared by the public fighter page and the
 * group member cards. A "Global" + per-weapon pill row re-scopes the combat
 * tiles, medals, HEMA rank and double-hit %; favorite weapon, the weapon list
 * and the referee block are weapon-independent.
 */
export function FighterStatsPanel({ fighter, career, refereeStats }: FighterStatsPanelData) {
  const { t } = useI18n();
  const [statTab, setStatTab] = useState<string>('global');

  const overall = career?.stats.overall ?? ZERO_WEAPON_STAT;
  const byWeapon = career?.stats.byWeapon ?? [];
  const fought = byWeapon.filter((w) => w.matches > 0);
  const manualMedals = fighter?.medals ?? [];
  const weapons = fighter?.weapons ?? [];
  const placementsAll = career?.tournamentPlacements ?? [];

  // Pill options: the union of weapons fought, weapons with only imported medals,
  // and weapons selected in the profile — deduped by normalized key, first label wins.
  const weaponOptions = (() => {
    const byKey = new Map<string, string>();
    const add = (label: string | null | undefined) => {
      if (!label) return;
      const key = weaponKey(label);
      if (key && !byKey.has(key)) byKey.set(key, label);
    };
    for (const w of fought) add(w.weapon);
    for (const m of manualMedals) add(m.weapon);
    for (const link of weapons) add(link.weapon_catalog?.name);
    return [...byKey.entries()].map(([key, label]) => ({ key, label }));
  })();

  // A weapon selected in the profile but never fought shows zeroed combat stats.
  const active =
    statTab === 'global'
      ? overall
      : (fought.find((w) => weaponKey(w.weapon) === statTab) ?? ZERO_WEAPON_STAT);

  const winRate =
    active.matches === 0 ? '—' : `${Math.round((active.wins / active.matches) * 100)}%`;

  // Podium medals (earned placements + imported), scoped to the selected weapon.
  const placements = placementsAll.filter(
    (p) =>
      p.place != null &&
      (statTab === 'global' || (p.weapon != null && weaponKey(p.weapon) === statTab)),
  );
  const scopedManual =
    statTab === 'global'
      ? manualMedals
      : manualMedals.filter((m) => weaponKey(m.weapon) === statTab);
  const medals = {
    gold:
      placements.filter((p) => p.place === 1).length +
      scopedManual.filter((m) => m.rank === 1).length,
    silver:
      placements.filter((p) => p.place === 2).length +
      scopedManual.filter((m) => m.rank === 2).length,
    bronze:
      placements.filter((p) => p.place === 3).length +
      scopedManual.filter((m) => m.rank === 3).length,
  };
  const hasMedals = medals.gold + medals.silver + medals.bronze > 0;

  // HEMA rank re-scopes with the weapon; on Global we surface the top-rated one.
  const ratings = fighter?.hemaRatings?.ratings ?? [];
  const hema =
    statTab === 'global'
      ? ratings.length > 0
        ? [...ratings].sort((a, b) => b.weightedRating - a.weightedRating)[0]
        : null
      : matchHemaRating(statTab, ratings);
  const hemaHref =
    fighter?.hemaRatings?.detailsUrl ??
    (fighter?.hemaRatingsId
      ? `https://hemaratings.com/fighters/details/${fighter.hemaRatingsId}/`
      : null);

  return (
    <div className="space-y-3">
      {weaponOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {[
            { key: 'global', label: t('publicApp.fighterProfile.statsGlobalTab') },
            ...weaponOptions,
          ].map((opt) => {
            const isActive = statTab === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setStatTab(opt.key)}
                aria-pressed={isActive}
                className={[
                  'min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors [touch-action:manipulation]',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'border border-border text-muted hover:text-foreground',
                ].join(' ')}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t('publicApp.fighterProfile.matches')} value={active.matches} />
        <Stat label={t('publicApp.fighterProfile.totalWins')} value={active.wins} />
        <Stat label={t('publicApp.fighterProfile.totalLosses')} value={active.losses} />
        <Stat label={t('publicApp.fighterProfile.winRate')} value={winRate} />
      </div>

      {hasMedals && (
        <div className="rounded-lg border border-border bg-background px-3 py-3">
          <p className="text-[11px] uppercase tracking-widest text-muted">
            {t('publicApp.fighterProfile.medals')}
          </p>
          <div className="mt-1 flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="text-lg leading-none">
                🥇
              </span>
              <span className="text-xl font-black tabular-nums text-foreground">{medals.gold}</span>
              <span className="sr-only">{t('publicApp.fighterProfile.medalsGold')}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="text-lg leading-none">
                🥈
              </span>
              <span className="text-xl font-black tabular-nums text-foreground">
                {medals.silver}
              </span>
              <span className="sr-only">{t('publicApp.fighterProfile.medalsSilver')}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="text-lg leading-none">
                🥉
              </span>
              <span className="text-xl font-black tabular-nums text-foreground">
                {medals.bronze}
              </span>
              <span className="sr-only">{t('publicApp.fighterProfile.medalsBronze')}</span>
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border bg-background px-3 py-2">
          <p className="text-[11px] uppercase tracking-widest text-muted">
            {t('publicApp.fighterProfile.hemaRank')}
          </p>
          {hema != null ? (
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-base font-black tabular-nums text-foreground">
                {hema.rank != null ? `#${hema.rank}` : '—'}
              </span>
              <span className="text-xs text-muted">
                {t('publicApp.fighterProfile.hemaRatingValue', {
                  rating: Math.round(hema.weightedRating),
                })}
              </span>
              {hemaHref && (
                <a
                  href={hemaHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('publicApp.fighterProfile.hemaProfileLink')}
                  className="ml-auto text-xs font-semibold text-accent hover:underline"
                >
                  ↗
                </a>
              )}
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted">
              {ratings.length === 0
                ? t('publicApp.fighterProfile.hemaNotLinked')
                : t('publicApp.fighterProfile.hemaNoWeaponRating')}
            </p>
          )}
        </div>
        <Stat
          label={t('publicApp.fighterProfile.doubleHitPercentage')}
          value={`${active.doubleHitPercentage.toFixed(2)}%`}
        />
      </div>

      {weapons.length > 0 && (
        <div className="rounded-lg border border-border bg-background px-3 py-3">
          <p className="mb-2 text-[11px] uppercase tracking-widest text-muted">
            {t('publicApp.fighterProfile.weapons')}
          </p>
          <div className="flex flex-wrap gap-2">
            {weapons.map((w, i) => {
              const name = w.weapon_catalog?.name;
              if (!name) return null;
              return (
                <span
                  key={w.weapon_catalog?.id ?? w.weapon_catalog?.slug ?? `${name}-${i}`}
                  className={[
                    'rounded-full border px-2.5 py-1 text-xs',
                    w.favorite ? 'border-accent/60 text-accent' : 'border-border text-foreground',
                  ].join(' ')}
                >
                  {w.favorite ? '★ ' : ''}
                  {name}
                  {w.style && <span className="ml-1 italic opacity-70">· {w.style}</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {refereeStats && refereeStats.totalMatches > 0 && (
        <div className="border-t border-border pt-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.fighterProfile.refereeing')}
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat
              label={t('publicApp.fighterProfile.refereeMatches')}
              value={refereeStats.totalMatches}
            />
            <Stat
              label={t('publicApp.fighterProfile.averageRefereeTime')}
              value={formatDuration(refereeStats.averageRefereeTimeMs, t)}
            />
            <Stat
              label={t('publicApp.fighterProfile.eventsWorked')}
              value={refereeStats.eventsWorked}
            />
            <Stat
              label={t('publicApp.fighterProfile.yellowCards')}
              value={refereeStats.cards.yellow}
            />
            <Stat
              label={t('publicApp.fighterProfile.redBlackCards')}
              value={`${refereeStats.cards.red}/${refereeStats.cards.black}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
