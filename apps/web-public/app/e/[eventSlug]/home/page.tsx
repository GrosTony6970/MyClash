/**
 * Persona-aware home — T-604
 * Route: /e/[eventSlug]/home
 *
 * Server component. Reads persona from cookie, renders appropriate home variant.
 *
 * Three variants:
 *   competitor   — my next match, today's parcours, my last results
 *   accompanist  — favorites live, big matches
 *   public       — editorial, event intro, schedule highlights (default)
 */

import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { CompetitorHome } from './CompetitorHome';
import { AccompanistHome } from './AccompanistHome';
import { PublicHome } from './PublicHome';

interface Props {
  params: Promise<{ eventSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventSlug } = await params;
  return { title: `Home — ${eventSlug}` };
}

type HomePersona = 'competitor' | 'accompanist' | 'public';

function resolvePersona(cookieStore: Awaited<ReturnType<typeof cookies>>): HomePersona {
  const raw = cookieStore.get('mc_persona')?.value;
  if (raw === 'competitor' || raw === 'referee') return 'competitor';
  if (raw === 'accompanist') return 'accompanist';
  return 'public';
}

export default async function HomePage({ params }: Props) {
  const { eventSlug } = await params;
  const cookieStore = await cookies();
  const persona = resolvePersona(cookieStore);

  switch (persona) {
    case 'competitor':
      return <CompetitorHome eventSlug={eventSlug} />;
    case 'accompanist':
      return <AccompanistHome eventSlug={eventSlug} />;
    default:
      return <PublicHome eventSlug={eventSlug} />;
  }
}
