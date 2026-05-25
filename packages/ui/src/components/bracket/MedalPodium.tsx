import * as React from 'react';
import type { PodiumData, PodiumFighter } from './types';

export interface MedalPodiumProps {
  podium: PodiumData;
  /** When false, bronze and 4th tiles are hidden even if their fighters are provided. */
  showBronze?: boolean;
  /** Optional labels — sourced from i18n by the parent. */
  labels?: {
    gold: string;
    silver: string;
    bronze: string;
    fourth: string;
    tbd: string;
  };
}

const DEFAULT_LABELS = {
  gold: 'Gold Medal',
  silver: 'Silver Medal',
  bronze: 'Bronze Medal',
  fourth: '4th Place',
  tbd: 'TBD',
};

/**
 * Ribbon-style podium — a vertical stack of medal bands placed directly under
 * the Final card. Gold and Silver sit immediately under the Final; the Bronze
 * Match (rendered separately by `BracketView` between Silver and Bronze) feeds
 * Bronze + 4th below it. The ribbons match the mockup's anatomy:
 *
 *   🥇 Gold Medal · Petit
 *   🥈 Silver Medal · Müller
 *   ─── Bronze Match (rendered by BracketView) ───
 *   🥉 Bronze Medal · Dubois
 *   4th Place · Novák
 */
export function MedalPodium({
  podium,
  showBronze = true,
  labels = DEFAULT_LABELS,
}: MedalPodiumProps) {
  return (
    <div className="flex w-full max-w-[260px] flex-col gap-1">
      <Ribbon
        icon="🥇"
        title={labels.gold}
        fighter={podium.gold ?? null}
        tbdLabel={labels.tbd}
        variant="gold"
      />
      <Ribbon
        icon="🥈"
        title={labels.silver}
        fighter={podium.silver ?? null}
        tbdLabel={labels.tbd}
        variant="silver"
      />
      {showBronze && (
        <>
          <Ribbon
            icon="🥉"
            title={labels.bronze}
            fighter={podium.bronze ?? null}
            tbdLabel={labels.tbd}
            variant="bronze"
          />
          <Ribbon
            icon=""
            title={labels.fourth}
            fighter={podium.fourth ?? null}
            tbdLabel={labels.tbd}
            variant="fourth"
          />
        </>
      )}
    </div>
  );
}

type RibbonVariant = 'gold' | 'silver' | 'bronze' | 'fourth';

const VARIANT_CLASSES: Record<RibbonVariant, { bg: string; text: string; border: string }> = {
  gold: {
    bg: 'bg-amber-50',
    text: 'text-amber-900',
    border: 'border border-amber-300',
  },
  silver: {
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border border-slate-300',
  },
  bronze: {
    bg: 'bg-amber-50/70',
    text: 'text-amber-800',
    border: 'border border-amber-600/40',
  },
  fourth: {
    bg: 'bg-white',
    text: 'text-slate-500',
    border: 'border border-dashed border-slate-300',
  },
};

function Ribbon({
  icon,
  title,
  fighter,
  tbdLabel,
  variant,
}: {
  icon: string;
  title: string;
  fighter: PodiumFighter | null;
  tbdLabel: string;
  variant: RibbonVariant;
}) {
  const { bg, text, border } = VARIANT_CLASSES[variant];
  const fighterName = fighter?.fighterName ?? tbdLabel;
  const isTbd = fighter === null;

  return (
    <div className={`flex h-[22px] items-center gap-2 rounded px-3 ${bg} ${border}`} role="status">
      {icon && (
        <span className="text-xs leading-none" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={`text-[10px] font-semibold uppercase tracking-[0.08em] ${text}`}>
        {title}
      </span>
      <span className="text-slate-400" aria-hidden="true">
        ·
      </span>
      <span
        className={[
          'flex-1 truncate text-xs font-medium',
          isTbd ? 'italic text-slate-400' : 'text-slate-900',
        ].join(' ')}
      >
        {fighterName}
      </span>
      {fighter?.clubAbbrev && (
        <span className="shrink-0 rounded bg-white/80 px-1 py-px text-[10px] text-slate-500">
          {fighter.clubAbbrev}
        </span>
      )}
    </div>
  );
}
