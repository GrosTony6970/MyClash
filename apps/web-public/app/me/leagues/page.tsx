import LeaguesClient from './LeaguesClient';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('publicApp.titles.meLeagues');

/** `/me/leagues` — the leagues (classement) the signed-in fighter is ranked in.
 *  The client island resolves the API URL and is locale-aware. */
export default function MeLeaguesPage() {
  return <LeaguesClient />;
}
