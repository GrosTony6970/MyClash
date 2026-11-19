import { maskPassTokens } from '@myclash/types/sentry-data-collection';
import { REDACTED, REDACTED_EMAIL, redactText } from '../../common/observability/redaction';

/**
 * What the ops agent may read of a line of free text, a log line above all (the ops agent's
 * design, section 2, "Masking of free text"). It is a second net: no logger writes a person's
 * email (ruling 867) or a database's words about a person's row. Names may stay.
 *
 * In order: Bearer tokens, JWTs and addresses (`redactText`, the request log's own scrub); the
 * password of a connection string; a percent-encoded address; a link's secret in a query; an
 * event-pass code; phone numbers; an IPv4 address cut to its first half and an IPv6 address to
 * its first two groups (ruling 868). Each pattern is bounded so that a timestamp, a decimal, a
 * digest, a UUID and a SQL cast pass untouched.
 */
export const REDACTED_PHONE = '[redacted-phone]';

const URL_USER_INFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;
const ENCODED_EMAIL = /[A-Z0-9._%+-]+%40[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/**
 * A link's secret in a query: sign-in and reset codes, the event pass's `t`, a pre-signed storage
 * link's credential and signature. After `?`, `&`, or the `\u0026` Go's JSON logger writes for `&`
 * (the auth server's `referer`).
 */
const LINK_SECRET =
  /((?:[?&]|\\u0026)(?:token|token_hash|code|access_token|refresh_token|apikey|t|x-amz-credential|x-amz-signature|x-amz-security-token)=)[^&\s"'\\]+/gi;
/** `+33 6 12 34 56 78`, `0033612345678`: a country code, then 8 to 15 digits. */
const INTERNATIONAL_PHONE = /(?<![\w.:])(?:\+|00)\d(?:[ .-]?\d){7,14}(?!\w)/g;
/** `06 12 34 56 78`, `06.12.34.56.78`, `0612345678`. */
const FRENCH_PHONE = /(?<![\w.:])0[1-9](?:[ .-]?\d{2}){4}(?!\w)/g;
/** Not inside a longer dotted run; a full stop that ends the sentence may follow. */
const IPV4 = /(?<![\w.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\w|\.\d)/g;
/** A run of hex groups and colons; `ipv6Half` decides whether it is an address. */
const IPV6_CANDIDATE = /(?<![\w:.])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:.])/gi;

function ipv4Half(match: string, ...parts: string[]): string {
  const octets = parts.slice(0, 4);
  return octets.every((octet) => Number(octet) <= 255) ? `${octets[0]}.${octets[1]}.x.x` : match;
}

/**
 * An IPv6 address is a run with `::` or with exactly eight groups: a time of day (`23:34:35`) has
 * neither. It keeps its first two groups.
 */
function ipv6Half(match: string): string {
  const groups = match.split(':');
  if (!match.includes('::') && groups.length !== 8) return match;
  const [first, second] = groups;
  if (first && second) return `${first}:${second}:x`;
  return first ? `${first}::x` : '::x';
}

export function scrubForAgent(text: string): string {
  return maskPassTokens(
    redactText(text)
      .replace(URL_USER_INFO, `$1${REDACTED}@`)
      .replace(ENCODED_EMAIL, REDACTED_EMAIL)
      .replace(LINK_SECRET, `$1${REDACTED}`),
  )
    .replace(INTERNATIONAL_PHONE, REDACTED_PHONE)
    .replace(FRENCH_PHONE, REDACTED_PHONE)
    .replace(IPV4, ipv4Half)
    .replace(IPV6_CANDIDATE, ipv6Half);
}
