/**
 * sentry-trace-propagation.ts — the addresses a SERVER's Sentry may send its trace headers to.
 *
 * With no `tracePropagationTargets`, Sentry's Node SDK adds `sentry-trace` and `baggage` to
 * EVERY outgoing request (@sentry/core 11.10 `shouldPropagateTraceForUrl`: no targets → yes),
 * the AI providers included: they receive our trace ids, and `baggage` names our release and
 * environment. Each server init passes these targets instead, built from the hosts its
 * scrubbers already treat as ours. Browser inits do not: the browser SDK already keeps the
 * headers to the page's own origin, and a cross-origin target would add a CORS preflight to
 * every API call.
 *
 * Each target is an anchored RegExp, never a string: Sentry matches a string target anywhere in
 * the URL, so `app.example` would also match `https://other.test/?app.example`. No host gives
 * an empty list, and the SDK then sends the headers nowhere (an array is truthy, so it checks).
 *
 * The targets govern Sentry's own fetch and http instrumentation. The Next servers also
 * register an OpenTelemetry propagator that ignores them: a library that injects through
 * OpenTelemetry itself would still send the headers anywhere (none does today).
 *
 * Server-only: no browser bundle imports this file.
 */

export interface SentryTraceTargetOptions {
  /** From `sentryOwnHosts`: lower-cased hostnames without a port. */
  ownHosts: readonly string[];
  /** A hostname equal to it or ending in `.${domain}` is ours too. Empty is ignored. */
  domain?: string | undefined;
}

const SPECIAL = /[.*+?^${}()|[\]\\]/g;
/** After the host: an optional port, then the end, a path, a query or a fragment. */
const AFTER_HOST = String.raw`(?::\d+)?(?:[/?#]|$)`;

function escaped(text: string): string {
  return text.replace(SPECIAL, '\\$&');
}

export function sentryTracePropagationTargets(options: SentryTraceTargetOptions): RegExp[] {
  const targets = options.ownHosts.map(
    (host) => new RegExp(`^https?://${escaped(host)}${AFTER_HOST}`, 'i'),
  );
  const domain = options.domain?.trim().toLowerCase();
  if (domain) {
    targets.push(new RegExp(`^https?://(?:[a-z0-9-]+\\.)*${escaped(domain)}${AFTER_HOST}`, 'i'));
  }
  return targets;
}
