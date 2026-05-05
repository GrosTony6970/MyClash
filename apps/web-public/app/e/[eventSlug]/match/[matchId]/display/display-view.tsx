'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TournamentScoringConfig } from '@myclash/types';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import { supabase } from '@/lib/supabase';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';

type MatchStatus = 'scheduled' | 'running' | 'paused' | 'completed' | 'voided';

interface DisplayMatch {
  id: string;
  status: MatchStatus;
  matchNumberLabel: string | null;
  redScore: number;
  blueScore: number;
  redFighterName: string | null;
  blueFighterName: string | null;
  rulesetCode: string;
  startedAt: string | null;
  endedAt: string | null;
  lice?: { name?: string } | null;
  event?: { name?: string } | null;
  tournament?: { name?: string; weapon?: string } | null;
  scoringConfig?: TournamentScoringConfig | null;
}

interface Penalty {
  id: string;
  card: 'yellow' | 'red' | 'black';
  registration_id: string;
  short_name: string | null;
  reason: string | null;
  voided: boolean;
}

interface Props {
  apiUrl: string;
  matchId: string;
  initialMatch: DisplayMatch;
  initialPenalties: Penalty[];
  nextMatch?: {
    matchNumberLabel: string | null;
    redFighterName: string | null;
    blueFighterName: string | null;
  } | null;
}

const DISPLAY_COLOR_STYLE = {
  white: '#f8fafc',
  black: '#f8fafc',
  grey: '#cbd5e1',
  yellow: '#facc15',
  red: '#ef4444',
  blue: '#60a5fa',
  green: '#4ade80',
  brown: '#a16207',
  pink: '#f472b6',
  orange: '#fb923c',
  purple: '#c084fc',
} as const;

export function DisplayView({ apiUrl, matchId, initialMatch, initialPenalties, nextMatch }: Props) {
  const { t } = useI18n();
  const [match, setMatch] = useState(initialMatch);
  const [penalties, setPenalties] = useState(initialPenalties);

  const refresh = useCallback(async () => {
    const [matchRes, penaltyRes] = await Promise.all([
      fetch(`${apiUrl}/api/v1/matches/${matchId}/display`, { cache: 'no-store' }),
      fetch(`${apiUrl}/api/v1/matches/${matchId}/penalties`, { cache: 'no-store' }),
    ]);
    if (matchRes.ok) setMatch((await matchRes.json()) as DisplayMatch);
    if (penaltyRes.ok) setPenalties((await penaltyRes.json()) as Penalty[]);
  }, [apiUrl, matchId]);

  useEffect(() => {
    const channel = supabase
      .channel(`match:${matchId}:display`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'exchanges', filter: `match_id=eq.${matchId}` },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_penalties',
          filter: `match_id=eq.${matchId}`,
        },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [matchId, refresh]);

  const activePenalties = penalties.filter((penalty) => !penalty.voided);
  const sideColors =
    match.scoringConfig?.display?.sideColors ?? DEFAULT_SCORING_CONFIG.display.sideColors;

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="flex min-h-screen flex-col px-10 py-8">
        <header className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-red-400">
              {t('scoring.liveMatch.displayTitle')}
            </p>
            <h1 className="mt-2 text-4xl font-black">{match.event?.name ?? 'MyClash'}</h1>
            <p className="mt-2 text-xl text-gray-300">
              {[match.tournament?.name, match.lice?.name, match.matchNumberLabel]
                .filter(Boolean)
                .join(' - ')}
            </p>
          </div>
          <div className="rounded-full border border-white/20 px-5 py-2 text-lg font-bold uppercase">
            {t(`scoring.liveMatch.status.${match.status}`)}
          </div>
        </header>

        <section className="grid flex-1 grid-cols-[1fr_auto_1fr] items-center gap-10">
          <FighterPanel
            color={sideColors.red}
            name={match.redFighterName ?? t('scoring.liveMatch.red')}
            score={match.redScore}
          />
          <div className="text-7xl font-black text-gray-500">-</div>
          <FighterPanel
            color={sideColors.blue}
            name={match.blueFighterName ?? t('scoring.liveMatch.blue')}
            score={match.blueScore}
          />
        </section>

        <footer className="grid grid-cols-2 gap-6 border-t border-white/10 pt-6">
          <div className="flex flex-wrap gap-3">
            {activePenalties.map((penalty) => (
              <span
                key={penalty.id}
                className={`rounded-lg px-4 py-2 text-lg font-black uppercase ${
                  penalty.card === 'yellow'
                    ? 'bg-yellow-400 text-black'
                    : penalty.card === 'red'
                      ? 'bg-red-600 text-white'
                      : 'bg-white text-black'
                }`}
              >
                {penalty.card}
              </span>
            ))}
          </div>
          <div className="text-right text-xl text-gray-300">
            {nextMatch && (
              <>
                <span className="font-bold text-white">{t('scoring.liveMatch.upNext')}</span>
                {' - '}
                {nextMatch.redFighterName ?? t('common.unknown')} {t('scoring.liveMatch.versus')}{' '}
                {nextMatch.blueFighterName ?? t('common.unknown')}
              </>
            )}
          </div>
        </footer>
      </div>
    </main>
  );
}

function FighterPanel({
  color,
  name,
  score,
}: {
  color: keyof typeof DISPLAY_COLOR_STYLE;
  name: string;
  score: number;
}) {
  return (
    <div className="text-center">
      <p className="min-h-24 text-5xl font-black leading-tight">{name}</p>
      <p
        className="mt-10 text-[18rem] font-black leading-none tabular-nums"
        style={{ color: DISPLAY_COLOR_STYLE[color] }}
      >
        {score}
      </p>
    </div>
  );
}
