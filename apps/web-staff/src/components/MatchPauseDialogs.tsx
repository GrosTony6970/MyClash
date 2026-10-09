'use client';

import { Modal } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';

/**
 * The screens that stand between the official and the clock: the question on
 * an early End, the resume warning and the break between two rounds.
 *
 * All are the shared `Modal`, and that is the point. The Space bar asks the
 * page for an open dialog before it touches the clock (`MatchView`). The last two
 * were plain `div`s, so Space found none and resumed the clock behind the
 * "Round complete" screen while nobody fought.
 *
 * A dialog takes the keyboard focus, and Space presses the focused button. So
 * the ORDER of the buttons is a decision, not a layout.
 */

interface EndEarlyDialogProps {
  open: boolean;
  onClose: () => void;
  onEndMatch: () => void;
}

/**
 * "End match" was pressed before the cap or the time (`end-guard.ts`): the
 * official says whether that was meant.
 *
 * Close comes FIRST, as on the resume warning, so the focus lands on it: a
 * Space after a slip closes the question and ends nothing.
 */
export function EndEarlyDialog({ open, onClose, onEndMatch }: EndEarlyDialogProps) {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('scoring.endGuard.title')}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg border-2 border-border bg-surface px-4 py-2 text-sm font-bold text-foreground-secondary hover:bg-border"
          >
            {t('scoring.result.close')}
          </button>
          <button
            type="button"
            data-testid="end-early-confirm"
            onClick={onEndMatch}
            className="min-h-[44px] rounded-lg border-2 border-danger bg-danger/20 px-4 py-2 text-sm font-bold text-danger hover:bg-danger/30"
          >
            {t('scoring.clock.endMatch')}
          </button>
        </>
      }
    >
      <p className="text-sm text-foreground-secondary">{t('scoring.endGuard.message')}</p>
    </Modal>
  );
}

interface ResumeGuardDialogProps {
  open: boolean;
  onClose: () => void;
  onContinue: () => void;
  onEndMatch: () => void;
}

/**
 * The ruleset says the clock should not restart at zero remaining or inside
 * the soft zone: the official decides.
 *
 * Close comes FIRST, so the focus lands on it (operator, 2026-10-09). With
 * "Continue anyway" first, Space twice restarted the clock and the warning
 * protected nothing.
 */
export function ResumeGuardDialog({
  open,
  onClose,
  onContinue,
  onEndMatch,
}: ResumeGuardDialogProps) {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('scoring.resumeGuard.title')}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg border-2 border-border bg-surface px-4 py-2 text-sm font-bold text-foreground-secondary hover:bg-border"
          >
            {t('scoring.result.close')}
          </button>
          <button
            type="button"
            onClick={onEndMatch}
            className="min-h-[44px] rounded-lg border-2 border-danger bg-danger/20 px-4 py-2 text-sm font-bold text-danger hover:bg-danger/30"
          >
            {t('scoring.resumeGuard.endMatch')}
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="min-h-[44px] rounded-lg border-2 border-warning bg-warning/20 px-4 py-2 text-sm font-bold text-warning hover:bg-warning/30"
          >
            {t('scoring.resumeGuard.continueAnyway')}
          </button>
        </>
      }
    >
      <p className="text-sm text-foreground-secondary">{t('scoring.resumeGuard.message')}</p>
    </Modal>
  );
}

/**
 * Escape and a tap on the backdrop close a `Modal`. The break between two
 * rounds has one way out, "Start round N+1": anything else would leave a bout
 * that takes no hit behind a screen that is gone.
 */
const staysOpen = () => {};

interface RoundBreakDialogProps {
  open: boolean;
  /** The round that just closed. */
  round: number;
  /** The ROUND's winner, or null when the row does not say. */
  winner: { name: string; color: string } | null;
  redScore: number;
  blueScore: number;
  redRoundWins: number;
  blueRoundWins: number;
  redColor: string;
  blueColor: string;
  error: string | null;
  busy: boolean;
  onStart: () => void;
}

/**
 * Best-of round break: a round ended without clinching the match. Shows the
 * round's result and lets the official start the next round, which resets the
 * clock and the score to 0–0.
 *
 * While busy the button is `aria-disabled`, never `disabled`: the dialog gives
 * its focus to the first button that is not disabled, once, when it opens. A
 * screen that opened on a disabled button left the focus on "End round" behind
 * it, and Space pressed that.
 */
export function RoundBreakDialog({
  open,
  round,
  winner,
  redScore,
  blueScore,
  redRoundWins,
  blueRoundWins,
  redColor,
  blueColor,
  error,
  busy,
  onStart,
}: RoundBreakDialogProps) {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      onClose={staysOpen}
      title={t('scoring.rounds.roundComplete', { round: String(round) })}
      footer={
        <button
          type="button"
          aria-disabled={busy}
          onClick={busy ? undefined : onStart}
          className="min-h-[44px] rounded-lg border-2 border-info bg-info/20 px-6 py-2 text-sm font-bold text-info hover:bg-info/30 aria-disabled:opacity-40"
        >
          {t('scoring.rounds.startRound', { round: String(round + 1) })} →
        </button>
      }
    >
      <div className="text-center">
        {winner && (
          <p className="mb-2 text-2xl font-black" style={{ color: winner.color }}>
            <span aria-hidden>🏆</span> {winner.name}
          </p>
        )}
        <p className="mb-4 font-mono text-2xl font-bold text-foreground-secondary">
          {redScore} – {blueScore}
        </p>
        <p className="text-sm font-semibold text-muted">
          {t('scoring.rounds.seriesTally')} <span style={{ color: redColor }}>{redRoundWins}</span>
          {' – '}
          <span style={{ color: blueColor }}>{blueRoundWins}</span>
        </p>
        {error && <p className="mt-3 text-xs font-normal text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
