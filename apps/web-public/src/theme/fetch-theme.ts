/**
 * fetch-theme.ts — SSR theme fetcher for T-602.
 *
 * Called from the event layout server component.
 * Returns the event's theme or DEFAULT_THEME if none set.
 * Errors are swallowed — always returns a valid theme.
 */

import { DEFAULT_THEME, type EventTheme } from './types';

interface ApiEvent {
  // Migration 0084 retired themes.logo_url — the canonical column
  // is events.logo_url, which arrives at the top level here.
  logo_url?: string | null;
  theme?: {
    primary_color?: string | null;
    secondary_color?: string | null;
    accent_color?: string | null;
    hero_image_url?: string | null;
    font_display?: string | null;
    font_body?: string | null;
    custom_css?: string | null;
  } | null;
}

export async function fetchEventTheme(eventSlug: string, apiUrl: string): Promise<EventTheme> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}`, {
      // SSR: no cookies needed for public event data
      cache: 'no-store',
      next: { revalidate: 60 }, // revalidate every 60s
    });

    if (!res.ok) return DEFAULT_THEME;

    const event = (await res.json()) as ApiEvent;
    const t = event.theme;
    const logoUrl = event.logo_url ?? null;

    if (!t) {
      // No theme row yet — still surface the event's logo so the
      // header isn't unbranded on freshly-created events.
      return { ...DEFAULT_THEME, logoUrl };
    }

    return {
      primaryColor: t.primary_color ?? DEFAULT_THEME.primaryColor,
      secondaryColor: t.secondary_color ?? DEFAULT_THEME.secondaryColor,
      accentColor: t.accent_color ?? DEFAULT_THEME.accentColor,
      logoUrl,
      heroImageUrl: t.hero_image_url ?? null,
      fontDisplay: t.font_display ?? DEFAULT_THEME.fontDisplay,
      fontBody: t.font_body ?? DEFAULT_THEME.fontBody,
      customCss: t.custom_css ?? null,
    };
  } catch {
    return DEFAULT_THEME;
  }
}
