import { redirect } from 'next/navigation';

// The fighter deep-dive now lives under the unified /me/profile tabs.
// Kept as a redirect so existing links, bookmarks and the sidebar badge resolve.
export default function PersonalFighterPage() {
  redirect('/me/profile');
}
