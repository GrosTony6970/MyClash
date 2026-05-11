'use client';

/* eslint-disable myclash/no-literal-string */

/**
 * Bracket management — T-704 / auto-advance
 * Route: /org/[slug]/events/[eventId]/bracket
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { BracketView, type BracketSlotData, type BracketConfig } from '@myclash/ui';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';

interface Tournament {
  id: string;
  name: string;
}

interface BracketResult {
  phaseId: string;
  phaseType?: string;
  visibility?: 'hidden' | 'published';
  bracketSize: number;
  fighterCount: number;
  byeCount: number;
  playInMatchCount?: number;
  hasPlayInRound?: boolean;
  rounds: number;
  wbRounds?: number | null;
  lbRounds?: number | null;
  autoAdvance?: boolean;
  totalSlots: number;
  slots: BracketSlotData[];
}

interface OverrideModalState {
  slotId: string;
  regAId: string;
  regBId: string;
}

const MAX_BRACKET_SIZE = 128;
const BRACKET_SIZE_OPTIONS = [4, 8, 16, 32, 64, 128];

export default function BracketPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const router = useRouter();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournament, setSelectedTournament] = useState<string>('');
  const [bracket, setBracket] = useState<BracketResult | null>(null);
  const [bracketPhaseId, setBracketPhaseId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<'hidden' | 'published'>('hidden');
  const [existingBracket, setExistingBracket] = useState(false);

  // Config
  const [qualifyCount, setQualifyCount] = useState<number | ''>('');
  const [bracketSize, setBracketSize] = useState<number | ''>('');
  const [phaseType, setPhaseType] = useState<'single_elim' | 'double_elim'>('single_elim');
  const [grandFinalReset, setGrandFinalReset] = useState(false);

  // Override modal
  const [overrideModal, setOverrideModal] = useState<OverrideModalState | null>(null);
  const [overriding, setOverriding] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  // UI state
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [showForceConfirm, setShowForceConfirm] = useState(false);
  const [showUnpublishConfirm, setShowUnpublishConfirm] = useState(false);
  const [notifyHref, setNotifyHref] = useState<string | null>(null);

  // ── Load tournaments ────────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const tournaments = (await res.json()) as Tournament[];
        setTournaments(tournaments);
        if (tournaments.length > 0) setTimeout(() => setSelectedTournament(tournaments[0]!.id), 0);
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
          setBracketPhaseId(data.phaseId);
          setVisibility(data.visibility ?? 'hidden');
          setExistingBracket(true);
          if (data.phaseType === 'double_elim') setPhaseType('double_elim');
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
      const body: Record<string, unknown> = { phaseType };
      if (qualifyCount !== '') body['qualifyCount'] = qualifyCount;
      if (bracketSize !== '') body['bracketSize'] = bracketSize;
      if (phaseType === 'double_elim') body['grandFinalReset'] = grandFinalReset;

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
        const errBody = (await res.json()) as { message?: string };
        throw new Error(errBody.message ?? 'Generation failed');
      }

      const result = (await res.json()) as BracketResult;
      setBracket(result);
      setBracketPhaseId(result.phaseId);
      setVisibility('hidden');
      setNotifyHref(null);
      setExistingBracket(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function updateVisibility(nextVisibility: 'hidden' | 'published', confirmStarted = false) {
    if (!bracketPhaseId || visibilityBusy) return;
    setVisibilityBusy(true);
    setError(null);
    setShowUnpublishConfirm(false);
    try {
      const res = await fetch(`${apiUrl}/api/v1/phases/${bracketPhaseId}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ visibility: nextVisibility, confirmStarted }),
      });
      if (res.status === 409 && nextVisibility === 'hidden') {
        setShowUnpublishConfirm(true);
        return;
      }
      if (!res.ok) {
        const errBody = (await res.json()) as { message?: string };
        throw new Error(errBody.message ?? t('organizer.phaseVisibility.updateError'));
      }
      setVisibility(nextVisibility);
      if (nextVisibility === 'published') {
        const query = new URLSearchParams({
          targetType: 'fighters_and_referees',
          severity: 'info',
          tournamentId: selectedTournament,
          title: t('organizer.phaseVisibility.bracketReadyTitle'),
          body: t('organizer.phaseVisibility.bracketReadyBody'),
        });
        setNotifyHref(`/org/${slug}/events/${eventId}/notifications?${query.toString()}`);
      } else {
        setNotifyHref(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.phaseVisibility.updateError'));
    } finally {
      setVisibilityBusy(false);
    }
  }

  async function submitOverride() {
    if (!overrideModal) return;
    setOverriding(true);
    setOverrideError(null);
    try {
      const body: Record<string, string | null> = {};
      if (overrideModal.regAId !== '') body['registrationAId'] = overrideModal.regAId || null;
      if (overrideModal.regBId !== '') body['registrationBId'] = overrideModal.regBId || null;

      const res = await fetch(`${apiUrl}/api/v1/bracket-slots/${overrideModal.slotId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json()) as { message?: string };
        throw new Error(errBody.message ?? 'Override failed');
      }
      setOverrideModal(null);
      // Refresh bracket
      const refreshRes = await fetch(`${apiUrl}/api/v1/tournaments/${selectedTournament}/bracket`, {
        credentials: 'include',
      });
      if (refreshRes.ok) {
        const data = (await refreshRes.json()) as BracketResult;
        if (data) setBracket(data);
      }
    } catch (err) {
      setOverrideError(err instanceof Error ? err.message : 'Override failed');
    } finally {
      setOverriding(false);
    }
  }

  const bracketConfig: BracketConfig | undefined = bracket
    ? {
        phaseType: (bracket.phaseType as 'single_elim' | 'double_elim') ?? 'single_elim',
        rounds: bracket.rounds,
        wbRounds: bracket.wbRounds ?? undefined,
        lbRounds: bracket.lbRounds ?? undefined,
      }
    : undefined;

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
          href={`/org/${slug}/events/${eventId}/ai-assistant?type=bracket_plan${selectedTournament ? `&tournamentId=${selectedTournament}` : ''}`}
          className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
        >
          {t('organizer.aiAssistant.suggest')}
        </Link>
        <Link
          href={`/org/${slug}/events/${eventId}/pools`}
          className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
        >
          ← Pools
        </Link>
      </div>

      {bracketPhaseId && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
          <span
            className={[
              'rounded-full px-2.5 py-1 text-xs font-semibold',
              visibility === 'published'
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-600',
            ].join(' ')}
          >
            {visibility === 'published'
              ? t('organizer.phaseVisibility.published')
              : t('organizer.phaseVisibility.hidden')}
          </span>
          <button
            type="button"
            disabled={visibilityBusy || visibility === 'published'}
            onClick={() => void updateVisibility('published')}
            className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-gray-300"
          >
            {t('organizer.phaseVisibility.publishBracket')}
          </button>
          <button
            type="button"
            disabled={visibilityBusy || visibility === 'hidden'}
            onClick={() => void updateVisibility('hidden')}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 disabled:text-gray-300"
          >
            {t('organizer.phaseVisibility.unpublishBracket')}
          </button>
          {notifyHref && (
            <Link href={notifyHref} className="text-sm font-semibold text-red-700 underline">
              {t('organizer.phaseVisibility.notifyParticipants')}
            </Link>
          )}
          {bracket?.autoAdvance === false && (
            <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-semibold text-yellow-700">
              Manual mode
            </span>
          )}
        </div>
      )}

      {showUnpublishConfirm && (
        <div className="mb-6 rounded-xl border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
          <p className="font-semibold">{t('organizer.phaseVisibility.unpublishStartedWarning')}</p>
          <button
            type="button"
            onClick={() => void updateVisibility('hidden', true)}
            className="mt-3 rounded-lg bg-yellow-600 px-3 py-2 text-sm font-semibold text-white"
          >
            {t('organizer.phaseVisibility.confirmUnpublish')}
          </button>
        </div>
      )}

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
            <label className="block text-xs font-medium text-gray-600 mb-1">Format</label>
            <select
              value={phaseType}
              onChange={(e) => setPhaseType(e.target.value as 'single_elim' | 'double_elim')}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              <option value="single_elim">Single elimination</option>
              <option value="double_elim">Double elimination</option>
            </select>
          </div>
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
            <p className="mt-1 max-w-xs text-xs text-gray-500">
              {phaseType === 'single_elim'
                ? `Auto uses play-ins for non-power-of-two counts. Main bracket size is capped at ${MAX_BRACKET_SIZE}.`
                : `Double elimination bracket size is capped at ${MAX_BRACKET_SIZE}.`}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Bracket size override (power of 2, max {MAX_BRACKET_SIZE})
            </label>
            <select
              value={bracketSize}
              onChange={(e) =>
                setBracketSize(e.target.value === '' ? '' : parseInt(e.target.value))
              }
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              <option value="">Auto</option>
              {BRACKET_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          {phaseType === 'double_elim' && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={grandFinalReset}
                onChange={(e) => setGrandFinalReset(e.target.checked)}
                className="rounded"
              />
              <span className="text-gray-700">Grand final reset</span>
            </label>
          )}
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

      {/* Override modal */}
      {overrideModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold mb-4">Override slot</h2>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Registration A (UUID, blank to clear)
                </label>
                <input
                  type="text"
                  value={overrideModal.regAId}
                  onChange={(e) => setOverrideModal({ ...overrideModal, regAId: e.target.value })}
                  placeholder="Leave blank to clear"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Registration B (UUID, blank to clear)
                </label>
                <input
                  type="text"
                  value={overrideModal.regBId}
                  onChange={(e) => setOverrideModal({ ...overrideModal, regBId: e.target.value })}
                  placeholder="Leave blank to clear"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
            </div>
            {overrideError && <p className="text-red-600 text-sm mb-3">{overrideError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => setOverrideModal(null)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void submitOverride()}
                disabled={overriding}
                className="flex-1 px-4 py-2 bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold rounded-lg text-sm"
              >
                {overriding ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bracket preview */}
      {bracket && (
        <div>
          <div className="flex items-center gap-4 mb-4 text-sm text-gray-500">
            <span>{bracket.bracketSize}-slot main bracket</span>
            <span>·</span>
            <span>{bracket.rounds} rounds</span>
            <span>·</span>
            <span>{bracket.byeCount} byes</span>
            {bracket.hasPlayInRound && (
              <>
                <span>Â·</span>
                <span>
                  {t('organizer.phaseVisibility.bracketSummaryPlayIns', {
                    count: bracket.playInMatchCount ?? 0,
                  })}
                </span>
              </>
            )}
            <span>·</span>
            <span>{bracket.totalSlots} match slots</span>
            {bracket.phaseType === 'double_elim' && (
              <>
                <span>·</span>
                <span className="text-blue-500">Double elim</span>
              </>
            )}
          </div>
          <div className="bg-gray-950 rounded-xl p-4">
            <BracketView
              slots={bracket.slots}
              rounds={bracket.rounds}
              bracketConfig={bracketConfig}
              onMatchClick={(matchId) => {
                if (matchId) router.push(`/org/${slug}/events/${eventId}/matches/${matchId}`);
              }}
              onOverrideSlot={(slotId) => setOverrideModal({ slotId, regAId: '', regBId: '' })}
              playInLabel={t('organizer.phaseVisibility.playIns')}
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
