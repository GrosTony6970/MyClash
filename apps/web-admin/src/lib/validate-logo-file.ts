/**
 * Centralised validation rules for event / tournament logo uploads.
 *
 * The size cap (10 MB) and the allowed mime set were duplicated inline
 * in three call sites (events list, tournament wizard Step 3,
 * tournament settings display tab). Each copy could drift; this helper
 * keeps them in lockstep and exposes the i18n key for the failure
 * message so callers don't repeat the (rule → label) mapping either.
 */

export const MAX_LOGO_BYTES = 10 * 1024 * 1024;
export const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type LogoErrorKey = 'organizer.events.logoTooLarge' | 'organizer.events.logoWrongType';

export type LogoValidationResult = { ok: true } | { ok: false; errorKey: LogoErrorKey };

export function validateLogoFile(
  file: File,
  maxBytes: number = MAX_LOGO_BYTES,
): LogoValidationResult {
  if (file.size > maxBytes) {
    return { ok: false, errorKey: 'organizer.events.logoTooLarge' };
  }
  if (!(ALLOWED_LOGO_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, errorKey: 'organizer.events.logoWrongType' };
  }
  return { ok: true };
}
