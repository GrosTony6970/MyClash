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
import { Modal, sideColorsFor, useConfirm, useToast } from '@myclash/ui';
import type { TournamentScoringConfig } from '@myclash/types';
import { FORFEIT_REASONS, OVERRIDE_REASONS, isOverrideReason } from '@myclash/rulesets';
import { localeToBcp47 } from '@myclash/time';
import { useI18n } from '../../../../../../../src/i18n/I18nProvider';
import { PayloadCell, type PayloadLabel } from '../../../../../../../src/components/PayloadCell';
import { getPublicApiUrl } from '@/lib/api-url';
import { voidConfirmCopy, type ForfeitCascade } from './void-confirm-copy';
import { UncompleteDialog, UncompleteHint } from './UncompleteConfirm';

/**
 * One i18n key per reason. The engine owns which reasons exist; this owns
 * what each is called. Literal values so the i18n reverse sweep can see them.
 */
const REASON_LABEL_KEY: Record<string, string> = {
  injury: 'organizer.bracketPage.forfeitReasonInjury',
  voluntary: 'organizer.bracketPage.forfeitReasonVoluntary',
  black_card_1: 'organizer.bracketPage.forfeitReasonBlackCard1',
  black_card_2: 'organizer.bracketPage.forfeitReasonBlackCard2',
  conduct_violation: 'organizer.bracketPage.forfeitReasonConduct',
  referee_decision: 'organizer.bracketPage.overrideReasonRefereeDecision',
  admin_correction: 'organizer.bracketPage.overrideReasonAdminCorrection',
  technical_failure: 'organizer.bracketPage.overrideReasonTechnicalFailure',
};

