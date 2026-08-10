/**
 * The event home — Route: /e/[eventSlug]/home
 *
 * The front door: `/e/[eventSlug]` redirects here, and thirteen surfaces link
 * to it, including the API's push notifications.
 *
 * This was a three-way persona switch on an `mc_persona` cookie that NOTHING in
 * the codebase ever set, so two of the three branches were unreachable — and
 * both were built entirely on API routes that were never implemented
 * (`/my-matches`, `/following/matches`, both tracked in
 * `frontend-route-contract.test.ts`). Reading that cookie also opted the route
 * out of static rendering to choose between a live branch and two dead ones.
 * One home, the real one.
 */

import type { Metadata } from 'next';
import { PublicHome } from './PublicHome';

interface Props {
  params: Promise<{ eventSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventSlug } = await params;
  return { title: `Home — ${eventSlug}` };
}

export default async function HomePage({ params }: Props) {
  const { eventSlug } = await params;
  return <PublicHome eventSlug={eventSlug} />;
}
