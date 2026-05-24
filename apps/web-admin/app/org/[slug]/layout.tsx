'use client';

import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { OrganizerAdminShell } from '../../../src/components/OrganizerAdminShell';
import { OrganizerEventContextProvider } from '../../../src/components/organizer-event-context';

function asString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function OrganizerLayout({ children }: { children: ReactNode }) {
  // The URL eventId is the canonical source of truth on event-scoped routes;
  // the context provider promotes it to localStorage and exposes it to the
  // shell + every nested page. On org-scoped routes (no [eventId] segment)
  // the param is undefined and the context falls back to localStorage / auto-pick.
  const params = useParams<{ slug?: string; eventId?: string }>();
  const slug = asString(params.slug);
  const urlEventId = asString(params.eventId) || null;

  return (
    <OrganizerEventContextProvider slug={slug} urlEventId={urlEventId}>
      <OrganizerAdminShell>{children}</OrganizerAdminShell>
    </OrganizerEventContextProvider>
  );
}