/** The one live forfeit-or-override on a match. `match_forfeits` allows no second. */
interface ActiveForfeit {
  id: string;
  reason: string;
  forfeiting_score: number | null;
  opponent_score: number | null;
  note: string | null;
  /** Set when a withdrawal recorded on another bout closed this one. */
  parent_forfeit_id: string | null;
  auto_created: boolean;
  /**
   * Computed server-side, and NOT derivable here: the row says a parent exists,
   * never whether it still stands, and nothing on it counts the children a void
   * would carry down. Optional so a response from an older deploy degrades to
   * the copy that is true of every record instead of throwing.
   */
  cascade?: ForfeitCascade | null;
}

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
  /** The organiser's configured side colours for this tournament. */
  scoringConfig: TournamentScoringConfig | null;
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
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopening, setReopening] = useState(false);

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

  // The organiser's configured side colours. This page is light chrome, so a
  // black/white side is clamped to stay readable. Previously the score, the
  // round tally and the exchange deltas were all painted raw red/blue here,
  // while the sibling pools table already resolved them properly.
  const sideColors = sideColorsFor(summary?.scoringConfig ?? null, 'light');

  // Void modal state
  const [voidTarget, setVoidTarget] = useState<Exchange | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidSaving, setVoidSaving] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [forfeitReason, setForfeitReason] = useState<string>('injury');
  const [forfeitSide, setForfeitSide] = useState<'red' | 'blue'>('red');
  const [forfeitCanContinue, setForfeitCanContinue] = useState(true);
  const [forfeitSaving, setForfeitSaving] = useState(false);
  // Two scores, not one: an override states the whole result. Kept as strings
  // so the field can be emptied while typing without snapping back to 0.
  //
  // `null` means "untouched", and the field then SHOWS THE CURRENT SCORE rather
  // than a hard 0. Defaulting to 0 meant an organiser who picked a reason and
  // clicked — the shortest possible path — recorded 0–0 with a winner, and the
  // readers that compare scores and the readers that read winner_registration_id
  // then disagreed about that bout forever. Derived in render rather than
  // seeded by an effect, which react-hooks/set-state-in-effect forbids.
  const [overrideLosingScoreEdit, setOverrideLosingScore] = useState<string | null>(null);
  const [overrideWinningScoreEdit, setOverrideWinningScore] = useState<string | null>(null);
  const currentRedScore = match?.redScore ?? match?.red_score ?? 0;
  const currentBlueScore = match?.blueScore ?? match?.blue_score ?? 0;
  const overrideLosingScore =
    overrideLosingScoreEdit ?? String(forfeitSide === 'red' ? currentRedScore : currentBlueScore);
  const overrideWinningScore =
    overrideWinningScoreEdit ?? String(forfeitSide === 'red' ? currentBlueScore : currentRedScore);
  const [activeForfeit, setActiveForfeit] = useState<ActiveForfeit | null>(null);
  const [voidingForfeit, setVoidingForfeit] = useState(false);
  const isOverride = isOverrideReason(forfeitReason);
  // Derived in render, not in an effect: what a void does is a pure function of
  // the record the API just returned.
  const voidCopy = voidConfirmCopy(activeForfeit?.cascade);

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
      fetch(`${apiUrl}/api/v1/matches/${matchId}/forfeit`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([matchRes, summaryRes, exRes, auditRes, forfeitRes]) => {
        setLoading(false);
        if (matchRes.ok) setMatch((await matchRes.json()) as Match);
        if (summaryRes.ok) setSummary((await summaryRes.json()) as MatchSummary);
        if (exRes.ok) setExchanges((await exRes.json()) as Exchange[]);
        // One live record per match is a DB invariant, so this is the record a
        // second attempt would conflict with — and the one to void first.
        if (forfeitRes.ok) setActiveForfeit((await forfeitRes.json()) as ActiveForfeit | null);
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

  /**
   * Re-opening an ENDED bout un-completes it, so it goes through the
   * pre-flight dialog rather than a bare confirm: the organiser has to be told
   * which later bouts it empties, and which of them have already been fought,
   * before the request is made rather than by reading a 409 afterwards.
   */
  async function submitReopen(discardDependentResults: boolean) {
    if (!match) return;
    setReopening(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}/clock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'reopen',
          reason: 'Organizer re-opened ended match',
          discardDependentResults,
        }),
      });
      if (res.ok) {
        setReopenOpen(false);
        setRefreshKey((key) => key + 1);
      } else {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        toast.error(body.message ?? t('admin.common.couldNotReopenMatch'));
      }
    } finally {
      setReopening(false);
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
        // The DTO refuses canContinue on an override and requires the scores;
        // an override never withdraws anyone, so there is nothing to ask.
        canContinue:
          !isOverride && ['injury', 'voluntary', 'black_card_1'].includes(forfeitReason)
            ? forfeitCanContinue
            : undefined,
        explicitScores: isOverride
          ? {
              forfeitingScore: Number(overrideLosingScore) || 0,
              opponentScore: Number(overrideWinningScore) || 0,
            }
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

  /**
   * Void the live record so another can be written.
   *
   * The API refuses a second forfeit-or-override outright — one live row per
   * match is a DB invariant — so this is the whole remedy path. It stays behind
   * a confirmation because voiding restores the previous result and, on a
   * bracket, un-advances whoever it sent through.
   *
   * The body is assembled per record: what a void does depends entirely on
   * whether this record withdrew the fighter, was written under a withdrawal,
   * or closed nothing but its own bout.
   */
  async function handleVoidForfeit() {
    if (!activeForfeit) return;
    const ok = await confirm({
      title: t('organizer.bracketPage.voidRecordTitle'),
      // One paragraph, like the string this replaces — ConfirmDialog already
      // wraps `description` in a <p>, so nested block elements are invalid.
      description: voidCopy.body.map((line) => t(line.key, line.values)).join(' '),
      confirmLabel: t('organizer.bracketPage.voidRecord'),
      danger: true,
    });
    if (!ok) return;

    setVoidingForfeit(true);
    const res = await fetch(`${apiUrl}/api/v1/match-forfeits/${activeForfeit.id}/void`, {
      method: 'PATCH',
      credentials: 'include',
    });
    setVoidingForfeit(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      toast.error(body.message ?? t('organizer.bracketPage.voidRecordFailed'));
      return;
    }
    setActiveForfeit(null);
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
    <main className="mx-auto w-full max-w-4xl p-8">
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
                    a: summary.redName || '?',
                    b: summary.blueName || '?',
                  })
                : t('organizer.schedulePage.grid.versus', {
                    a: match?.redFighterName ?? '?',
                    b: match?.blueFighterName ?? '?',
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
              <span style={{ color: sideColors.red }}>{match?.redScore ?? 0}</span>
              <span className="text-muted mx-2">–</span>
              <span style={{ color: sideColors.blue }}>{match?.blueScore ?? 0}</span>
            </p>
            {summary?.bestOf != null && summary.bestOf > 1 && (
              <p className="mt-0.5 text-xs font-semibold text-muted tabular-nums">
                {t('organizer.matchDetail.bestOfLine', {
                  bestOf: summary.bestOf,
                  round: summary.currentRound ?? 1,
                })}{' '}
                <span style={{ color: sideColors.red }}>{summary.redRoundWins ?? 0}</span>
                <span className="mx-1">–</span>
                <span style={{ color: sideColors.blue }}>{summary.blueRoundWins ?? 0}</span>
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
                  onClick={() => setReopenOpen(true)}
                  className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning hover:border-warning hover:bg-warning/20"
                >
                  {t('organizer.matchDetail.reopenMatch')}
                </button>
              )}
            </div>
            <UncompleteHint matchId={matchId} refreshToken={refreshKey} />
          </div>
        </div>
      )}

      {pendingNotice && (
        <div className="mb-5 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {pendingNotice}
        </div>
      )}

      {/* One live record per match, so it is that record OR the form to write
          one — never both. Rendering the form beside an existing record is how
          a second submission became a silent no-op reported as success. */}
      {match && activeForfeit && (
        <section className="mb-6 rounded-xl border border-danger/30 bg-danger/10 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-danger">
            {t('organizer.bracketPage.activeRecordTitle')}
          </h2>
          <p className="mb-1 text-sm text-foreground">
            {t(
              (REASON_LABEL_KEY[activeForfeit.reason] ??
                'organizer.bracketPage.forfeitTitle') as never,
            )}
            {activeForfeit.forfeiting_score !== null && activeForfeit.opponent_score !== null && (
              <span className="text-muted">
                {' '}
                · {activeForfeit.forfeiting_score}–{activeForfeit.opponent_score}
              </span>
            )}
          </p>
          {activeForfeit.note && <p className="mb-2 text-sm text-muted">{activeForfeit.note}</p>}
          {/* The consequence, readable BEFORE the dialog opens — the panel is
              what an organiser looks at while deciding whether to click Void at
              all, and a cascaded child looks identical to a root without it. */}
          {voidCopy.hint && (
            <p className="mb-2 text-xs font-medium text-warning">
              {t(voidCopy.hint.key, voidCopy.hint.values)}
            </p>
          )}
          <p className="mb-3 text-xs text-muted">{t('organizer.bracketPage.activeRecordHint')}</p>
          <button
            type="button"
            onClick={() => void handleVoidForfeit()}
            disabled={voidingForfeit}
            className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-danger-foreground disabled:opacity-50"
          >
            {voidingForfeit
              ? t('organizer.matchDetail.recording')
              : t('organizer.bracketPage.voidRecord')}
          </button>
        </section>
      )}

      {match && !activeForfeit && (
        <section className="mb-6 rounded-xl border border-danger/30 bg-danger/10 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-danger">
            {isOverride
              ? t('organizer.bracketPage.overrideTitle')
              : t('organizer.bracketPage.forfeitTitle')}
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
            {/* Both groups come from @myclash/rulesets, which owns the enum —
                a reason added there appears here without a second edit. */}
            <select
              value={forfeitReason}
              onChange={(event) => setForfeitReason(event.target.value)}
              className="rounded-lg border border-danger/30 bg-surface px-3 py-2 text-sm"
            >
              <optgroup label={t('organizer.bracketPage.forfeitReasonGroup')}>
                {FORFEIT_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {t(REASON_LABEL_KEY[reason] as never)}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t('organizer.bracketPage.overrideReasonGroup')}>
                {OVERRIDE_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {t(REASON_LABEL_KEY[reason] as never)}
                  </option>
                ))}
              </optgroup>
            </select>
            {isOverride ? (
              <>
                <label className="flex items-center gap-2 text-sm text-danger">
                  {t('organizer.bracketPage.overrideLosingScore')}
                  <input
                    type="number"
                    min={0}
                    value={overrideLosingScore}
                    onChange={(event) => setOverrideLosingScore(event.target.value)}
                    className="w-20 rounded-lg border border-danger/30 bg-surface px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-danger">
                  {t('organizer.bracketPage.overrideWinningScore')}
                  <input
                    type="number"
                    min={0}
                    value={overrideWinningScore}
                    onChange={(event) => setOverrideWinningScore(event.target.value)}
                    className="w-20 rounded-lg border border-danger/30 bg-surface px-3 py-2 text-sm"
                  />
                </label>
              </>
            ) : (
              ['injury', 'voluntary', 'black_card_1'].includes(forfeitReason) && (
                <label className="flex items-center gap-2 text-sm text-danger">
                  <input
                    type="checkbox"
                    checked={forfeitCanContinue}
                    onChange={(event) => setForfeitCanContinue(event.target.checked)}
                  />
                  {t('organizer.matchDetail.canContinue')}
                </label>
              )
            )}
            <button
              type="button"
              onClick={() => void handleForfeit()}
              disabled={forfeitSaving}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-danger-foreground disabled:opacity-50"
            >
              {forfeitSaving
                ? t('organizer.matchDetail.recording')
                : isOverride
                  ? t('organizer.bracketPage.overrideTitle')
                  : t('organizer.bracketPage.forfeitTitle')}
            </button>
          </div>
          {isOverride && (
            <p className="mt-3 text-xs text-muted">{t('organizer.bracketPage.overrideHint')}</p>
          )}
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
                              <span style={{ color: sideColors.red }}>
                                {t('organizer.matchDetail.redDelta', {
                                  delta: ex.redScoreDelta,
                                })}{' '}
                              </span>
                            )}
                            {ex.blueScoreDelta > 0 && (
                              <span style={{ color: sideColors.blue }}>
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
      <UncompleteDialog
        // Remount per opening: the tick must never be inherited from last time.
        key={reopenOpen ? 'uncomplete-open' : 'uncomplete-closed'}
        matchId={matchId}
        open={reopenOpen}
        refreshToken={refreshKey}
        busy={reopening}
        onCancel={() => setReopenOpen(false)}
        onConfirm={(discard) => void submitReopen(discard)}
      />
    </main>
  );
}
