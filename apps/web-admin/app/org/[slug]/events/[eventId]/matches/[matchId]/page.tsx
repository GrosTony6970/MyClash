'use client';
/* eslint-disable myclash/no-literal-string -- existing match detail page has not been i18n-baselined yet */

/**
 * Match detail + exchange editor — T-705
 * Route: /org/[slug]/events/[eventId]/matches/[matchId]
 *
 * AC:
 *   ✓ Void exchange requires reason
 *   ✓ Audit log shows who, when, what, why
 *   ✓ Reverting a void restores the exchange
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Exchange {
  id: string;
  sequence: number;
  type: string;
  occurredAt: string;
  firstStrikerColor: string | null;
  firstStrikeValue: number | null;
  afterblowValue: number | null;
  noExchangeReason: string | null;
  redScoreDelta: number;
  blueScoreDelta: number;
  voided: boolean;
  voidedReason: string | null;
  clientUuid: string;
}

interface Match {
  id: string;
  matchNumberLabel: string;
  match_number_label?: string;
  status: string;
  redScore: number;
  red_score?: number;
  blueScore: number;
  blue_score?: number;
  redRegistrationId?: string;
  red_registration_id?: string;
  blueRegistrationId?: string;
  blue_registration_id?: string;
  redFighterName: string | null;
  red_fighter_name?: string | null;
  blueFighterName: string | null;
  blue_fighter_name?: string | null;
  rulesetCode: string;
  ruleset_code?: string;
  lockedAt?: string | null;
  locked_at?: string | null;
}

/**
 * Header-only data fetched from /matches/:id/summary. The endpoint
 * resolves the canonical roundCode (LSW-B-R16-M1) via the shared
 * buildRoundCode helper, plus the fighter names already joined to
 * the registration / persons rows, so the page header can read
 * "Alice Smith vs Bob Jones" / "LSW-B-R16-M1" without any UUID.
 */
interface MatchSummary {
  matchLabel: string;
  roundCode: string;
  status: string;
  poolName: string;
  redName: string;
  redClub: string | null;
  blueName: string;
  blueClub: string | null;
  weapon: string;
  tournamentId: string;
  phaseType: 'pool' | 'single_elim' | 'double_elim' | 'swiss' | null;
}

interface AuditEntry {
  id: string;
  actorUserId: string;
  /**
   * Optional human-readable name resolved server-side (global_persons →
   * given+family, or auth.users → display_name/email). When present
   * the FE renders this in place of the raw UUID.
   */
  actorDisplayName?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  payloadJson: Record<string, unknown>;
  createdAt: string;
}

interface PendingReviewResponse {
  pendingReview?: boolean;
  requestId?: string;
  status?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function exchangeLabel(ex: Exchange): string {
  switch (ex.type) {
    case 'clean':
      return `Clean hit — ${ex.firstStrikerColor ?? '?'} +${ex.firstStrikeValue ?? 0}`;
    case 'afterblow':
      return `Afterblow — ${ex.firstStrikerColor ?? '?'} +${ex.firstStrikeValue ?? 0} / afterblow +${ex.afterblowValue ?? 0}`;
    case 'double':
      return 'Double';
    case 'no_exchange':
      return `No exchange${ex.noExchangeReason ? ` (${ex.noExchangeReason.replace('_', ' ')})` : ''}`;
    default:
      return ex.type;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MatchDetailPage() {
  const params = useParams<{
    slug: string;
    eventId: string;
    matchId: string;
  }>();
  const { slug, eventId, matchId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [match, setMatch] = useState<Match | null>(null);
  // Canonical header data — roundCode (LSW-B-R16-M1) + fighter names
  // come from /matches/:id/summary so we never have to show a raw
  // UUID or the legacy matchNumberLabel as the page title.
  const [summary, setSummary] = useState<MatchSummary | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);

  // Void modal state
  const [voidTarget, setVoidTarget] = useState<Exchange | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidSaving, setVoidSaving] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [forfeitReason, setForfeitReason] = useState('injury');
  const [forfeitSide, setForfeitSide] = useState<'red' | 'blue'>('red');
  const [forfeitCanContinue, setForfeitCanContinue] = useState(true);
  const [forfeitSaving, setForfeitSaving] = useState(false);

  // ── Fetch ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      fetch(`${apiUrl}/api/v1/matches/${matchId}`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/matches/${matchId}/summary`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/matches/${matchId}/exchanges`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/audit-log?entityType=exchange&matchId=${matchId}&limit=50`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([matchRes, summaryRes, exRes, auditRes]) => {
        setLoading(false);
        if (matchRes.ok) setMatch((await matchRes.json()) as Match);
        if (summaryRes.ok) setSummary((await summaryRes.json()) as MatchSummary);
        if (exRes.ok) setExchanges((await exRes.json()) as Exchange[]);
        if (auditRes.ok) setAuditLog((await auditRes.json()) as AuditEntry[]);
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
      });

