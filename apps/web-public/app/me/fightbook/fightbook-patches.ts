import type { AgreedSpar, IncomingSparRequest, SparFighter, SparReview } from '@myclash/types';
import type { FightBookData } from './use-fightbook';

/**
 * How each FightBook write changes the page's lists, from the write's own answer: no re-read, so
 * a tap never flashes the list. Pure, one per write.
 */
type Patch = (data: FightBookData) => Partial<FightBookData>;

const bySpar = (a: AgreedSpar, b: AgreedSpar) =>
  a.day.localeCompare(b.day) || (a.time ?? '').localeCompare(b.time ?? '');

/** A request she said yes to, as My spars shows it: nothing written on it yet. */
function agreedFrom(request: IncomingSparRequest): AgreedSpar {
  const { asker, id, kind, eventName, day, time, place, weapons, message } = request;
  const { markFrom, markUntil, cancelUntil } = request;
  return {
    ...{ id, kind, eventName, day, time, place, weapons, message },
    ...{ markFrom, markUntil, cancelUntil },
    partner: asker,
    iAsked: false,
    status: 'agreed',
    cancelledByMe: null,
    cancelMessage: null,
    myReview: null,
    theirThanks: null,
    note: null,
    partnerFavourite: null,
    iFlagged: false,
  };
}

/**
 * Answered (or lost to a request no longer open, `status` null): out of the Inbox; a yes is a spar.
 * Each patch leaves alone what is already there: a re-read can land between a write and its
 * answer, and has then listed the spar or the block already.
 */
export const answered =
  (request: IncomingSparRequest, status: string | null): Patch =>
  (d) => ({
    inbox: d.inbox.filter((r) => r.id !== request.id),
    spars:
      status === 'agreed' && !d.spars.spars.some((s) => s.id === request.id)
        ? { ...d.spars, spars: [...d.spars.spars, agreedFrom(request)].sort(bySpar) }
        : d.spars,
  });

/** As fightbook_block does: their requests to me end, and my request still waiting goes. */
export const blocked =
  (asker: SparFighter): Patch =>
  (d) => ({
    inbox: d.inbox.filter((r) => r.asker.globalPersonId !== asker.globalPersonId),
    blocks: [
      { fighter: asker },
      ...d.blocks.filter((b) => b.fighter.globalPersonId !== asker.globalPersonId),
    ],
    spars: {
      ...d.spars,
      sent: d.spars.sent.filter(
        (s) => !(s.receiver.globalPersonId === asker.globalPersonId && s.status === 'pending'),
      ),
    },
  });

export const withdrawn =
  (id: string): Patch =>
  (d) => ({ spars: { ...d.spars, sent: d.spars.sent.filter((s) => s.id !== id) } });

export const cancelled =
  (id: string, message: string | null): Patch =>
  (d) => ({
    spars: {
      ...d.spars,
      spars: d.spars.spars.map((s) =>
        s.id === id
          ? { ...s, status: 'cancelled' as const, cancelledByMe: true, cancelMessage: message }
          : s,
      ),
    },
  });

/** Each one moves only a spar still in the state the write started from (a re-read may be ahead). */
const patchSpar =
  (id: string, from: AgreedSpar['status'], change: Partial<AgreedSpar>): Patch =>
  (d) => ({
    spars: {
      ...d.spars,
      spars: d.spars.spars.map((s) => (s.id === id && s.status === from ? { ...s, ...change } : s)),
    },
  });

export const markedDone = (id: string) => patchSpar(id, 'agreed', { status: 'done' });

export const undone = (id: string) => patchSpar(id, 'done', { status: 'agreed' });

export const reviewed = (id: string, review: SparReview) =>
  patchSpar(id, 'done', { myReview: review });

export const noted = (id: string, note: string | null) => patchSpar(id, 'done', { note });

/** A heart set from My spars: every spar with that partner shows it (null stays: no heart there). */
export const hearted =
  (globalPersonId: string, favourite: boolean): Patch =>
  (d) => ({
    spars: {
      ...d.spars,
      spars: d.spars.spars.map((s) =>
        s.partner.globalPersonId === globalPersonId && s.partnerFavourite !== null
          ? { ...s, partnerFavourite: favourite }
          : s,
      ),
    },
  });

/** The star switch saved: the page's settings say what was saved. */
export const starsShown =
  (showStars: boolean): Patch =>
  (d) => ({ settings: { ...d.settings, showStars } });

export const unblocked =
  (id: string): Patch =>
  (d) => ({ blocks: d.blocks.filter((b) => b.fighter.globalPersonId !== id) });
