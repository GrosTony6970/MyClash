'use client';

/**
 * Match detail + exchange editor — T-705
 * Route: /org/[slug]/events/[eventId]/matches/[matchId]
 *
 * AC:
 *   ✓ Void exchange requires reason
 *   ✓ Audit log shows who, when, what, why
 *   ✓ Reverting a void restores the exchange
 *
 * The audit section was inert for a long time: it called a top-level audit-log
 * route that never existed, and swallowed the failure with `if (res.ok)`, so a
 * permanent outage rendered as "no activity yet". It now reads the
 * organiser-scoped `matches/:id/audit-log` and reports a real error.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Modal, useConfirm, useToast } from '@myclash/ui';
import { localeToBcp47 } from '@myclash/time';
import { useI18n } from '../../../../../../../src/i18n/I18nProvider';
import { PayloadCell, type PayloadLabel } from '../../../../../../../src/components/PayloadCell';
import { getPublicApiUrl } from '@/lib/api-url';

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
  // Best-of-N round state (bestOf = 1 for single-round matches).
  bestOf?: number;
  currentRound?: number;
  redRoundWins?: number;
  blueRoundWins?: number;
}

interface AuditEntry {
  id: string;
  actorUserId: string | null;
  /**
   * Human-readable name resolved server-side. Name only on this surface —
   * the organiser-scoped endpoint deliberately never returns a reviewer's email.
   */
  actorDisplayName?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel?: string | null;
  payloadJson: unknown;
  /** RFC 6901 JSON Pointer into payloadJson → label for the id at that spot. */
  payloadLabels?: Record<string, PayloadLabel>;
  createdAt: string;
}

interface PendingReviewResponse {
  pendingReview?: boolean;
  requestId?: string;
  status?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type Translator = (key: string, values?: Record<string, string | number>) => string;

function exchangeLabel(ex: Exchange, t: Translator): string {
  const color =
    ex.firstStrikerColor === 'red'
      ? t('organizer.matchDetail.red')
      : ex.firstStrikerColor === 'blue'
        ? t('organizer.matchDetail.blue')
        : '?';
  switch (ex.type) {
    case 'clean':
      return t('organizer.matchDetail.exClean', { color, value: ex.firstStrikeValue ?? 0 });
    case 'afterblow': {
      // Show the NETTED score impact (0 for the defender in deductive mode), not
      // the raw button values — the raw afterblow stays in the data + exports.
      const strikerDelta = ex.firstStrikerColor === 'red' ? ex.redScoreDelta : ex.blueScoreDelta;
      const defenderDelta = ex.firstStrikerColor === 'red' ? ex.blueScoreDelta : ex.redScoreDelta;
      return t('organizer.matchDetail.exAfterblow', {
        color,
        striker: strikerDelta,
        defender: defenderDelta,
      });
    }
    case 'double':
      return t('organizer.matchDetail.exDouble');
    case 'no_exchange':
      return ex.noExchangeReason
        ? t('organizer.matchDetail.exNoExchangeWithReason', {
            reason: ex.noExchangeReason.replace('_', ' '),
          })
        : t('organizer.matchDetail.exNoExchange');
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
  const apiUrl = getPublicApiUrl();
  const { t, locale } = useI18n();
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();

  const [match, setMatch] = useState<Match | null>(null);
  // Canonical header data — roundCode (LSW-B-R16-M1) + fighter names
  // come from /matches/:id/summary so we never have to show a raw
  // UUID or the legacy matchNumberLabel as the page title.
  const [summary, setSummary] = useState<MatchSummary | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
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
      fetch(`${apiUrl}/api/v1/matches/${matchId}/audit-log?limit=50`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([matchRes, summaryRes, exRes, auditRes]) => {
        setLoading(false);
        if (matchRes.ok) setMatch((await matchRes.json()) as Match);
        if (summaryRes.ok) setSummary((await summaryRes.json()) as MatchSummary);
        if (exRes.ok) setExchanges((await exRes.json()) as Exchange[]);
        // Distinguish "no audit rows" from "the audit read failed" — a silent
        // `if (ok)` here is how this section stayed permanently empty unnoticed.
        if (auditRes.ok) {
          setAuditLog((await auditRes.json()) as AuditEntry[]);
          setAuditError(null);
        } else {
          setAuditError(t('organizer.matchDetail.auditLoadError'));
        }
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
      });

    return () => controller.abort();
    // `t` is memoized per locale by I18nProvider, so it only re-runs on a
    // locale switch — which is when the audit error string should change anyway.
  }, [matchId, apiUrl, refreshKey, t]);

