'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function RefereeAssignmentsRedirectPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const router = useRouter();

  useEffect(() => {
    // Guard against transient undefined params — see organizer-auth-decision.ts.
    if (!params.slug || !params.eventId) return;
    router.replace(`/org/${params.slug}/events/${params.eventId}/referees#assignments`);
  }, [params.eventId, params.slug, router]);

  return null;
}
