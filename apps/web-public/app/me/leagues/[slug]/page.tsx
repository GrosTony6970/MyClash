import LeagueDetailClient from './LeagueDetailClient';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('publicApp.titles.meLeagues');

/** `/me/leagues/[slug]` — the league's classement, rendered inside the personal
 *  space with the signed-in fighter's row highlighted. */
export default function MeLeagueDetailPage() {
  return <LeagueDetailClient />;
}
