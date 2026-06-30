import { PeopleHubClient } from './PeopleHubClient';

/** `/me/follows` — the "People" hub (Following · Search · My groups). The client
 *  island resolves the API URL and owns tab state; this server wrapper stays
 *  minimal. */
export default function MePeoplePage() {
  return <PeopleHubClient />;
}
