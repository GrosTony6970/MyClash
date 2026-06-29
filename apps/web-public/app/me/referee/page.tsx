import { redirect } from 'next/navigation';

// The referee deep-dive now lives under the unified /me/profile tabs.
// Kept as a redirect so existing links and bookmarks resolve.
export default function PersonalRefereePage() {
  redirect('/me/profile?tab=referee');
}
