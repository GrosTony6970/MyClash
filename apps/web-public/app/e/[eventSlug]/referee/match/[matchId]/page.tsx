'use client';

/**
 * On-piste referee tools — T-910
 * Route: /e/[eventSlug]/referee/match/[matchId]
 *
 * AC:
 *   ✓ Halt/resume creates match_events rows
 *   ✓ Warning recorded with target fighter and reason
 *   ✓ "Attention" creates notification visible on scoring tablet
 *   ✓ Role-based action visibility
 */

import { useEffect, useState } from 'react';
import { getApiUrl } from '@/lib/api-url';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface MatchInfo {
  id: string;
  matchNumberLabel: string;
  status: string;
  redFighterName: string | null;
  blueFighterName: string | null;
  redRegistrationId: string;
  blueRegistrationId: string;
  redScore: number;
  blueScore: number;
}

interface RefereeContext {
  role: string;
  assignmentId: string;
}

type WarningReason =
  | 'unsportsmanlike_conduct'
  | 'illegal_technique'
  | 'equipment_violation'
  | 'excessive_force'
  | 'other';

const WARNING_REASONS: { id: WarningReason; label: string }[] = [
  { id: 'unsportsmanlike_conduct', label: 'Unsportsmanlike conduct' },
  { id: 'illegal_technique', label: 'Illegal technique' },
  { id: 'equipment_violation', label: 'Equipment violation' },
  { id: 'excessive_force', label: 'Excessive force' },
  { id: 'other', label: 'Other' },
];

