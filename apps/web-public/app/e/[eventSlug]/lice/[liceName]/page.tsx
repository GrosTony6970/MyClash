import { redirect } from 'next/navigation';

// The standalone lice live view (T-606) was superseded by the maintained
// /live page (spectator nav links /live?lice=<id>); nothing generated this
// URL except the sibling /display TV route, which stays. Redirect typed
// URLs to the live overview.
export default async function LegacyLiceLivePage({
  params,
}: {
  params: Promise<{ eventSlug: string; liceName: string }>;
}) {
  const { eventSlug } = await params;
  redirect(`/e/${eventSlug}/live`);
}
