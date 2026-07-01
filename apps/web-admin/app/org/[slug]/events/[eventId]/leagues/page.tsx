'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

/**
 * The standalone event-scoped league page was merged into the org Leagues hub
 * to remove the "two overlapping league menus" confusion. Org↔league membership
 * now lives at `/org/[slug]/leagues`, and per-league tournament attachment is a
 * nested section there; the focused in-event attach action lives on this event's
 * Tournaments page. Old bookmarks/deep links land on the hub's Membership tab.
 */
export default function EventLeaguesRedirect() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/org/${params.slug}/leagues?tab=membership`);
  }, [params.slug, router]);

  return null;
}
