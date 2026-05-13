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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
