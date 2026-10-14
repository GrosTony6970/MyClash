import { apiRequest, failureMessage } from '@myclash/api-client';
import type { Translator } from '@myclash/next-i18n/client';

interface Person {
  id: string;
  givenName: string;
  familyName: string;
}

interface Registration {
  id: string;
  personId: string;
  tournamentId: string;
}

export interface Tournament {
  id: string;
  name: string;
}

export interface PenaltyReview {
  id: string;
  tournament_id: string;
  registration_id: string;
  review_type: string;
  status: 'pending' | 'confirmed' | 'dismissed';
  black_card_count: number | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface PenaltyReviewsRead {
  tournaments: Tournament[];
  reviews: PenaltyReview[];
  /** registration id → fighter name (never a raw id on screen). */
  personByRegistration: Map<string, string>;
  /** One sentence per read that failed. Empty: every list on screen is whole (O10). */
  problems: string[];
}

/**
 * Every read of the penalty reviews page. A Tournament whose reviews could not be read
 * used to count as one with no review (quick win O10): a pending disqualification was
 * missed on a network blip. Each failed read is named instead, and the lists that did
 * land are still shown. `null` when the read was cut short (the page left).
 */
export async function readPenaltyReviews(
  apiUrl: string,
  eventId: string,
  t: Translator,
  signal: AbortSignal,
): Promise<PenaltyReviewsRead | null> {
  const init = { signal };
  const [tRes, rRes, pRes] = await Promise.all([
    apiRequest<Tournament[]>(apiUrl, `/api/v1/events/${eventId}/tournaments`, init),
    apiRequest<Registration[]>(apiUrl, `/api/v1/events/${eventId}/registrations`, init),
    apiRequest<Person[]>(apiUrl, `/api/v1/events/${eventId}/persons`, init),
  ]);
  if (signal.aborted) return null;
  const problems: string[] = [];
  const said = (message: string | null) => message && problems.push(message);
  if (!tRes.ok) {
    // The whole page is a list of reviews per tournament: without them there is nothing.
    said(failureMessage(tRes, t, t('organizer.penaltyReviews.loadError')));
    return { tournaments: [], reviews: [], personByRegistration: new Map(), problems };
  }
  const personByRegistration = new Map<string, string>();
  if (rRes.ok && pRes.ok) {
    const nameByPerson = new Map(
      pRes.data.map((p) => [p.id, `${p.givenName} ${p.familyName}`.trim()]),
    );
    for (const r of rRes.data) personByRegistration.set(r.id, nameByPerson.get(r.personId) ?? '');
  } else {
    said(t('organizer.penaltyReviews.namesLoadError'));
  }
  const lists = await Promise.all(
    tRes.data.map(async (tournament) => {
      const res = await apiRequest<PenaltyReview[]>(
        apiUrl,
        `/api/v1/tournaments/${tournament.id}/penalty-reviews`,
        init,
      );
      if (res.ok) return res.data;
      if (res.kind !== 'aborted') {
        said(t('organizer.penaltyReviews.tournamentLoadError', { tournament: tournament.name }));
      }
      return [];
    }),
  );
  if (signal.aborted) return null;
  return { tournaments: tRes.data, reviews: lists.flat(), personByRegistration, problems };
}
