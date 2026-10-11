'use client';

import { Modal } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import type { UndoLast } from '../hooks/useUndoLast';

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
  /** A best-of bout: the End of this warning ends the ROUND, and says so. */
  endsRound: boolean;
  onEnd: () => void;
}

/**
 * The ruleset says the clock should not restart at zero remaining or inside
 * the soft zone: the official decides.
 *
 * Close comes FIRST, so the focus lands on it (operator, 2026-10-09). With
 * "Continue anyway" first, Space twice restarted the clock and the warning
 * protected nothing.
 *
 * On a best-of bout the End reads "End round" (operator, 2026-10-10). It read
 * "End match" and ended the clock: the bout was completed with no winner and
 * no round closed.
 */
export function ResumeGuardDialog({
  open,
  onClose,
  onContinue,
  endsRound,
  onEnd,
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
            onClick={onEnd}
            className="min-h-[44px] rounded-lg border-2 border-danger bg-danger/20 px-4 py-2 text-sm font-bold text-danger hover:bg-danger/30"
          >
            {t(endsRound ? 'scoring.rounds.endRound' : 'scoring.resumeGuard.endMatch')}
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
      <p className="text-sm text-foreground-secondary">
        {t(endsRound ? 'scoring.resumeGuard.messageRound' : 'scoring.resumeGuard.message')}
      </p>
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
  /** The TABLET closed this round: the server has not confirmed it (operator, 2026-10-10). */
  unconfirmed: boolean;
  error: string | null;
  /** "Undo last entry" of the bout: the same undo as the controls' (`useUndoLast`). */
  undo: UndoLast;
  /** An undo cancelled an entry and this round stays closed: the sentence that says so. */
  undone: string | null;
  onStart: () => void;
}

/** The rounds each side has won, each in its side's colour. */
function SeriesTally({ red, blue }: { red: [number, string]; blue: [number, string] }) {
  const { t } = useI18n();
  return (
    <p className="text-sm font-semibold text-muted">
      {t('scoring.rounds.seriesTally')} <span style={{ color: red[1] }}>{red[0]}</span>
      {' – '}
      <span style={{ color: blue[1] }}>{blue[0]}</span>
    </p>
  );
}

/** The TABLET closed the round: the server has not confirmed it (operator, 2026-10-10). */
function ClosedOnTablet() {
  const { t } = useI18n();
  return (
    <p
      role="status"
      data-testid="round-closed-on-tablet"
      className="mb-4 rounded-lg bg-warning/15 px-3 py-2 text-sm font-bold text-warning"
    >
      {t('scoring.rounds.closedOnTablet')}
    </p>
  );
}

/**
 * Best-of round break: a round ended without clinching the match. Shows the
 * round's result and lets the official start the next round, which resets the
 * clock and the score to 0–0.
 *
 * "Start round" is a row of the tablet's queue: the screen closes at the tap,
 * with a network or with none, so the button is never disabled. (A disabled
 * button here left the focus on "End round" behind the screen, and Space
 * pressed that.)
 *
 * "Undo last entry" comes SECOND (operator, 2026-10-11): a hit tapped on the
 * wrong side that took a fighter to the cap is taken back here, and the round
 * is open again. The focus stays on "Start round", the first button. The undo
 * is never disabled either: a tap while one is out does nothing, and one undo
 * lands per break (`useUndoLast`). A round "End round" closed is another case:
 * while that press waits on the tablet the undo is refused, and once the server
 * holds it the server judges the undo: the round stays closed, the screen stays
 * up, and it says which entry was cancelled (`undone`).
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
  unconfirmed,
  error,
  undo,
  undone,
  onStart,
}: RoundBreakDialogProps) {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      onClose={staysOpen}
      title={t('scoring.rounds.roundComplete', { round: String(round) })}
      footer={<RoundBreakButtons round={round} undo={undo} onStart={onStart} />}
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
        {unconfirmed && <ClosedOnTablet />}
        <SeriesTally red={[redRoundWins, redColor]} blue={[blueRoundWins, blueColor]} />
        {error && <p className="mt-3 text-xs font-normal text-danger">{error}</p>}
        <UndoSaid undo={undo} undone={undone} />
      </div>
    </Modal>
  );
}

/** What the undo said: why it took nothing, or what it took from a round that stays closed. */
function UndoSaid({ undo, undone }: Pick<RoundBreakDialogProps, 'undo' | 'undone'>) {
  return (
    <>
      {undo.error && (
        <p role="alert" className="mt-3 text-xs font-normal text-danger">
          {undo.error}
        </p>
      )}
      {undo.notice && (
        <p role="status" className="mt-3 text-xs font-normal text-info">
          {undo.notice}
        </p>
      )}
      {undone && (
        <p
          role="status"
          data-testid="round-break-undone"
          className="mt-3 text-xs font-normal text-info"
        >
          {undone}
        </p>
      )}
    </>
  );
}

/** The two buttons of the round break, "Start round" FIRST: the dialog gives it the focus. */
function RoundBreakButtons({
  round,
  undo,
  onStart,
}: Pick<RoundBreakDialogProps, 'round' | 'undo' | 'onStart'>) {
  const { t } = useI18n();
  return (
    <>
      <button
        type="button"
        data-testid="start-next-round"
        onClick={onStart}
        className="min-h-[44px] rounded-lg border-2 border-info bg-info/20 px-6 py-2 text-sm font-bold text-info hover:bg-info/30"
      >
        {t('scoring.rounds.startRound', { round: String(round + 1) })} →
      </button>
      <button
        type="button"
        data-testid="round-break-undo"
        onClick={undo.undo}
        className="min-h-[44px] rounded-lg border-2 border-border bg-surface px-4 py-2 text-sm font-bold text-foreground-secondary hover:bg-border"
      >
        ↶ {t('scoring.corrections.clearLastExchange')}
      </button>
    </>
  );
}
