/**
 * Strip every data VALUE out of a failed PostgREST request before it is stored.
 *
 * Two obligations, and they happen to be the same code:
 *
 *  1. Hard rule 7 — no personal data at rest in a product whose repo is public.
 *     A filter carries what was searched for (`?email=eq.someone@example.com`),
 *     and a 23505 body carries the value that collided
 *     (`Key (email)=(someone@example.com) already exists`).
 *  2. Bounded growth — rows are keyed by a fingerprint of this output. If a
 *     value survived, one broken loop would mint a new row per distinct value
 *     and fill the disk, defeating the aggregation the store is built on.
 *
 * What is deliberately KEPT: table name, column names, operators, `select`
 * lists, and the error code. That is the entire diagnostic value — "the
 * `persons` embed of `clubs` is unresolvable" — and none of it is user data.
 */

/** Query parameters whose values are structure, not data, and are kept whole. */
const STRUCTURAL_PARAMS = new Set(['select', 'order', 'on_conflict', 'columns']);

const REDACTED = '<redacted>';

/**
 * PostgREST operators that may precede a value: `eq.x`, `in.(a,b)`, `not.eq.x`.
 * The operator is structure and stays; everything after it is data and goes.
 */
const OPERATOR_PREFIX = /^(not\.)?([a-z]+)\./u;

/** `column.op.value` inside an `or=(…)` / `and=(…)` compound. */
function redactCompoundMember(member: string): string {
  const parts = member.split('.');
  if (parts.length <= 2) return member;
  // column . op . value…  → keep the first two, drop the rest.
  return `${parts[0]}.${parts[1]}.${REDACTED}`;
}

/**
 * `or=(name.ilike.*bob*,email.eq.bob@x.y)` → keep the shape, drop both values.
 *
 * These exist in this repo (auth and lookup search paths), and a naive
 * `param=op.value` grammar would let a searched fighter's name through intact.
 */
function redactCompound(value: string): string {
  const wrapped = /^\((.*)\)$/su.exec(value);
  const body = wrapped ? wrapped[1]! : value;
  const members = body.split(',').map(redactCompoundMember).join(',');
  return wrapped ? `(${members})` : members;
}

function redactParamValue(key: string, value: string): string {
  if (STRUCTURAL_PARAMS.has(key)) return value;
  if (key === 'or' || key === 'and') return redactCompound(value);

  const operator = OPERATOR_PREFIX.exec(value);
  // `?id=eq.<uuid>` keeps `eq.`; a bare `?limit=50` has no operator and the
  // whole value is data as far as this is concerned.
  return operator ? `${operator[0]}${REDACTED}` : REDACTED;
}

export interface SanitizedRequest {
  /** Table name, or the function name for an rpc call. */
  table: string;
  isRpc: boolean;
  /** `persons?email=eq.<redacted>&select=id,name` — safe to store and display. */
  path: string;
}

/**
 * Split a PostgREST URL into its resource and a value-free rendering.
 *
 * Returns null for anything outside `/rest/v1/` — GoTrue, Storage and Functions
 * share this client's fetch, and their errors are out of scope for the tripwire.
 */
export function sanitizeRequest(rawUrl: string): SanitizedRequest | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const marker = '/rest/v1/';
  const at = url.pathname.indexOf(marker);
  if (at === -1) return null;

  const resource = url.pathname.slice(at + marker.length);
  if (!resource) return null;

  const segments = resource.split('/').filter(Boolean);
  const isRpc = segments[0] === 'rpc';
  // `rpc/<fn>` names the function; anything else names the table.
  const table = (isRpc ? segments[1] : segments[0]) ?? '';
  if (!table) return null;

  const params = [...url.searchParams.entries()]
    .map(([key, value]) => `${key}=${redactParamValue(key, value)}`)
    .join('&');

  return {
    table,
    isRpc,
    path: params ? `${isRpc ? `rpc/${table}` : table}?${params}` : isRpc ? `rpc/${table}` : table,
  };
}

/**
 * Redact the values Postgres embeds in constraint-violation prose.
 *
 * `Key (email)=(someone@example.com) already exists.`
 *   → `Key (email)=(<redacted>) already exists.`
 *
 * The column name is kept — it is the whole diagnostic — and only the
 * parenthesised group that FOLLOWS an `=` is treated as data, so
 * `Key (email)` survives while `(someone@example.com)` does not.
 */
export function sanitizeMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  return message.replace(/=\([^)]*\)/gu, `=(${REDACTED})`);
}
