/**
 * sentry-data-collection.ts — what an error report, a trace or a breadcrumb may
 * carry when it leaves for Sentry. The one owner of that promise.
 *
 * The privacy policy (§7.1) says what Sentry receives. Sentry 10 with the old
 * "no personal data" switch still sent cookies, bearer tokens, request bodies
 * and query strings: an option's name proved nothing. So every Sentry init in
 * the repo takes its settings and its hooks from here, the observability gate
 * checks that it does, and an envelope probe proves what really leaves.
 *
 * Loaded by the browser before the page comes alive (and by the offline pad), so
 * it imports nothing and no function here may throw: a throw in a browser init
 * stops the page, a throw in `beforeSend` drops the report, and a throw in
 * `beforeSendSpan` SENDS THE SPAN UNCHANGED.
 */

type CollectBehavior = boolean | { allow: string[] } | { deny: string[] };

/** Sentry 11's `DataCollection`, every key named. The Sentry apps pin this against
 *  the SDK's own type, so a key Sentry adds later is a compile error, not a
 *  silent "collect". */
export interface SentryDataCollection {
  userInfo: boolean;
  cookies: CollectBehavior;
  httpHeaders: { request: CollectBehavior; response: CollectBehavior };
  httpBodies: Array<
    'incomingRequest' | 'outgoingRequest' | 'incomingResponse' | 'outgoingResponse'
  >;
  urlQueryParams: CollectBehavior;
  graphQL: { document: boolean; variables: boolean };
  genAI: { inputs: boolean; outputs: boolean };
  mcp: { inputs: boolean; outputs: boolean };
  databaseQueryData: boolean;
  queues: boolean;
  stackFrameVariables: boolean | CollectBehavior;
  frameContextLines: number;
}

/**
 * Servers (API, Next servers). Request headers are an ALLOW-list: Sentry keeps a
 * header's value only when its lower-cased name CONTAINS one of these terms, so
 * `host` also keeps `x-forwarded-host`. There is deliberately no `accept` term:
 * it would keep `accept-language`, which the policy does not name.
 */
export const SENTRY_DATA_COLLECTION: SentryDataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { allow: ['host', 'user-agent', 'content-type', 'content-length', 'x-request-id'] },
    response: { deny: ['location'] },
  },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 5,
};

/** Browsers: the same, plus the visitor's IP (policy §7.1). */
export const SENTRY_BROWSER_DATA_COLLECTION: SentryDataCollection = {
  ...SENTRY_DATA_COLLECTION,
  userInfo: true,
};

/** Passed as `traceLifecycle`. Without it, a `SENTRY_TRACE_LIFECYCLE=static` env
 *  var would switch the span hook below off without a trace. */
export const SENTRY_TRACE_LIFECYCLE = 'stream' as const;

const CULTURE_CONTEXT = 'CultureContext';

/** The browser's default integrations minus culture context (locale, time zone,
 *  calendar), which the policy does not name. */
export function sentryBrowserIntegrations<T extends { name: string }>(defaults: T[]): T[] {
  return defaults.filter((integration) => integration.name !== CULTURE_CONTEXT);
}

/** Raw URLs or hostnames in, lower-cased hostnames without port out. Skips
 *  `undefined`, empty and unparsable values; never throws. */
