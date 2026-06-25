import * as React from 'react';
import type { PodiumData, PodiumFighter } from './types';

export interface MedalPodiumProps {
  podium: PodiumData;
  /** When false, bronze and 4th tiles are hidden even if their fighters are provided. */
  showBronze?: boolean;
  /** Optional labels — sourced from i18n by the parent. */
  labels?: {
    title: string;
    gold: string;
    silver: string;
    bronze: string;
    fourth: string;
    tbd: string;
  };
}

const DEFAULT_LABELS = {
  title: 'Podium',
  gold: 'Gold Medal',
  silver: 'Silver Medal',
  bronze: 'Bronze Medal',
  fourth: '4th Place',
  tbd: 'TBD',
};

/**
 * Three-step podium with gold centred (tallest), silver left, bronze right.
 * 4th place renders as a flat ribbon below the podium. When `showBronze`
 * is false (no bronze match wired up), the bronze step and 4th ribbon are
 * both hidden — matching the partial-bracket display path.
 */
export function MedalPodium({
  podium,
  showBronze = true,
  labels = DEFAULT_LABELS,
}: MedalPodiumProps) {
  return (
    <div className="w-full">
      <h3 className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
        {labels.title}
      </h3>
      <div className="mx-auto flex w-fit items-end justify-center gap-3">
        <Step
          icon="🥈"
          fighter={podium.silver ?? null}
          tbdLabel={labels.tbd}
          variant="silver"
          heightClass="h-[72px]"
        />
        <Step
          icon="🥇"
          fighter={podium.gold ?? null}
          tbdLabel={labels.tbd}
          variant="gold"
          heightClass="h-[96px]"
        />
        {showBronze && (
          <Step
            icon="🥉"
            fighter={podium.bronze ?? null}
            tbdLabel={labels.tbd}
            variant="bronze"
            heightClass="h-[56px]"
          />
        )}
      </div>
      {showBronze && (
        <div className="mx-auto mt-3 w-full max-w-[360px]">
          <Ribbon
            icon=""
            title={labels.fourth}
            fighter={podium.fourth ?? null}
            tbdLabel={labels.tbd}
            variant="fourth"
          />
        </div>
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

const STEP_TOP_BORDER: Record<Exclude<RibbonVariant, 'fourth'>, string> = {
  gold: 'border-t-2 border-t-amber-400',
  silver: 'border-t-2 border-t-slate-400',
  bronze: 'border-t-2 border-t-amber-700/60',
};

function Step({
  icon,
  fighter,
  tbdLabel,
  variant,
  heightClass,
}: {
  icon: string;
  fighter: PodiumFighter | null;
  tbdLabel: string;
  variant: Exclude<RibbonVariant, 'fourth'>;
  heightClass: string;
}) {
  const { bg, border } = VARIANT_CLASSES[variant];
  const topBorder = STEP_TOP_BORDER[variant];
  const fighterName = fighter?.fighterName ?? tbdLabel;
  const isTbd = fighter === null;

  return (
    <div className="flex w-[120px] flex-col items-center" role="status">
      <span className="mb-1 text-2xl leading-none" aria-hidden="true">
        {icon}
      </span>
      <div
        className={`flex w-full items-end justify-center rounded-t-md ${bg} ${border} ${topBorder} ${heightClass}`}
      />
      {/* Reserve ~2 lines so the full name can wrap without truncation while the
          podium bars stay aligned (items-end on the row). */}
      <div className="mt-2 flex min-h-[2.5em] w-full items-start justify-center px-0.5 text-xs">
        <span
          className={[
            'text-center font-semibold leading-tight break-words',
            isTbd ? 'italic text-slate-400' : 'text-slate-900',
          ].join(' ')}
        >
          {fighterName}
        </span>
      </div>
      {fighter?.clubAbbrev && (
        <span className="mt-1 rounded bg-slate-100 px-1.5 py-px text-[10px] text-slate-500">
          {fighter.clubAbbrev}
        </span>
      )}
    </div>
  );
}

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
    <div
      className={`flex min-h-[22px] items-center gap-2 rounded px-3 py-1 ${bg} ${border}`}
      role="status"
    >
      {icon && (
        <span className="text-xs leading-none" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] ${text}`}>
        {title}
      </span>
      <span className="shrink-0 text-slate-400" aria-hidden="true">
        ·
      </span>
      <span
        className={[
          'min-w-0 flex-1 text-xs font-medium leading-tight break-words',
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