  // ── Void exchange ─────────────────────────────────────────────────────────────

  async function handleVoid() {
    if (!voidTarget || !voidReason.trim()) {
      setVoidError(t('admin.common.reasonRequired'));
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
        throw new Error(body.message ?? t('admin.common.voidFailed'));
      }

      const body = (await res.json()) as PendingReviewResponse;
      if (body.pendingReview) {
        setPendingNotice(
          t('organizer.matchDetail.correctionSubmitted', { id: body.requestId ?? '' }),
        );
      } else {
        setPendingNotice(null);
      }
      setVoidTarget(null);
      setVoidReason('');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : t('admin.common.voidFailed'));
    } finally {
      setVoidSaving(false);
    }
  }

  // ── Revert void ───────────────────────────────────────────────────────────────

  async function handleRevert(exchangeId: string) {
    if (
      !(await confirm({
        title: t('organizer.matchDetail.restoreConfirm'),
        danger: true,
      }))
    )
      return;

    const res = await fetch(`${apiUrl}/api/v1/exchanges/${exchangeId}/revert-void`, {
      method: 'PATCH',
      credentials: 'include',
    });

    if (res.ok) {
      const body = (await res.json()) as PendingReviewResponse;
      if (body.pendingReview) {
        setPendingNotice(
          t('organizer.matchDetail.correctionSubmitted', { id: body.requestId ?? '' }),
        );
      } else {
        setPendingNotice(null);
      }
      setRefreshKey((k) => k + 1);
    } else {
      const body = (await res.json()) as { message?: string };
      toast.error(body.message ?? t('admin.common.revertFailed'));
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
      toast.error(body.message ?? t('admin.common.lockOperationFailed'));
    }
  }

  async function handleReopen() {
    if (!match) return;
    if (
      !(await confirm({
        title: t('organizer.matchDetail.reopenConfirm'),
        danger: true,
      }))
    ) {
      return;
    }
    const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}/clock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'reopen', reason: 'Organizer re-opened ended match' }),
    });
    if (res.ok) {
      setRefreshKey((key) => key + 1);
    } else {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      toast.error(body.message ?? t('admin.common.couldNotReopenMatch'));
    }
  }

  async function handleForfeit() {
    if (!match) return;
    const redId = match.redRegistrationId ?? match.red_registration_id;
    const blueId = match.blueRegistrationId ?? match.blue_registration_id;
    const forfeitingRegistrationId = forfeitSide === 'red' ? redId : blueId;
    if (!forfeitingRegistrationId) {
      toast.error(t('admin.common.missingRegistrationId'));
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
      toast.error(body.message ?? t('admin.common.forfeitFailed'));
      return;
    }
    setRefreshKey((key) => key + 1);
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="w-8 h-8 border-2 border-border border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="p-8 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted mb-1">
        <Link href={`/org/${slug}`} className="hover:text-foreground-secondary">
          {slug}
        </Link>
        <span>/</span>
        <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-foreground-secondary">
          {t('organizer.matchDetail.breadcrumbEvent')}
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">
          {summary?.roundCode ??
            match?.matchNumberLabel ??
            t('organizer.matchDetail.breadcrumbMatch')}
        </span>
      </div>

      {/* Match header — fighters lead, canonical roundCode subtitle.
          The UUID is no longer surfaced; if the data hasn't loaded
          yet, the breadcrumb above shows the neutral "Match"
          placeholder and this block stays hidden. */}
      {(match || summary) && (
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="font-display font-bold text-2xl sm:text-3xl">
              {summary
                ? t('organizer.schedulePage.grid.versus', {
                    red: summary.redName || '?',
                    blue: summary.blueName || '?',
                  })
                : t('organizer.schedulePage.grid.versus', {
                    red: match?.redFighterName ?? '?',
                    blue: match?.blueFighterName ?? '?',
                  })}
            </h1>
            <p className="text-muted text-sm mt-0.5 font-mono">
              {summary?.roundCode ?? match?.matchNumberLabel ?? ''}
            </p>
            {match?.lockedAt && (
              <p className="mt-1 text-sm font-medium text-warning">
                {t('organizer.matchDetail.lockedBanner')}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-3xl font-black tabular-nums">
              <span className="text-red-600">{match?.redScore ?? 0}</span>
              <span className="text-muted mx-2">–</span>
              <span className="text-blue-600">{match?.blueScore ?? 0}</span>
            </p>
            {summary?.bestOf != null && summary.bestOf > 1 && (
              <p className="mt-0.5 text-xs font-semibold text-muted tabular-nums">
                {t('organizer.matchDetail.bestOfLine', {
                  bestOf: summary.bestOf,
                  round: summary.currentRound ?? 1,
                })}{' '}
                <span className="text-red-600">{summary.redRoundWins ?? 0}</span>
                <span className="mx-1">–</span>
                <span className="text-blue-600">{summary.blueRoundWins ?? 0}</span>
              </p>
            )}
            <div className="mt-3 flex flex-col items-end gap-1.5">
              <button
                type="button"
                onClick={() => void handleLockToggle()}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:border-border"
              >
                {match?.lockedAt
                  ? t('organizer.matchDetail.unlockMatch')
                  : t('organizer.matchDetail.lockMatch')}
              </button>
              {/* Re-open lets the organizer reverse a mistaken End match
                  from the scoring app. Only relevant when the match is
                  in the DB 'completed' state. Backed by the same
                  POST /matches/:id/clock {action:'reopen'} endpoint the
                  scoring app uses. */}
              {match?.status === 'completed' && (
                <button
                  type="button"
                  onClick={() => void handleReopen()}
                  className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning hover:border-warning hover:bg-warning/20"
                >
                  {t('organizer.matchDetail.reopenMatch')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {pendingNotice && (
        <div className="mb-5 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {pendingNotice}
        </div>
      )}

      {match && (
        <section className="mb-6 rounded-xl border border-danger/30 bg-danger/10 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-danger">
            {t('organizer.bracketPage.forfeitTitle')}
          </h2>
          <div className="grid gap-3 md:grid-cols-4">
            <select
              value={forfeitSide}
              onChange={(event) => setForfeitSide(event.target.value as 'red' | 'blue')}
              className="rounded-lg border border-danger/30 bg-surface px-3 py-2 text-sm"
            >
              <option value="red">
                {match.redFighterName ?? match.red_fighter_name ?? t('organizer.matchDetail.red')}
              </option>
              <option value="blue">
                {match.blueFighterName ??
                  match.blue_fighter_name ??
                  t('organizer.matchDetail.blue')}
              </option>
            </select>
            <select
              value={forfeitReason}
              onChange={(event) => setForfeitReason(event.target.value)}
              className="rounded-lg border border-danger/30 bg-surface px-3 py-2 text-sm"
            >
              <option value="injury">{t('organizer.bracketPage.forfeitReasonInjury')}</option>
              <option value="voluntary">{t('organizer.bracketPage.forfeitReasonVoluntary')}</option>
              <option value="black_card_1">
                {t('organizer.bracketPage.forfeitReasonBlackCard1')}
              </option>
              <option value="black_card_2">
                {t('organizer.bracketPage.forfeitReasonBlackCard2')}
              </option>
              <option value="conduct_violation">
                {t('organizer.bracketPage.forfeitReasonConduct')}
              </option>
            </select>
            {['injury', 'voluntary', 'black_card_1'].includes(forfeitReason) && (
              <label className="flex items-center gap-2 text-sm text-danger">
                <input
                  type="checkbox"
                  checked={forfeitCanContinue}
                  onChange={(event) => setForfeitCanContinue(event.target.checked)}
                />
                {t('organizer.matchDetail.canContinue')}
              </label>
            )}
            <button
              type="button"
              onClick={() => void handleForfeit()}
              disabled={forfeitSaving}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-danger-foreground disabled:opacity-50"
            >
              {forfeitSaving
                ? t('organizer.matchDetail.recording')
                : t('organizer.bracketPage.forfeitTitle')}
            </button>
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 gap-8">
        {/* ── Exchange list ── */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
            {t('organizer.matchDetail.exchangesHeading', { count: exchanges.length })}
          </h2>

          {exchanges.length === 0 ? (
            <p className="text-muted text-sm">{t('organizer.matchDetail.noExchanges')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {exchanges.map((ex) => (
                <div
                  key={ex.id}
                  className={[
                    'border rounded-xl px-4 py-3 text-sm',
                    ex.voided
                      ? 'border-border bg-background opacity-60'
                      : 'border-border bg-surface',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted font-mono w-6">#{ex.sequence}</span>
                        <span
                          className={[
                            'font-medium',
                            ex.voided ? 'line-through text-muted' : 'text-foreground',
                          ].join(' ')}
                        >
                          {exchangeLabel(ex, t)}
                        </span>
                        {ex.voided && (
                          <span className="text-xs bg-danger/10 text-danger px-1.5 py-0.5 rounded font-medium">
                            {t('organizer.matchDetail.voidedBadge')}
                          </span>
                        )}
                      </div>
                      {ex.voided && ex.voidedReason && (
                        <p className="text-xs text-muted mt-0.5 ml-8">
                          {t('organizer.matchDetail.voidReasonLine', { reason: ex.voidedReason })}
                        </p>
                      )}
                      <p className="text-xs text-muted mt-0.5 ml-8">
                        {new Date(ex.occurredAt).toLocaleTimeString(localeToBcp47(locale))}
                        {(ex.redScoreDelta !== 0 || ex.blueScoreDelta !== 0) && (
                          <span className="ml-2">
                            {ex.redScoreDelta > 0 && (
                              <span className="text-red-500">
                                {t('organizer.matchDetail.redDelta', {
                                  delta: ex.redScoreDelta,
                                })}{' '}
                              </span>
                            )}
                            {ex.blueScoreDelta > 0 && (
                              <span className="text-blue-500">
                                {t('organizer.matchDetail.blueDelta', {
                                  delta: ex.blueScoreDelta,
                                })}
                              </span>
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
                          className="text-xs text-danger hover:underline"
                        >
                          {t('organizer.matchDetail.voidAction')}
                        </button>
                      ) : (
                        <button
                          onClick={() => void handleRevert(ex.id)}
                          className="text-xs text-success hover:underline"
                        >
                          {t('organizer.matchDetail.restoreAction')}
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
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
            {t('organizer.matchDetail.auditHeading')}
          </h2>

          {auditError ? (
            <p className="text-danger text-sm">{auditError}</p>
          ) : auditLog.length === 0 ? (
            <p className="text-muted text-sm">{t('organizer.matchDetail.noAudit')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {auditLog.map((entry) => (
                <div key={entry.id} className="border border-border rounded-xl px-4 py-3 text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono bg-border px-1.5 py-0.5 rounded text-foreground-secondary">
                      {entry.action}
                    </span>
                    <span className="text-muted">
                      {new Date(entry.createdAt).toLocaleString(localeToBcp47(locale))}
                    </span>
                  </div>
                  <p className="text-muted">
                    {t('organizer.matchDetail.byLabel')}{' '}
                    <span className="font-medium text-foreground-secondary">
                      {entry.actorDisplayName ?? '—'}
                    </span>
                    {entry.entityLabel && (
                      <span className="text-muted">{` · ${entry.entityLabel}`}</span>
                    )}
                  </p>
                  <div className="mt-1">
                    <PayloadCell payload={entry.payloadJson} labels={entry.payloadLabels ?? {}} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Void modal */}
      {voidTarget && (
        <Modal
          open
          onClose={() => setVoidTarget(null)}
          busy={voidSaving}
          size="sm"
          title={t('organizer.matchDetail.voidModalTitle', { seq: voidTarget.sequence })}
          description={exchangeLabel(voidTarget, t)}
          footer={
            <>
              <button
                onClick={() => setVoidTarget(null)}
                className="text-sm text-muted hover:text-foreground-secondary px-4 py-2"
              >
                {t('organizer.matchDetail.cancel')}
              </button>
              <button
                onClick={() => void handleVoid()}
                disabled={voidSaving || !voidReason.trim()}
                className="bg-danger hover:bg-danger-hover disabled:opacity-50 text-danger-foreground font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
              >
                {voidSaving
                  ? t('organizer.matchDetail.voiding')
                  : t('organizer.matchDetail.voidExchange')}
              </button>
            </>
          }
        >
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">
              {t('organizer.matchDetail.voidReasonLabel')}
            </label>
            <textarea
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              rows={3}
              placeholder={t('organizer.matchDetail.voidReasonPlaceholder')}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-none"
            />
          </div>

          {voidError && (
            <p className="text-sm text-danger mt-2" role="alert">
              {voidError}
            </p>
          )}
        </Modal>
      )}
      {confirmDialog}
    </main>
  );
}