export default function RefereeMatchPage() {
  const params = useParams<{ eventSlug: string; matchId: string }>();
  const { eventSlug, matchId } = params;
  const apiUrl = getApiUrl();

  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [refereeCtx, setRefereeCtx] = useState<RefereeContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  // Warning modal
  const [showWarning, setShowWarning] = useState(false);
  const [warningTarget, setWarningTarget] = useState<'red' | 'blue'>('red');
  const [warningReason, setWarningReason] = useState<WarningReason>('unsportsmanlike_conduct');
  const [warningNote, setWarningNote] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/matches/${matchId}`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/matches/${matchId}/my-referee-context`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([matchRes, ctxRes]) => {
        setLoading(false);
        if (matchRes.ok) setMatch((await matchRes.json()) as MatchInfo);
        if (ctxRes.ok) setRefereeCtx((await ctxRes.json()) as RefereeContext);
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [matchId, apiUrl]);

  async function clockAction(action: 'halt' | 'resume') {
    setActing(true);
    try {
      await fetch(`${apiUrl}/api/v1/matches/${matchId}/clock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action }),
      });
      // Refresh match
      const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}`, { credentials: 'include' });
      if (res.ok) setMatch((await res.json()) as MatchInfo);
    } finally {
      setActing(false);
    }
  }

  async function issueWarning() {
    if (!match) return;
    setActing(true);
    try {
      const targetRegistrationId =
        warningTarget === 'red' ? match.redRegistrationId : match.blueRegistrationId;

      await fetch(`${apiUrl}/api/v1/matches/${matchId}/warnings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          targetRegistrationId,
          reason: warningReason,
          note: warningNote.trim() || null,
          issuedByRole: refereeCtx?.role ?? 'unknown',
        }),
      });
      setShowWarning(false);
      setWarningNote('');
    } finally {
      setActing(false);
    }
  }

  async function requestAttention() {
    setActing(true);
    try {
      await fetch(`${apiUrl}/api/v1/matches/${matchId}/attention`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: 'Referee requests attention', role: refereeCtx?.role }),
      });
    } finally {
      setActing(false);
    }
  }

  const isDeclarant = refereeCtx?.role === 'arbitre_declarant';
  const isTable = refereeCtx?.role === 'arbitre_table';

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (!match) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <p className="text-4xl mb-3">⚔️</p>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Match not found</h1>
          <Link href={`/e/${eventSlug}/referee`} className="text-sm text-gray-500 hover:underline">
            ← Back to duties
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="px-4 py-6 max-w-md mx-auto">
      {/* Back */}
      <Link
        href={`/e/${eventSlug}/referee`}
        className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block"
      >
        ← Referee duties
      </Link>

      {/* Match header */}
      <div className="mb-4">
        <h1
          className="text-xl font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--event-primary, #c0392b)' }}
        >
          {match.matchNumberLabel}
        </h1>
        {refereeCtx && (
          <p className="text-sm text-gray-500 mt-0.5">
            Your role: <strong>{refereeCtx.role.replace(/_/g, ' ')}</strong>
          </p>
        )}
      </div>

      {/* Scoreboard */}
      <div className="grid grid-cols-3 items-center gap-3 mb-6">
        <div className="text-center">
          <div className="bg-red-950 border-2 border-red-700 rounded-xl p-3">
            <p className="text-xs text-red-300 font-bold uppercase mb-0.5">Rouge</p>
            <p className="font-bold text-white text-sm leading-tight">
              {match.redFighterName ?? '?'}
            </p>
          </div>
          <p className="text-4xl font-black text-red-400 mt-2 tabular-nums">{match.redScore}</p>
        </div>
        <div className="text-center">
          <p className="text-gray-500 text-xl font-bold">VS</p>
          <p className="text-xs text-gray-600 mt-1 uppercase tracking-widest">{match.status}</p>
        </div>
        <div className="text-center">
          <div className="bg-blue-950 border-2 border-blue-700 rounded-xl p-3">
            <p className="text-xs text-blue-300 font-bold uppercase mb-0.5">Bleu</p>
            <p className="font-bold text-white text-sm leading-tight">
              {match.blueFighterName ?? '?'}
            </p>
          </div>
          <p className="text-4xl font-black text-blue-400 mt-2 tabular-nums">{match.blueScore}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3">
        {/* Halt/Resume — all referees */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => void clockAction('halt')}
            disabled={acting || match.status !== 'running'}
            className="py-4 rounded-xl font-bold text-lg bg-yellow-700 hover:bg-yellow-600 text-white disabled:opacity-40 transition-colors"
          >
            Halt
          </button>
          <button
            onClick={() => void clockAction('resume')}
            disabled={acting || match.status !== 'halted'}
            className="py-4 rounded-xl font-bold text-lg bg-green-700 hover:bg-green-600 text-white disabled:opacity-40 transition-colors"
          >
            Resume
          </button>
        </div>

        {/* Warning — declarant only */}
        {isDeclarant && (
          <button
            onClick={() => setShowWarning(true)}
            disabled={acting}
            className="py-3 rounded-xl font-bold text-base bg-orange-700 hover:bg-orange-600 text-white disabled:opacity-40 transition-colors"
          >
            Issue Warning
          </button>
        )}

        {/* Attention — all referees */}
        <button
          onClick={() => void requestAttention()}
          disabled={acting}
          className="py-3 rounded-xl font-bold text-base border-2 border-gray-600 text-gray-300 hover:border-gray-400 disabled:opacity-40 transition-colors"
        >
          🔔 Request Attention
        </button>

        {/* Table-specific tools */}
        {isTable && (
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 text-sm text-gray-400">
            <p className="font-medium text-gray-300 mb-1">Scoring oversight</p>
            <p className="text-xs">
              Monitor exchange entries on the scoring tablet. Use Request Attention if a correction
              is needed.
            </p>
          </div>
        )}
      </div>

      {/* Warning modal */}
      {showWarning && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-5">
            <h2 className="text-lg font-bold text-white mb-4">Issue Warning</h2>

            {/* Target */}
            <div className="mb-4">
              <p className="text-xs text-gray-400 mb-2">Target fighter</p>
              <div className="grid grid-cols-2 gap-2">
                {(['red', 'blue'] as const).map((color) => (
                  <button
                    key={color}
                    onClick={() => setWarningTarget(color)}
                    className={[
                      'py-2 rounded-lg font-semibold text-sm border-2 transition-colors',
                      warningTarget === color
                        ? color === 'red'
                          ? 'border-red-500 bg-red-900 text-red-200'
                          : 'border-blue-500 bg-blue-900 text-blue-200'
                        : 'border-gray-700 text-gray-400',
                    ].join(' ')}
                  >
                    {color === 'red'
                      ? (match.redFighterName ?? 'Rouge')
                      : (match.blueFighterName ?? 'Bleu')}
                  </button>
                ))}
              </div>
            </div>

            {/* Reason */}
            <div className="mb-4">
              <p className="text-xs text-gray-400 mb-2">Reason</p>
              <div className="flex flex-col gap-1.5">
                {WARNING_REASONS.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setWarningReason(r.id)}
                    className={[
                      'text-left px-3 py-2 rounded-lg text-sm border transition-colors',
                      warningReason === r.id
                        ? 'border-orange-500 bg-orange-900/40 text-orange-200'
                        : 'border-gray-700 text-gray-400',
                    ].join(' ')}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Note */}
            <div className="mb-4">
              <p className="text-xs text-gray-400 mb-1">Note (optional)</p>
              <input
                type="text"
                value={warningNote}
                onChange={(e) => setWarningNote(e.target.value)}
                placeholder="Additional details…"
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowWarning(false)}
                className="flex-1 py-2 rounded-lg border border-gray-700 text-gray-400 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => void issueWarning()}
                disabled={acting}
                className="flex-1 py-2 rounded-lg bg-orange-700 hover:bg-orange-600 text-white font-semibold text-sm disabled:opacity-50"
              >
                {acting ? '…' : 'Issue Warning'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
