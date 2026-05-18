'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function RegistrationsRedirect() {
  const router = useRouter();
  const { slug, eventId } = useParams<{ slug: string; eventId: string }>();
  useEffect(() => {
    router.replace(`/org/${slug}/events/${eventId}/persons`);
  }, [router, slug, eventId]);
  return null;
}
