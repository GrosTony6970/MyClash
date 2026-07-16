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
import { Modal } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';

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

const WARNING_REASON_IDS: WarningReason[] = [
  'unsportsmanlike_conduct',
  'illegal_technique',
  'equipment_violation',
  'excessive_force',
  'other',
];

export default function RefereeMatchPage() {
  const { t } = useI18n();
  const params = useParams<{ eventSlug: string; matchId: string }>();
  const { eventSlug, matchId } = params;
  const apiUrl = getPublicApiUrl();

  const warningReasonLabels: Record<WarningReason, string> = {
    unsportsmanlike_conduct: t('publicApp.refereePublic.warningReasons.unsportsmanlikeConduct'),
    illegal_technique: t('publicApp.refereePublic.warningReasons.illegalTechnique'),
    equipment_violation: t('publicApp.refereePublic.warningReasons.equipmentViolation'),
    excessive_force: t('publicApp.refereePublic.warningReasons.excessiveForce'),
    other: t('publicApp.refereePublic.warningReasons.other'),
  };

  const roleLabels: Record<string, string> = {
    arbitre_declarant: t('publicApp.fighterProfile.arbitreDeclarant'),
    arbitre_assesseur: t('publicApp.fighterProfile.arbitreAssesseur'),
    arbitre_table: t('publicApp.fighterProfile.arbitreTable'),
  };

  const statusLabels: Record<string, string> = {
    scheduled: t('scoring.liveMatch.status.scheduled'),
    running: t('scoring.liveMatch.status.running'),
    halted: t('publicApp.refereePublic.matchStatusHalted'),
    paused: t('scoring.liveMatch.status.paused'),
    completed: t('scoring.liveMatch.status.completed'),
    voided: t('scoring.liveMatch.status.voided'),
  };

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
        body: JSON.stringify({
          message: t('publicApp.refereePublic.attentionMessage'),
          role: refereeCtx?.role,
        }),
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
        <span className="w-8 h-8 border-2 border-muted border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (!match) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <p className="text-4xl mb-3">⚔️</p>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground mb-2">
            {t('publicApp.refereePublic.matchNotFound')}
          </h1>
          <Link href={`/e/${eventSlug}/referee`} className="text-sm text-muted hover:underline">
            ← {t('publicApp.refereePublic.backToDuties')}
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
        className="text-sm text-muted hover:text-foreground-secondary mb-4 inline-block"
      >
        ← {t('publicApp.refereePublic.refereeDuties')}
      </Link>

      {/* Match header */}
      <div className="mb-4">
        <h1
          className="font-display font-bold text-2xl sm:text-3xl"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--event-primary, #c0392b)' }}
        >
          {match.matchNumberLabel}
        </h1>
        {refereeCtx && (
          <p className="text-sm text-muted mt-0.5">
            {t('publicApp.refereePublic.yourRole')}{' '}
            <strong>{roleLabels[refereeCtx.role] ?? refereeCtx.role}</strong>
          </p>
        )}
      </div>

      {/* Scoreboard */}
      <div className="grid grid-cols-3 items-center gap-3 mb-6">
        <div className="text-center">
          <div className="bg-corner-red/10 border-2 border-corner-red rounded-xl p-3">
            <p className="text-xs text-corner-red font-bold uppercase mb-0.5">
              {t('publicApp.refereePublic.cornerRed')}
            </p>
            <p className="font-bold text-foreground text-sm leading-tight">
              {match.redFighterName ?? '?'}
            </p>
          </div>
          <p className="text-4xl font-black text-corner-red mt-2 tabular-nums">{match.redScore}</p>
        </div>
        <div className="text-center">
          <p className="text-muted text-xl font-bold">{t('publicApp.refereePublic.vs')}</p>
          <p className="text-xs text-muted mt-1 uppercase tracking-widest">
            {statusLabels[match.status] ?? match.status}
          </p>
        </div>
        <div className="text-center">
          <div className="bg-corner-blue/10 border-2 border-corner-blue rounded-xl p-3">
            <p className="text-xs text-corner-blue font-bold uppercase mb-0.5">
              {t('publicApp.refereePublic.cornerBlue')}
            </p>
            <p className="font-bold text-foreground text-sm leading-tight">
              {match.blueFighterName ?? '?'}
            </p>
          </div>
          <p className="text-4xl font-black text-corner-blue mt-2 tabular-nums">
            {match.blueScore}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3">
        {/* Halt/Resume — all referees */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => void clockAction('halt')}
            disabled={acting || match.status !== 'running'}
            className="py-4 rounded-xl font-bold text-lg bg-warning hover:bg-warning-hover text-warning-foreground disabled:opacity-40 transition-colors"
          >
            {t('scoring.clock.halt')}
          </button>
          <button
            onClick={() => void clockAction('resume')}
            disabled={acting || match.status !== 'halted'}
            className="py-4 rounded-xl font-bold text-lg bg-success hover:bg-success-hover text-success-foreground disabled:opacity-40 transition-colors"
          >
            {t('scoring.clock.resume')}
          </button>
        </div>

        {/* Warning — declarant only */}
        {isDeclarant && (
          <button
            onClick={() => setShowWarning(true)}
            disabled={acting}
            className="py-3 rounded-xl font-bold text-base bg-warning hover:bg-warning-hover text-warning-foreground disabled:opacity-40 transition-colors"
          >
            {t('publicApp.refereePublic.issueWarning')}
          </button>
        )}

        {/* Attention — all referees */}
        <button
          onClick={() => void requestAttention()}
          disabled={acting}
          className="py-3 rounded-xl font-bold text-base border-2 border-border text-foreground-secondary hover:border-muted disabled:opacity-40 transition-colors"
        >
          🔔 {t('publicApp.refereePublic.requestAttention')}
        </button>

        {/* Table-specific tools */}
        {isTable && (
          <div className="bg-surface border border-border rounded-xl p-3 text-sm text-muted">
            <p className="font-medium text-foreground-secondary mb-1">
              {t('publicApp.refereePublic.scoringOversight')}
            </p>
            <p className="text-xs">{t('publicApp.refereePublic.scoringOversightBody')}</p>
          </div>
        )}
      </div>

      {/* Warning modal */}
      <Modal
        open={showWarning}
        onClose={() => setShowWarning(false)}
        busy={acting}
        size="md"
        title={t('publicApp.refereePublic.issueWarning')}
        footer={
          <div className="flex w-full gap-2">
            <button
              onClick={() => setShowWarning(false)}
              className="flex-1 py-2 rounded-lg border border-border text-muted text-sm"
            >
              {t('actions.cancel')}
            </button>
            <button
              onClick={() => void issueWarning()}
              disabled={acting}
              className="flex-1 py-2 rounded-lg bg-warning hover:bg-warning-hover text-warning-foreground font-semibold text-sm disabled:opacity-50"
            >
              {acting ? '…' : t('publicApp.refereePublic.issueWarning')}
            </button>
          </div>
        }
      >
        {/* Target */}
        <div className="mb-4">
          <p className="text-xs text-muted mb-2">{t('publicApp.refereePublic.targetFighter')}</p>
          <div className="grid grid-cols-2 gap-2">
            {(['red', 'blue'] as const).map((color) => (
              <button
                key={color}
                onClick={() => setWarningTarget(color)}
                className={[
                  'py-2 rounded-lg font-semibold text-sm border-2 transition-colors',
                  warningTarget === color
                    ? color === 'red'
                      ? 'border-corner-red bg-corner-red/10 text-corner-red'
                      : 'border-corner-blue bg-corner-blue/10 text-corner-blue'
                    : 'border-border text-muted',
                ].join(' ')}
              >
                {color === 'red'
                  ? (match.redFighterName ?? t('publicApp.refereePublic.cornerRed'))
                  : (match.blueFighterName ?? t('publicApp.refereePublic.cornerBlue'))}
              </button>
            ))}
          </div>
        </div>

        {/* Reason */}
        <div className="mb-4">
          <p className="text-xs text-muted mb-2">{t('publicApp.refereePublic.reason')}</p>
          <div className="flex flex-col gap-1.5">
            {WARNING_REASON_IDS.map((id) => (
              <button
                key={id}
                onClick={() => setWarningReason(id)}
                className={[
                  'text-left px-3 py-2 rounded-lg text-sm border transition-colors',
                  warningReason === id
                    ? 'border-warning bg-warning/10 text-warning'
                    : 'border-border text-muted',
                ].join(' ')}
              >
                {warningReasonLabels[id]}
              </button>
            ))}
          </div>
        </div>

        {/* Note */}
        <div className="mb-4">
          <p className="text-xs text-muted mb-1">{t('publicApp.refereePublic.noteOptional')}</p>
          <input
            type="text"
            value={warningNote}
            onChange={(e) => setWarningNote(e.target.value)}
            placeholder={t('publicApp.refereePublic.notePlaceholder')}
            className="w-full bg-surface border border-border text-foreground rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </Modal>
    </main>
  );
}
