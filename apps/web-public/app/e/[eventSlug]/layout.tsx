/**
 * Event layout — T-602: Per-event theming engine
 *
 * Server component. Fetches event theme at SSR time and injects
 * CSS custom properties into the page. All child routes under
 * /e/[eventSlug]/... inherit the theme automatically.
 *
 * AC:
 *   ✓ Custom primary/secondary/accent colors render
 *   ✓ Custom logo + hero image available via CSS vars
 *   ✓ Events without theme fall back to DEFAULT_THEME
 */

import type { Metadata } from 'next';
import { fetchEventTheme, themeToCss } from '../../../src/theme';

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

  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const theme = await fetchEventTheme(eventSlug, apiUrl);
  const css = themeToCss(theme);

  return (
    <>
      {/* Inject theme CSS variables for this event's subtree */}
      <style dangerouslySetInnerHTML={{ __html: css }} />

      {/* Hero image as CSS variable for child components */}
      {theme.heroImageUrl && (
        <style
          dangerouslySetInnerHTML={{
            __html: `:root { --event-hero-image: url('${theme.heroImageUrl}'); }`,
          }}
        />
      )}

      {/* Logo available as data attribute on the layout root */}
      <div
        data-event-slug={eventSlug}
        data-logo-url={theme.logoUrl ?? ''}
        className="min-h-screen"
        style={
          {
            '--event-primary': theme.primaryColor,
            '--event-secondary': theme.secondaryColor,
            '--event-accent': theme.accentColor,
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </>
  );
}
