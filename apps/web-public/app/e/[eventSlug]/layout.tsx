/**
 * Event layout for /e/[eventSlug]/*: it hands the Event's title rule to every page below it.
 *
 * The Event's logo and hero image are read and drawn by `_components/EventHeader.tsx`.
 */

import type { Metadata } from 'next';
import { eventTitleRule } from './_lib/event-or-not-found';

interface Props {
  children: React.ReactNode;
  params: Promise<{ eventSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: await eventTitleRule(await params) };
}

export default function EventLayout({ children }: Props) {
  return <div className="min-h-screen">{children}</div>;
}
