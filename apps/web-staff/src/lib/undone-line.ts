/**
 * What the round-break screen says after an undo that left its round closed
 * (operator, 2026-10-11).
 *
 * A round "End round" closed stays closed when one of its entries is
 * cancelled: the server moves its score and keeps its winner. The screen
 * stayed up on another score with no word. It now names the entry that was
 * cancelled and says the round stays closed.
 *
 * The race NOT handled: an undo tapped in the moment after the server took
 * "End round" and before the bout is read again. The screen then forgets the
 * round it had closed (`usePadRounds`, `forget`), closes, and opens again at
 * the read with no sentence and with its one undo per break given back.
 *
 * Pure, out of the component: web-staff has no React test setup.
 */
import {
  buildUnifiedTimeline,
  exchangeOptionLabel,
  type BuildTimelineArgs,
  type ExchangeRow,
  type Penalty,
} from '@myclash/ui';
import type { UndoneEntry } from './clear-last';

/** The bout as its screen holds it, at the tap of the undo. */
interface BoutOnScreen {
  scoring: {
    activeExchanges: ExchangeRow[];
    pendingExchanges: ExchangeRow[];
    activePenalties: Penalty[];
    pendingPenalties: Penalty[];
  };
  match: {
    redRegistrationId: string;
    blueRegistrationId: string;
    redFighterName?: string;
    blueFighterName?: string;
  };
  config: BuildTimelineArgs['config'];
  t: BuildTimelineArgs['t'];
}

/**
 * The entry an undo took, worded as the bout's list words it, with the number
 * it has there (`exchangeOptionLabel`, the one owner of that line). Null when
 * this screen's list does not hold it: another tablet scored it a moment ago.
 */
export function entryLine(entry: UndoneEntry, bout: BoutOnScreen): string | null {
  const { scoring, match, config, t } = bout;
  const list = buildUnifiedTimeline({
    exchanges: [...scoring.activeExchanges, ...scoring.pendingExchanges],
    penalties: [...scoring.activePenalties, ...scoring.pendingPenalties],
    redName: match.redFighterName ?? t('scoring.lice.red'),
    blueName: match.blueFighterName ?? t('scoring.lice.blue'),
    redRegId: match.redRegistrationId,
    blueRegId: match.blueRegistrationId,
    t,
    config,
  });
  // A line of the server's is found by the server's id, a waiting one by the tablet's.
  const line = list.find((row) => row.rawId === entry.id || row.rawId === entry.clientUuid);
  return line ? exchangeOptionLabel(line) : null;
}

/** "Cancelled: <entry>. Round N stays closed." With no name when the list did not hold the entry. */
export function roundStaysClosed(
  label: string | null,
  round: number,
  t: BuildTimelineArgs['t'],
): string {
  return label
    ? t('scoring.rounds.undoneStaysClosed', { entry: label, round: String(round) })
    : t('scoring.rounds.undoneUnnamedStaysClosed', { round: String(round) });
}