export function sentryOwnHosts(values: ReadonlyArray<string | undefined | null>): string[] {
  const hosts = new Set<string>();
  for (const value of values) {
    const host = hostnameOf(value);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

function hostnameOf(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const raw = value.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    return new URL(withScheme).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

export interface SentryScrubberOptions {
  /** From `sentryOwnHosts`. An absolute URL to any other host keeps only its origin. */
  ownHosts: string[];
  /** A hostname equal to it or ending in `.${domain}` is ours too. Empty is ignored. */
  domain?: string | undefined;
  /** `browser` also drops device and network details from spans (policy §7.1). */
  runtime: 'browser' | 'server';
}

interface Rule {
  hosts: ReadonlySet<string>;
  domain: string | undefined;
  browser: boolean;
}

const FAILED = '[scrub-failed]';
const SELECTOR_REMOVED = '[selector-removed]';
const PASS_TOKEN = /(\/event-passes\/)[^/?#]+/g;
const ABSOLUTE = /^([a-z][a-z0-9+.-]*:)\/\/(?:[^@/?#]*@)?([^/?#]*)(.*)$/i;
const SELECTOR_ATTRIBUTE = /\[([\w-]+)="[^"]*"\]/g;
const SELECTOR_OPENER = /\[[\w-]+="/;

function isOwnHost(hostPort: string, rule: Rule): boolean {
  const host = hostPort.toLowerCase().replace(/:\d*$/, '');
  if (!host || rule.hosts.has(host)) return true;
  return !!rule.domain && (host === rule.domain || host.endsWith(`.${rule.domain}`));
}

/** Query and fragment off, pass token masked, user info off; a foreign absolute
 *  URL keeps only its origin. */
function scrubUrl(value: string, rule: Rule): string {
  const cut = value.search(/[?#]/);
  const path = (cut === -1 ? value : value.slice(0, cut)).replace(PASS_TOKEN, '$1[token]');
  const absolute = ABSOLUTE.exec(path);
  if (!absolute) return path;
  const [, scheme, hostPort, rest] = absolute;
  const origin = `${scheme}//${hostPort}`;
  return isOwnHost(hostPort ?? '', rule) ? `${origin}${rest}` : origin;
}

/** A name or a transaction can hold a URL after a verb (`GET https://…?t=`):
 *  each space-separated word is scrubbed as a URL. */
function scrubText(value: string, rule: Rule): string {
  return value
    .split(' ')
    .map((word) => scrubUrl(word, rule))
    .join(' ');
}

/** An address that is ours by definition — the request being served, a stack
 *  frame's file: query, fragment and pass token off, never cut to the origin
 *  (the Host header names us whatever it says; source maps need the path). */
function scrubOwnUrl(value: string): string {
  const cut = value.search(/[?#]/);
  return (cut === -1 ? value : value.slice(0, cut)).replace(PASS_TOKEN, '$1[token]');
}

/** Attribute VALUES out of a CSS-like selector (`[title="x@y"]` → `[title]`).
 *  Sentry writes them unescaped, so a value holding `"` can defeat the pattern:
 *  any quote left after the strip removes the whole selector. */
export function stripSelectorValues(value: string): string {
  if (!SELECTOR_OPENER.test(value)) return value;
  const stripped = value.replace(SELECTOR_ATTRIBUTE, '[$1]');
  return stripped.includes('"') ? SELECTOR_REMOVED : stripped;
}

/** Applies `fn` to a string or each string of an array; anything else as is. */
function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value))
    return value.map((item) => (typeof item === 'string' ? fn(item) : item));
  return value;
}

/** One field, its own try: a failure replaces the field, never leaves it raw. */
function guard(value: unknown, fn: (s: string) => string): unknown {
  try {
    return mapStrings(value, fn);
  } catch {
    return FAILED;
  }
}

type Bag = Record<string, unknown>;

function asBag(value: unknown): Bag | undefined {
  return value !== null && typeof value === 'object' ? (value as Bag) : undefined;
}

function setField(bag: Bag | undefined, key: string, fn: (s: string) => string): void {
  if (!bag || !(key in bag)) return;
  try {
    bag[key] = guard(bag[key], fn);
  } catch {
    delete bag[key];
  }
}

const URL_IN_TEXT = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+/gi;

/** Free text (a console argument, a stack, an error message) can quote a URL:
 *  each one in it is scrubbed. Found by the probe: a console stack held the
 *  page address with its query. */
function scrubUrlsInText(value: string, rule: Rule): string {
  return value.replace(URL_IN_TEXT, (url) => scrubUrl(url, rule));
}

/** Every string under a breadcrumb's data, nested arrays and objects included. */
function scrubTextDeep(bag: Bag | undefined, rule: Rule, depth = 0): void {
  if (!bag || depth > 4) return;
  for (const key of Object.keys(bag)) {
    const value = bag[key];
    if (typeof value === 'string') setField(bag, key, (s) => scrubUrlsInText(s, rule));
    else scrubTextDeep(asBag(value), rule, depth + 1);
  }
}

function scrubFrames(container: unknown, rule: Rule): void {
  for (const item of (asBag(container)?.['values'] as unknown[] | undefined) ?? []) {
    setField(asBag(item), 'value', (s) => scrubUrlsInText(s, rule));
    const frames = asBag(asBag(item)?.['stacktrace'])?.['frames'];
    for (const frame of Array.isArray(frames) ? frames : []) {
      setField(asBag(frame), 'filename', scrubOwnUrl);
      setField(asBag(frame), 'abs_path', scrubOwnUrl);
    }
  }
}

function scrubRequest(request: Bag | undefined, rule: Rule): void {
  if (!request) return;
  setField(request, 'url', scrubOwnUrl);
  delete request['query_string'];
  const headers = asBag(request['headers']);
  for (const key of Object.keys(headers ?? {})) {
    if (key.toLowerCase() === 'referer') setField(headers, key, (s) => scrubUrl(s, rule));
  }
}

function scrubEventWith<E>(event: E, rule: Rule): E | null {
  try {
    const bag = asBag(event);
    if (!bag) return event;
    scrubRequest(asBag(bag['request']), rule);
    setField(bag, 'transaction', (s) => scrubText(s, rule));
    const contexts = asBag(bag['contexts']);
    setField(asBag(contexts?.['myclash']), 'path', (s) => scrubUrl(s, rule));
    const nextjs = asBag(contexts?.['nextjs']);
    for (const key of Object.keys(nextjs ?? {})) setField(nextjs, key, (s) => scrubUrl(s, rule));
    setField(bag, 'message', (s) => scrubUrlsInText(s, rule));
    scrubFrames(bag['exception'], rule);
    scrubFrames(bag['threads'], rule);
    if (Array.isArray(bag['breadcrumbs'])) {
      bag['breadcrumbs'] = bag['breadcrumbs']
        .map((crumb: unknown) => scrubBreadcrumbWith(crumb, rule))
        .filter((crumb: unknown) => crumb !== null);
    }
    return event;
  } catch {
    return null;
  }
}

function scrubBreadcrumbWith<B>(crumb: B, rule: Rule): B | null {
  try {
    const bag = asBag(crumb);
    if (!bag) return crumb;
    const data = asBag(bag['data']);
    for (const key of ['url', 'from', 'to']) setField(data, key, (s) => scrubUrl(s, rule));
    if (data) delete data['url.fragment'];
    scrubTextDeep(data, rule);
    setField(bag, 'message', (s) => scrubUrlsInText(s, rule));
    if (typeof bag['category'] === 'string' && bag['category'].startsWith('ui.')) {
      setField(bag, 'message', stripSelectorValues);
    }
    return crumb;
  } catch {
    return null;
  }
}

const DROP = Symbol('drop');
const URL_KEYS = new Set(['transaction', 'sentry.transaction', 'browser.web_vital.lcp.url']);
const TARGET_KEYS = new Set(['url.path', 'url.template', 'http.target']);
const ALWAYS_DROPPED = new Set(['url.fragment', 'url.query']);

function isUrlKey(key: string): boolean {
  return key.startsWith('url.') || key.startsWith('http.') || URL_KEYS.has(key);
}

function rawValue(value: unknown): unknown {
  const bag = asBag(value);
  return bag && !Array.isArray(value) && 'value' in bag ? bag['value'] : value;
}

/** Whether an OUTGOING span talks to a host that is not ours: then its path-only
 *  fields go too. An incoming (`http.server`) span's address is our own Host. */
function hasForeignTarget(attributes: Bag, rule: Rule): boolean {
  if (rawValue(attributes['sentry.op']) === 'http.server') return false;
  for (const key of ['url.full', 'url.domain', 'server.address']) {
    const value = rawValue(attributes[key]);
    if (typeof value !== 'string' || !value) continue;
    const host = ABSOLUTE.exec(value)?.[2] ?? value;
    if (!isOwnHost(host, rule)) return true;
  }
  return false;
}

function scrubAttribute(key: string, value: unknown, rule: Rule, foreign: boolean): unknown {
  if (ALWAYS_DROPPED.has(key) || (foreign && TARGET_KEYS.has(key))) return DROP;
  if (rule.browser && (key.startsWith('network.connection.') || key.startsWith('device.'))) {
    return DROP;
  }
  const scrub = (s: string): string => {
    const url = isUrlKey(key) ? scrubText(s, rule) : s;
    return stripSelectorValues(url);
  };
  const bag = asBag(value);
  if (bag && !Array.isArray(value) && 'value' in bag) {
    const inner = guard(bag['value'], scrub);
    return inner === FAILED && typeof bag['value'] !== 'string' ? DROP : { ...bag, value: inner };
  }
  return guard(value, scrub);
}

interface SpanLike {
  name: string;
  attributes: Record<string, unknown>;
}

function scrubSpanWith<S extends SpanLike>(span: S, rule: Rule): S {
  try {
    const source = asBag(span.attributes) ?? {};
    const foreign = hasForeignTarget(source, rule);
    const attributes: Bag = {};
    for (const key of Object.keys(source)) {
      const value = scrubAttribute(key, source[key], rule, foreign);
      if (value !== DROP) attributes[key] = value;
    }
    const name = guard(span.name, (s) => stripSelectorValues(scrubText(s, rule)));
    return { ...span, name: typeof name === 'string' ? name : FAILED, attributes };
  } catch {
    return failedSpan(span);
  }
}

/** Last resort: ids only, nothing that could hold a value. */
function failedSpan<S extends SpanLike>(span: S): S {
  const read = (key: string): unknown => {
    try {
      return (span as unknown as Bag)[key];
    } catch {
      return undefined;
    }
  };
  const keep = ['trace_id', 'span_id', 'parent_span_id', 'start_timestamp', 'end_timestamp'];
  const copy: Bag = { status: read('status'), is_segment: read('is_segment') };
  for (const key of keep) copy[key] = read(key);
  return { ...copy, name: FAILED, attributes: {} } as unknown as S;
}

/** The three hooks every Sentry init passes, bound to one deployment's hosts. */
export function createSentryScrubbers(options: SentryScrubberOptions) {
  const rule: Rule = {
    hosts: new Set(options.ownHosts),
    domain: options.domain?.trim().toLowerCase() || undefined,
    browser: options.runtime === 'browser',
  };
  return {
    scrubUrl: (url: string | undefined): string | undefined =>
      url === undefined ? undefined : (guard(url, (s) => scrubUrl(s, rule)) as string),
    beforeSend: <E>(event: E): E | null => scrubEventWith(event, rule),
    beforeBreadcrumb: <B>(crumb: B): B | null => scrubBreadcrumbWith(crumb, rule),
    beforeSendSpan: <S extends SpanLike>(span: S): S => scrubSpanWith(span, rule),
  };
}
