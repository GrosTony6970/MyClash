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
  gold: 'Champion',
  silver: 'Runner-up',
  bronze: 'Bronze',
  fourth: '4th place',
  tbd: 'TBD',
};

export function MedalPodium({
  podium,
  showBronze = true,
  labels = DEFAULT_LABELS,
}: MedalPodiumProps) {
  return (
    <div className="flex items-end justify-center gap-4 pt-8">
      <PodiumTile
        title={labels.silver}
        fighter={podium.silver ?? null}
        tbdLabel={labels.tbd}
        bg="bg-slate-100"
        stripe="bg-slate-300"
        text="text-slate-700"
        heightClass="h-[120px]"
        widthClass="w-[140px]"
      />
      <PodiumTile
        title={labels.gold}
        fighter={podium.gold ?? null}
        tbdLabel={labels.tbd}
        bg="bg-amber-100"
        stripe="bg-amber-400"
        text="text-amber-900"
        heightClass="h-[150px]"
        widthClass="w-[160px]"
      />
      {showBronze && (
        <PodiumTile
          title={labels.bronze}
          fighter={podium.bronze ?? null}
          tbdLabel={labels.tbd}
          bg="bg-amber-50"
          stripe="bg-amber-700"
          text="text-amber-800"
          heightClass="h-[110px]"
          widthClass="w-[140px]"
        />
      )}
      {showBronze && (
        <PodiumTile
          title={labels.fourth}
          fighter={podium.fourth ?? null}
          tbdLabel={labels.tbd}
          bg="bg-slate-50"
          stripe="bg-slate-400"
          text="text-slate-600"
          heightClass="h-[100px]"
          widthClass="w-[130px]"
        />
      )}
    </div>
  );
}

function PodiumTile({
  title,
  fighter,
  tbdLabel,
  bg,
  stripe,
  text,
  heightClass,
  widthClass,
}: {
  title: string;
  fighter: PodiumFighter | null;
  tbdLabel: string;
  bg: string;
  stripe: string;
  text: string;
  heightClass: string;
  widthClass: string;
}) {
  return (
    <div className={`flex flex-col items-stretch ${widthClass}`}>
      <div className={`mb-1 h-1 rounded-full ${stripe}`} />
      <div
        className={`flex flex-col items-center justify-center rounded-md px-2 py-3 text-center shadow-sm ${bg} ${heightClass}`}
      >
        <p className={`text-[11px] font-semibold uppercase tracking-wide ${text}`}>{title}</p>
        {fighter ? (
          <>
            <p className="mt-2 text-sm font-semibold text-slate-900">{fighter.fighterName}</p>
            {fighter.clubAbbrev && (
              <p className="mt-0.5 text-[11px] text-slate-500">{fighter.clubAbbrev}</p>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm italic text-slate-400">{tbdLabel}</p>
        )}
      </div>
    </div>
  );
}
