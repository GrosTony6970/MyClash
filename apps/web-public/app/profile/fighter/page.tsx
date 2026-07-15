import { redirect } from 'next/navigation';

// The fighter deep-dive lives under the unified /me/profile tabs — this
// unlinked route rendered a stale duplicate dashboard without the personal
// shell. Kept as a redirect (like /me/fighter) so typed URLs resolve; the
// client components in this directory are still imported by ProfileTabs.
export default function LegacyFighterProfilePage() {
  redirect('/me/profile');
}
