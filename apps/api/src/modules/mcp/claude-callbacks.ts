/**
 * The only places a MyClash login may be sent from the consent page: Claude's callbacks.
 *
 * Anyone can register an OAuth client with GoTrue (dynamic client registration), with any
 * redirect URI. A client that names itself "Claude" and redirects to its own site would collect
 * a code for the person's account. This list is the wall: the consent API refuses every other
 * callback, whatever the client calls itself.
 *
 * A callback passes only in its one canonical spelling. The browser follows a redirect after
 * parsing it with the WHATWG URL parser, so each check here parses the same way, then rebuilds the
 * URL from its scheme, host, port and path alone and demands the input be exactly that: a user
 * name (`https://claude.ai@evil.example/…`), a query, a fragment, an upper-case host, a dot
 * segment or a trailing slash each make the two differ.
 */

const CLAUDE_CALLBACKS = new Set([
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
]);

/** Claude Code's local callback: `http://<host>:<port>/callback`, any port 1–65535. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

/** Where a callback goes back to: Claude on the web, or Claude Code on the person's computer. */
export type CallbackKind = 'claude' | 'this-computer';

function parse(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Scheme, host, port and path, nothing else. */
function bare(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

/** Which callback `uri` is, or null when it is none of Claude's. */
export function describeCallback(uri: string): CallbackKind | null {
  const url = parse(uri);
  if (!url || bare(url) !== uri) return null;
  if (CLAUDE_CALLBACKS.has(uri)) return 'claude';
  // The parser refuses a port above 65535, and writes port 80 and a leading zero away, so
  // `http://localhost:80/callback` and `:08080` already failed the spelling check above.
  const port = Number(url.port);
  const loopback =
    url.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(url.hostname) &&
    url.pathname === '/callback' &&
    port >= 1;
  return loopback ? 'this-computer' : null;
}

export function isClaudeCallback(uri: string): boolean {
  return describeCallback(uri) !== null;
}

/**
 * Whether GoTrue's finished redirect (a callback plus `?code=…&state=…`, or `?error=…`) goes to
 * one of Claude's callbacks. The query is GoTrue's own; a user name or a fragment is refused.
 */
export function redirectsToClaude(redirectUrl: string): boolean {
  const url = parse(redirectUrl);
  if (!url || url.username || url.password || redirectUrl.includes('#')) return false;
  return isClaudeCallback(bare(url));
}

/** The host a refused callback would have sent the person to, for the page to name. */
export function hostOf(uri: string): string {
  return parse(uri)?.host ?? uri;
}
