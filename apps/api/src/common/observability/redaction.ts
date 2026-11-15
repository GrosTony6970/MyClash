import { scrubOwnUrl } from '@myclash/types/sentry-data-collection';

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
    const safeValue = SECRET_KEY_PATTERN.test(key)
      ? REDACTED
      : redactValue(key.toLowerCase() === 'referer' ? cutQuery(value) : value);
    redacted[key] = Array.isArray(safeValue)
      ? safeValue.map((item) => String(item))
      : String(safeValue);
  }
  return redacted;
}

/** A page's address without its query and fragment: a link's token rides there, and a
 *  same-origin API call sends that address as its Referer. */
function cutQuery(value: string | string[]): string | string[] {
  return Array.isArray(value) ? value.map(scrubOwnUrl) : scrubOwnUrl(value);
}

/**
 * A request path as a log may write it. A link's secret rides in the query (`?token=…`,
 * `?token_hash=…`), so the query and fragment go, for every request; the event-pass code in the
 * path is masked (`scrubOwnUrl`, the rule Sentry already applies). A percent-encoded segment and
 * everything after it go too: the router decodes it, so it can spell anything, a pass code under
 * another spelling (`%65vent-passes/…`) or an address the router refuses.
 */
export function logSafePath(url: string): string {
  const path = scrubOwnUrl(url);
  const encoded = path.indexOf('%');
  if (encoded === -1) return path;
  const segment = path.lastIndexOf('/', encoded);
  return segment === -1 ? '[encoded]' : `${path.slice(0, segment)}/[encoded]`;
}

const SENSITIVE_PATH = /\/(auth|ai-|ai\/|query|upload|imports?|exports?|backup|archive)/i;

/**
 * Each form of a path a check reads: as sent, decoded until it stops changing (the router decodes
 * it, so `%61uth` is `auth` to the handler), and the route it matched. `undefined` when the path
 * cannot be decoded: a check then answers as if it matched (fail closed).
 */
function pathForms(path: string, route: string | undefined): string[] | undefined {
  const sent = path.split(/[?#]/)[0] ?? '';
  const forms = [sent];
  let current = sent;
  for (let round = 0; round < 3; round += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return undefined;
    }
    if (decoded === current) break;
    forms.push(decoded);
    current = decoded;
  }
  return route ? [...forms, route] : forms;
}

/** Whether a request's headers stay out of its log line. `route` is the matched route pattern. */
export function isSensitiveRoute(path: string, route?: string): boolean {
  const forms = pathForms(path, route);
  return !forms || forms.some((form) => SENSITIVE_PATH.test(form));
}

const ANONYMOUS_PHOTO_PATH = /^\/api\/v1\/events\/[^/]+\/photos(?:\/[^/]+\/report)?$/;

/**
 * A photo sent, or reported, from the Event's QR code. The privacy policy says such a photo is
 * not stored with the sender's account, so its log line names no actor and carries no headers
 * (the proxy's address among them), even when the phone is signed in. Other log lines still
 * hold the phone's address (Fastify's own request line, Traefik's access log): §2.7 says so. The signed-in send
 * (`/me/events/…/photos`) and the organiser's routes keep their log (ruling 476).
 */
export function isAnonymousPhotoRoute(method: string, path: string, route?: string): boolean {
  if (method !== 'POST') return false;
  const forms = pathForms(path, route);
  return !forms || forms.some((form) => ANONYMOUS_PHOTO_PATH.test(form));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
