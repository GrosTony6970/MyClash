'use client';

/**
 * Bracket management — T-704
 * Route: /org/[slug]/events/[eventId]/bracket
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { BracketView, type BracketSlotData } from '@myclash/ui';

interface Tournament {
  id: string;
  name: string;
}

interface BracketResult {
  phaseId: string;
  bracketSize: number;
  fighterCount: number;
  byeCount: number;
  rounds: number;
  totalSlots: number;
  slots: BracketSlotData[];
}

export default function BracketPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const router = useRouter();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournament, setSelectedTournament] = useState<string>('');
  const [bracket, setBracket] = useState<BracketResult | null>(null);
  const [existingBracket, setExistingBracket] = useState(false);

  // Config
  const [qualifyCount, setQualifyCount] = useState<number | ''>('');
  const [bracketSize, setBracketSize] = useState<number | ''>('');

  // UI state
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForceConfirm, setShowForceConfirm] = useState(false);

  // ── Load tournaments ────────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const t = (await res.json()) as Tournament[];
        setTournaments(t);
        if (t.length > 0) setTimeout(() => setSelectedTournament(t[0]!.id), 0);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId, apiUrl]);

  // ── Load existing bracket ───────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedTournament) return;
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/tournaments/${selectedTournament}/bracket`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as BracketResult | null;
        if (data && data.slots?.length > 0) {
          setBracket(data);
          setExistingBracket(true);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [selectedTournament, apiUrl]);

  // ── Generate bracket ────────────────────────────────────────────────────────

  async function generate(force = false) {
    if (!selectedTournament) return;
    setGenerating(true);
    setError(null);
    setShowForceConfirm(false);

    try {
      const body: Record<string, unknown> = {};
      if (qualifyCount !== '') body['qualifyCount'] = qualifyCount;
      if (bracketSize !== '') body['bracketSize'] = bracketSize;

      const res = await fetch(
        `${apiUrl}/api/v1/tournaments/${selectedTournament}/generate-bracket${force ? '?force=true' : ''}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        },
      );

      if (res.status === 409) {
        setShowForceConfirm(true);
        return;
      }

      if (!res.ok) {
        const body2 = (await res.json()) as { message?: string };
        throw new Error(body2.message ?? 'Generation failed');
      }

      const result = (await res.json()) as BracketResult;
      setBracket(result);
      setExistingBracket(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href={`/org/${slug}`} className="hover:text-gray-700">
              {slug}
            </Link>
            <span>/</span>
            <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-gray-700">
              Event
            </Link>
            <span>/</span>
            <span className="text-gray-900 font-medium">Bracket</span>
          </div>
          <h1 className="text-2xl font-bold">Bracket management</h1>
        </div>
        <Link
          href={`/org/${slug}/events/${eventId}/pools`}
          className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
        >
          ← Pools
        </Link>
      </div>

      {/* Tournament selector */}
      {tournaments.length > 1 && (
        <div className="mb-4">
          <select
            value={selectedTournament}
            onChange={(e) => setSelectedTournament(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Config */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-bold text-gray-700 mb-4">Bracket configuration</h2>
        <div className="flex flex-wrap gap-6 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Qualify count (top N from pools)
            </label>
            <input
              type="number"
              value={qualifyCount}
              onChange={(e) =>
                setQualifyCount(e.target.value === '' ? '' : parseInt(e.target.value))
              }
              placeholder="Auto"
              min="2"
              className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Bracket size override (power of 2)
            </label>
            <select
              value={bracketSize}
              onChange={(e) =>
                setBracketSize(e.target.value === '' ? '' : parseInt(e.target.value))
              }
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              <option value="">Auto</option>
              {[4, 8, 16, 32, 64].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => void generate(false)}
            disabled={generating || !selectedTournament}
            className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
          >
            {generating ? 'Generating…' : existingBracket ? 'Regenerate' : 'Generate bracket'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Force confirm modal */}
      {showForceConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center">
            <p className="text-4xl mb-3">⚠️</p>
            <h2 className="text-lg font-bold mb-2">Regenerate bracket?</h2>
            <p className="text-gray-500 text-sm mb-5">
              The existing bracket and all its match slots will be deleted.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setShowForceConfirm(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void generate(true)}
                className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white font-semibold rounded-lg text-sm"
              >
                Yes, regenerate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bracket preview */}
      {bracket && (
        <div>
          <div className="flex items-center gap-4 mb-4 text-sm text-gray-500">
            <span>{bracket.bracketSize}-fighter bracket</span>
            <span>·</span>
            <span>{bracket.rounds} rounds</span>
            <span>·</span>
            <span>{bracket.byeCount} byes</span>
            <span>·</span>
            <span>{bracket.totalSlots} match slots</span>
          </div>
          <div className="bg-gray-950 rounded-xl p-4">
            <BracketView
              slots={bracket.slots}
              rounds={bracket.rounds}
              onMatchClick={(matchId) => {
                if (matchId) router.push(`/org/${slug}/events/${eventId}/matches/${matchId}`);
              }}
            />
          </div>
        </div>
      )}

      {!bracket && !generating && (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400 text-sm">
            No bracket generated yet. Configure above and click Generate.
          </p>
        </div>
      )}
    </main>
  );
}
