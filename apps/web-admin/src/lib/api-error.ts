/**
 * Read the reason the API actually gave for a failed response, falling back to
 * a translated string when it did not give one.
 *
 * Checking only `res.ok` and throwing a hardcoded i18n string is the reason a
 * backup failure could report nothing more useful than "Could not delete
 * backups." — the server's `detail` was sitting in the body, unread. Prefer
 * this over inlining another `res.json().catch(...)`; several call sites had
 * already grown their own copy.
 *
 * The API answers RFC 9457 problem+json, where `message` and `detail` carry the
 * same text (`message` is the backward-compatible extension member). Note that
 * the API deliberately scrubs unexpected 5xx bodies to "Internal server error",
 * so a generic string here can be the honest answer rather than a missing one.
 */
export async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as {
    message?: unknown;
    detail?: unknown;
  };
  const reason =
    typeof body.message === 'string'
      ? body.message
      : typeof body.detail === 'string'
        ? body.detail
        : '';
  return reason.trim() || fallback;
}
