'use client';

/**
 * /org/[slug]/events/manage — back-compat redirect to /events.
 *
 * The full management table now lives at /org/[slug]/events (replacing the
 * previous "latest event" redirect). This stub keeps old bookmarks working.
 */

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function EventsManageRedirectPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  useEffect(() => {
    // Guard against transient undefined param — see organizer-auth-decision.ts.
    if (!params.slug) return;
    router.replace(`/org/${params.slug}/events`);
  }, [params.slug, router]);
  return null;
}
