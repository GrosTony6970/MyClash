/**
 * fetch-theme.ts — SSR per-event identity fetcher.
 *
 * After Slice 4 the only fields are logo + hero image — color/font
 * overrides + custom_css were retired in migration 0086.
 * Errors are swallowed; always returns a valid theme.
 */

import { DEFAULT_THEME, type EventTheme } from './types';

interface ApiEvent {
  logo_url?: string | null;
  theme?: {
    hero_image_url?: string | null;
  } | null;
}

export async function fetchEventTheme(eventSlug: string, apiUrl: string): Promise<EventTheme> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}`, {
      cache: 'no-store',
      next: { revalidate: 60 },
    });

    if (!res.ok) return DEFAULT_THEME;

    const event = (await res.json()) as ApiEvent;
    return {
      logoUrl: event.logo_url ?? null,
      heroImageUrl: event.theme?.hero_image_url ?? null,
    };
  } catch {
    return DEFAULT_THEME;
  }
}
