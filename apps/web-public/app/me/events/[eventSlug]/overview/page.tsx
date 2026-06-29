import { redirect } from 'next/navigation';

// Overview is now the hub's default landing (the index route). Kept as a
// redirect so old `/overview` links and bookmarks resolve.
export default async function HubOverviewRedirect({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  redirect(`/me/events/${eventSlug}`);
}
