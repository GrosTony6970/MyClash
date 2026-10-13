import { isPubliclyVisible, type EventKind } from '@myclash/types';

/**
 * What a tap on Share does (quick win F19; operator ruling 2026-10-13): the
 * phone's share sheet where there is one; else the address is copied, and the
 * person is told; a copy that fails says so. The ONE owner: every Share button
 * of the public site asks here.
 */

/** What the tap did. `closed`: the person shut the sheet, which is no fault. */
export type ShareOutcome = 'shared' | 'closed' | 'copied' | 'failed';

/** `navigator`, narrowed to what Share asks of it. A desktop browser may have no `share`. */
export interface ShareDoors {
  share?: (data: { title: string; url: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

function closedByThePerson(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'AbortError';
}

/**
 * Share `url`. Each door is called as a method of `doors`: taken off
 * `navigator`, `share` throws "Illegal invocation".
 */
export async function shareLink(
  url: string,
  title: string,
  doors: ShareDoors,
): Promise<ShareOutcome> {
  if (typeof doors.share === 'function') {
    try {
      await doors.share({ title, url });
      return 'shared';
    } catch (error) {
      if (closedByThePerson(error)) return 'closed';
      // Any other fault of the sheet: the copy below still gets the link out.
    }
  }
  try {
    // No clipboard on a page served without https.
    if (!doors.clipboard) return 'failed';
    await doors.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/**
 * May the public open this Tournament's page? Share is drawn only then: a link
 * to a draft Tournament, or to a Tournament of a draft or test Event, says
 * "Page not found" to everybody outside the club (operator ruling 2026-10-14).
 * The API decides who reads what (`isPublicEvent`); this only keeps a club
 * member from sending a link that opens for nobody. `event` is null when its
 * read gave none.
 */
export function publicCanOpenTournament(
  event: { status: string; eventKind: EventKind } | null,
  tournamentStatus: string,
): boolean {
  return (
    event !== null &&
    event.status !== 'draft' &&
    isPubliclyVisible(event.eventKind) &&
    tournamentStatus !== 'draft'
  );
}

/** The words the button shows after a tap, as a key; null when there is nothing to say. */
export function shareMessageKey(outcome: ShareOutcome | null): string | null {
  if (outcome === 'copied') return 'publicApp.share.copied';
  if (outcome === 'failed') return 'publicApp.share.copyFailed';
  return null;
}
