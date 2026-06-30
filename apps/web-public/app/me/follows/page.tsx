import FollowsClient from './FollowsClient';

/** `/me/follows` — the cross-event "people you follow" list. The client island
 *  resolves the API URL and is locale-aware; this server wrapper stays minimal. */
export default function MeFollowsPage() {
  return <FollowsClient />;
}
