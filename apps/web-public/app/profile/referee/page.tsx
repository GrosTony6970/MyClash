import { redirect } from 'next/navigation';

// See ../fighter/page.tsx — same unlinked-duplicate cleanup, same redirect.
export default function LegacyRefereeProfilePage() {
  redirect('/me/profile');
}
