/**
 * Event layout — per-event identity (logo + hero) for /e/[eventSlug]/*
 *
 * Server component. Slice 4 of the public redesign retired per-event
 * color overrides + custom font + custom CSS — the unified MyClash
 * design from @myclash/design-tokens governs both apps. The only
 * per-event flow that remains is:
 *   - the hero image (set from the admin's Branding page) exposed
 *     to children via the `--event-hero-image` CSS variable
 *   - the event logo URL exposed via a data attribute so per-page
 *     consumers can read it without re-fetching
 */

import type { Metadata } from 'next';
import { getApiUrl } from '@/lib/api-url';
import { fetchEventTheme } from '../../../src/theme';

interface Props {
  children: React.ReactNode;
  params: Promise<{ eventSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventSlug } = await params;
  return {
    title: {
      template: `%s — MyClash`,
      default: eventSlug,
    },
  };
}

export default async function EventLayout({ children, params }: Props) {
  const { eventSlug } = await params;

  const apiUrl = getApiUrl();
  const theme = await fetchEventTheme(eventSlug, apiUrl);

  return (
    <>
      {theme.heroImageUrl && (
        <style
          dangerouslySetInnerHTML={{
            __html: `:root { --event-hero-image: url('${theme.heroImageUrl}'); }`,
          }}
        />
      )}

      <div data-event-slug={eventSlug} data-logo-url={theme.logoUrl ?? ''} className="min-h-screen">
        {children}
      </div>
    </>
  );
}