    return () => controller.abort();
  }, [matchId, apiUrl, refreshKey]);

  // ── Void exchange ─────────────────────────────────────────────────────────────

  async function handleVoid() {
    if (!voidTarget || !voidReason.trim()) {
      setVoidError('Reason is required');
      return;
    }
    setVoidSaving(true);
    setVoidError(null);

    try {
      const res = await fetch(`${apiUrl}/api/v1/exchanges/${voidTarget.id}/void`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: voidReason.trim() }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? 'Void failed');
      }

      const body = (await res.json()) as PendingReviewResponse;
      if (body.pendingReview) {
        setPendingNotice(`Correction request ${body.requestId ?? ''} submitted for review.`);
      } else {
        setPendingNotice(null);
      }
      setVoidTarget(null);
      setVoidReason('');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : 'Void failed');
    } finally {
      setVoidSaving(false);
    }
  }

  // ── Revert void ───────────────────────────────────────────────────────────────

  async function handleRevert(exchangeId: string) {
    if (!confirm('Restore this exchange? The score will be recomputed.')) return;

    const res = await fetch(`${apiUrl}/api/v1/exchanges/${exchangeId}/revert-void`, {
      method: 'PATCH',
      credentials: 'include',
    });

    if (res.ok) {
      const body = (await res.json()) as PendingReviewResponse;
      if (body.pendingReview) {
        setPendingNotice(`Correction request ${body.requestId ?? ''} submitted for review.`);
      } else {
        setPendingNotice(null);
      }
      setRefreshKey((k) => k + 1);
    } else {
      const body = (await res.json()) as { message?: string };
      alert(body.message ?? 'Revert failed');
    }
  }

  async function handleLockToggle() {
    if (!match) return;
    const endpoint = match.lockedAt ? 'unlock' : 'lock';
    const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ reason: 'Organizer manual lock toggle' }),
    });
    if (res.ok) {
      setRefreshKey((key) => key + 1);
    } else {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      alert(body.message ?? 'Lock operation failed');
    }
  }

  async function handleForfeit() {
    if (!match) return;
    const redId = match.redRegistrationId ?? match.red_registration_id;
    const blueId = match.blueRegistrationId ?? match.blue_registration_id;
    const forfeitingRegistrationId = forfeitSide === 'red' ? redId : blueId;
    if (!forfeitingRegistrationId) {
      alert('Missing registration id for this side');
      return;
    }
    setForfeitSaving(true);
    const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}/forfeit`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        forfeitingRegistrationId,
        reason: forfeitReason,
        canContinue: ['injury', 'voluntary', 'black_card_1'].includes(forfeitReason)
          ? forfeitCanContinue
          : undefined,
      }),
    });
    setForfeitSaving(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      alert(body.message ?? 'Forfeit failed');
      return;
    }
    setRefreshKey((key) => key + 1);
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="p-8 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
        <Link href={`/org/${slug}`} className="hover:text-gray-700">
          {slug}
        </Link>
        <span>/</span>
        <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-gray-700">
          Event
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">
          {summary?.roundCode ?? match?.matchNumberLabel ?? 'Match'}
        </span>
      </div>

      {/* Match header — fighters lead, canonical roundCode subtitle.
          The UUID is no longer surfaced; if the data hasn't loaded
          yet, the breadcrumb above shows the neutral "Match"
          placeholder and this block stays hidden. */}
      {(match || summary) && (
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">
              {summary
                ? `${summary.redName || '?'} vs ${summary.blueName || '?'}`
                : `${match?.redFighterName ?? '?'} vs ${match?.blueFighterName ?? '?'}`}
            </h1>
            <p className="text-gray-500 text-sm mt-0.5 font-mono">
              {summary?.roundCode ?? match?.matchNumberLabel ?? ''}
            </p>
            {match?.lockedAt && (
              <p className="mt-1 text-sm font-medium text-yellow-700">Locked for staff scoring</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-3xl font-black tabular-nums">
              <span className="text-red-600">{match?.redScore ?? 0}</span>
              <span className="text-gray-400 mx-2">–</span>
              <span className="text-blue-600">{match?.blueScore ?? 0}</span>
            </p>
            <button
              type="button"
              onClick={() => void handleLockToggle()}
              className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-gray-500"
            >
              {match?.lockedAt ? 'Unlock match' : 'Lock match'}
            </button>
          </div>
        </div>
      )}

      {pendingNotice && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {pendingNotice}
        </div>
      )}

      {match && (
        <section className="mb-6 rounded-xl border border-red-100 bg-red-50 p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-red-700">
            Record forfeit
          </h2>
          <div className="grid gap-3 md:grid-cols-4">
            <select
              value={forfeitSide}
              onChange={(event) => setForfeitSide(event.target.value as 'red' | 'blue')}
              className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm"
            >
              <option value="red">{match.redFighterName ?? match.red_fighter_name ?? 'Red'}</option>
              <option value="blue">
                {match.blueFighterName ?? match.blue_fighter_name ?? 'Blue'}
              </option>
            </select>
            <select
              value={forfeitReason}
              onChange={(event) => setForfeitReason(event.target.value)}
              className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm"
            >
              <option value="injury">Injury</option>
              <option value="voluntary">Voluntary</option>
              <option value="black_card_1">Black card</option>
              <option value="black_card_2">Second black card</option>
              <option value="conduct_violation">Conduct violation</option>
            </select>
            {['injury', 'voluntary', 'black_card_1'].includes(forfeitReason) && (
              <label className="flex items-center gap-2 text-sm text-red-900">
                <input
                  type="checkbox"
                  checked={forfeitCanContinue}
                  onChange={(event) => setForfeitCanContinue(event.target.checked)}
                />
                Can continue
              </label>
            )}
            <button
              type="button"
              onClick={() => void handleForfeit()}
              disabled={forfeitSaving}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {forfeitSaving ? 'Recording...' : 'Record forfeit'}
            </button>
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 gap-8">
        {/* ── Exchange list ── */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
            Exchanges ({exchanges.length})
          </h2>

          {exchanges.length === 0 ? (
            <p className="text-gray-400 text-sm">No exchanges recorded.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {exchanges.map((ex) => (
                <div
                  key={ex.id}
                  className={[
                    'border rounded-xl px-4 py-3 text-sm',
                    ex.voided
                      ? 'border-gray-200 bg-gray-50 opacity-60'
                      : 'border-gray-200 bg-white',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 font-mono w-6">#{ex.sequence}</span>
                        <span
                          className={[
                            'font-medium',
                            ex.voided ? 'line-through text-gray-400' : 'text-gray-900',
                          ].join(' ')}
                        >
                          {exchangeLabel(ex)}
                        </span>
                        {ex.voided && (
                          <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">
                            VOIDED
                          </span>
                        )}
                      </div>
                      {ex.voided && ex.voidedReason && (
                        <p className="text-xs text-gray-400 mt-0.5 ml-8">
                          Reason: {ex.voidedReason}
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-0.5 ml-8">
                        {new Date(ex.occurredAt).toLocaleTimeString('fr-FR')}
                        {(ex.redScoreDelta !== 0 || ex.blueScoreDelta !== 0) && (
                          <span className="ml-2">
                            {ex.redScoreDelta > 0 && (
                              <span className="text-red-500">R+{ex.redScoreDelta} </span>
                            )}
                            {ex.blueScoreDelta > 0 && (
                              <span className="text-blue-500">B+{ex.blueScoreDelta}</span>
                            )}
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 flex-shrink-0">
                      {!ex.voided ? (
                        <button
                          onClick={() => {
                            setVoidTarget(ex);
                            setVoidReason('');
                            setVoidError(null);
                          }}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Void
                        </button>
                      ) : (
                        <button
                          onClick={() => void handleRevert(ex.id)}
                          className="text-xs text-green-600 hover:underline"
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Audit log ── */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
            Audit log
          </h2>

          {auditLog.length === 0 ? (
            <p className="text-gray-400 text-sm">No audit entries yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {auditLog.map((entry) => (
                <div key={entry.id} className="border border-gray-100 rounded-xl px-4 py-3 text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-700">
                      {entry.action}
                    </span>
                    <span className="text-gray-400">
                      {new Date(entry.createdAt).toLocaleString('fr-FR')}
                    </span>
                  </div>
                  <p className="text-gray-500">
                    by{' '}
                    <span className="font-medium text-gray-700">
                      {entry.actorDisplayName ?? '—'}
                    </span>
                  </p>
                  {entry.payloadJson && Object.keys(entry.payloadJson).length > 0 && (
                    <div className="mt-1 text-gray-400">
                      {Object.entries(entry.payloadJson).map(([k, v]) => (
                        <span key={k} className="mr-2">
                          {k}: <em>{String(v)}</em>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Void modal */}
      {voidTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold mb-1">Void exchange #{voidTarget.sequence}</h2>
            <p className="text-sm text-gray-500 mb-4">{exchangeLabel(voidTarget)}</p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason * (required)
              </label>
              <textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                rows={3}
                placeholder="e.g. Scorekeeper entry error, referee correction…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 resize-none"
              />
            </div>

            {voidError && (
              <p className="text-sm text-red-600 mt-2" role="alert">
                {voidError}
              </p>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setVoidTarget(null)}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleVoid()}
                disabled={voidSaving || !voidReason.trim()}
                className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
              >
                {voidSaving ? 'Voiding…' : 'Void exchange'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
