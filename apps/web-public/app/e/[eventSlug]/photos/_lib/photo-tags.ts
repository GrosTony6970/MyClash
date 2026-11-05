import { fetchTournaments, fetchWorkshops } from '../../home/_lib/public-event-data';
import type { PhotoTags } from '../_components/TagOptions';

/**
 * The Tournaments and Workshops a photo can be about, read on the server with the visitor's
 * login, as the Event home reads them: the send page's tag and the photos page's filter.
 */
export async function readPhotoTags(
  eventId: string,
  eventSlug: string,
  apiUrl: string,
): Promise<PhotoTags> {
  const [tournaments, workshops] = await Promise.all([
    fetchTournaments(eventId, apiUrl),
    fetchWorkshops(eventSlug, apiUrl),
  ]);
  return {
    tournaments: tournaments.map(({ id, name }) => ({ id, name })),
    workshops: workshops.map(({ id, title }) => ({ id, title })),
  };
}
