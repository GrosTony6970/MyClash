'use client';

import { useSearchParams, useParams } from 'next/navigation';
import { WizardShell } from './_wizard/WizardShell';

export default function NewTournamentPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const searchParams = useSearchParams();
  const draftId = searchParams.get('id');
  const stepParam = searchParams.get('step');
  const step = (stepParam ? Math.min(4, Math.max(1, parseInt(stepParam, 10))) : 1) as 1 | 2 | 3 | 4;

  return (
    <WizardShell
      slug={params.slug}
      eventId={params.eventId}
      initialTournamentId={draftId}
      initialStep={step}
    />
  );
}
