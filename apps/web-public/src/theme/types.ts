/**
 * Per-event identity used by /e/[eventSlug]/* layouts.
 *
 * Slice 4 of the public redesign retired per-event color overrides +
 * custom font + custom CSS. The only fields that still flow from the
 * theme editor to the public site are the logo (now sourced from
 * events.logo_url) and the hero image (themes.hero_image_url).
 */

export interface EventTheme {
  logoUrl: string | null;
  heroImageUrl: string | null;
}

export const DEFAULT_THEME: EventTheme = {
  logoUrl: null,
  heroImageUrl: null,
};
