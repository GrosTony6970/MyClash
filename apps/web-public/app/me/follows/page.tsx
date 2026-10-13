import { PeopleHubClient } from './PeopleHubClient';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('publicApp.titles.meFollows');

/** `/me/follows` — the "People" hub (Following · Search · My groups). The client
 *  island resolves the API URL and owns tab state; this server wrapper stays
 *  minimal. */
export default function MePeoplePage() {
  return <PeopleHubClient />;
}
