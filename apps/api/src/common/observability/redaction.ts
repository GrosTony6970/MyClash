const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const SECRET_KEY_PATTERN =
  /(?:api[_-]?key|token|secret|password|authorization|cookie|set-cookie|dsn|email)/i;

export const REDACTED = '[redacted]';
export const REDACTED_EMAIL = '[redacted-email]';

export function redactText(value: string): string {
  return value
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(JWT_PATTERN, REDACTED)
    .replace(EMAIL_PATTERN, REDACTED_EMAIL);
}

export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SECRET_KEY_PATTERN.test(key) ? REDACTED : redactValue(entry),
    ]),
  );
}

export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  const redacted: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const safeValue = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactValue(value);
    redacted[key] = Array.isArray(safeValue)
      ? safeValue.map((item) => String(item))
      : String(safeValue);
  }
  return redacted;
}

export function isSensitiveRoute(path: string): boolean {
  return /\/(auth|ai-|ai\/|query|upload|imports?|exports?|backup|archive)/i.test(path);
}

const ANONYMOUS_PHOTO_PATH = /^\/api\/v1\/events\/[^/]+\/photos(?:\/[^/]+\/report)?$/;

/**
 * A photo sent, or reported, from the Event's QR code. The privacy policy says such a photo is
 * not stored with the sender's account, so its log line names no actor and carries no headers
 * (the proxy's address among them), even when the phone is signed in. Other log lines still
 * hold the phone's address (Fastify's own request line, Traefik's access log): §2.7 says so. The signed-in send
 * (`/me/events/…/photos`) and the organiser's routes keep their log (ruling 476).
 */
export function isAnonymousPhotoRoute(method: string, path: string): boolean {
  return method === 'POST' && ANONYMOUS_PHOTO_PATH.test(path.split('?')[0] ?? '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
