import type { Metadata } from 'next';
import { getApiUrl } from '@/lib/api-url';
import { PublicHome } from '../../../e/[eventSlug]/home/PublicHome';

// Mirror the public event home's freshness (the data fetches inside PublicHome
// are no-store) so the in-shell view matches /e/[slug]/home.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Props {
  params: Promise<{ eventSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventSlug } = await params;
  return { title: `Event — ${eventSlug}` };
}

/**
 * Personal-space event home: the same event home as /e/[slug]/home, but rendered
 * inside the personal shell (left sidebar stays) so the user keeps their /me
 * context. Drilling into a specific tournament/workshop opens the standalone
 * public view (`personalShell` only re-points the top back-link to /me/events).
 */
export default async function PersonalSpaceEventHomePage({ params }: Props) {
  const { eventSlug } = await params;
  const apiUrl = getApiUrl();
  return <PublicHome eventSlug={eventSlug} apiUrl={apiUrl} personalShell />;
}
