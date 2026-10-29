import { describe, expect, it } from 'vitest';

import {
  SENTRY_BROWSER_DATA_COLLECTION,
  SENTRY_DATA_COLLECTION,
  createSentryScrubbers,
  sentryBrowserIntegrations,
  sentryOwnHosts,
  stripSelectorValues,
} from './sentry-data-collection';

// Synthetic markers only: plain strings, never shaped like a real token.
const M = 'probe-marker-1';
const EMAIL = 'x@example.test';

const server = createSentryScrubbers({
  ownHosts: ['api.example.test', 'db.example.test'],
  domain: 'example.test',
  runtime: 'server',
});
const browser = createSentryScrubbers({ ownHosts: ['app.example.test'], runtime: 'browser' });

function span(name: string, attributes: Record<string, unknown>) {
  return {
    trace_id: 't',
    span_id: 's',
    name,
    start_timestamp: 1,
    status: 'ok' as const,
    is_segment: false,
    attributes,
  };
}

describe('the settings', () => {
  it('servers record no IP, no cookie, no body, no query, and keep five header names', () => {
    expect(SENTRY_DATA_COLLECTION.userInfo).toBe(false);
    expect(SENTRY_DATA_COLLECTION.cookies).toBe(false);
    expect(SENTRY_DATA_COLLECTION.httpBodies).toEqual([]);
    expect(SENTRY_DATA_COLLECTION.urlQueryParams).toBe(false);
    expect(SENTRY_DATA_COLLECTION.httpHeaders.request).toEqual({
      allow: ['host', 'user-agent', 'content-type', 'content-length', 'x-request-id'],
    });
  });

  it('no allow term matches accept-language (Sentry matches substrings)', () => {
    const request = SENTRY_DATA_COLLECTION.httpHeaders.request as { allow: string[] };
    expect(request.allow.some((term) => 'accept-language'.includes(term))).toBe(false);
    expect(request.allow.some((term) => 'referer'.includes(term))).toBe(false);
  });

  it('the browser differs only by recording the IP', () => {
    expect({ ...SENTRY_BROWSER_DATA_COLLECTION, userInfo: false }).toEqual(SENTRY_DATA_COLLECTION);
    expect(SENTRY_BROWSER_DATA_COLLECTION.userInfo).toBe(true);
  });
});

describe('sentryOwnHosts', () => {
  it('turns URLs and hostnames into hostnames without port, skipping junk', () => {
    expect(
      sentryOwnHosts([
        undefined,
        null,
        '',
        '  ',
        'http://[',
        'https://App.Example.test:8443/x',
        'db.example.test',
      ]),
    ).toEqual(['app.example.test', 'db.example.test']);
  });
});

describe('scrubUrl', () => {
  it('drops the query and the fragment', () => {
    expect(server.scrubUrl(`/reset-password?token=${M}#access_token=${M}`)).toBe('/reset-password');
  });
  it('masks a pass token in the path', () => {
    expect(server.scrubUrl(`/api/v1/event-passes/${M}`)).toBe('/api/v1/event-passes/[token]');
  });
  it('drops an email written as %40 in a query', () => {
    expect(server.scrubUrl(`https://api.example.test/x?email=x%40example.test`)).toBe(
      'https://api.example.test/x',
    );
  });
  it('cuts a foreign absolute URL to its origin, and drops user info', () => {
    expect(server.scrubUrl(`https://u:${M}@push.other.test/send/${M}`)).toBe(
      'https://push.other.test',
    );
  });
  it('keeps an own-host URL whole, by list, by domain, and with a port', () => {
    expect(server.scrubUrl('https://db.example.test:5432/rest/v1/persons')).toBe(
      'https://db.example.test:5432/rest/v1/persons',
    );
    expect(server.scrubUrl('https://app.example.test/e/x')).toBe('https://app.example.test/e/x');
  });
  it('does not take a look-alike domain for ours', () => {
    expect(server.scrubUrl(`https://evilexample.test/p/${M}`)).toBe('https://evilexample.test');
  });
  it('with no own hosts and no domain, every absolute URL keeps only its origin', () => {
    const bare = createSentryScrubbers({ ownHosts: [], domain: '', runtime: 'server' });
    expect(bare.scrubUrl(`https://app.example.test/p/${M}`)).toBe('https://app.example.test');
  });
  it('a clean relative path survives whole', () => {
    expect(server.scrubUrl('/api/v1/events/abc')).toBe('/api/v1/events/abc');
  });
  it('never throws, and passes undefined through', () => {
    for (const odd of ['http://[', 'http://a:99999/', 'not a url', '']) {
      expect(() => server.scrubUrl(odd)).not.toThrow();
    }
    expect(server.scrubUrl(undefined)).toBeUndefined();
  });
});

describe('stripSelectorValues', () => {
  it('removes attribute values, keeps tags, classes and attribute names', () => {
    expect(stripSelectorValues(`div.footer > p[title="${EMAIL}"]`)).toBe('div.footer > p[title]');
    expect(stripSelectorValues(`button[aria-label="Remove ${M}"]`)).toBe('button[aria-label]');
  });
  it('a value holding ] is still removed whole', () => {
    expect(stripSelectorValues(`p[title="a]${M}"]`)).toBe('p[title]');
  });
  it('fails closed when a quote inside a value defeats the pattern', () => {
    expect(stripSelectorValues(`button[aria-label="Remove Jean"] Dupont"]`)).toBe(
      '[selector-removed]',
    );
    expect(stripSelectorValues(`p[title="a"b"]`)).toBe('[selector-removed]');
  });
  it('a selector with no attribute value survives whole', () => {
    expect(stripSelectorValues('button.primary > span')).toBe('button.primary > span');
  });
});

describe('beforeSend', () => {
  it('scrubs the request, our context path, the Next context and the referer', () => {
    const event = {
      transaction: `GET /e/x/pass?t=${M}`,
      request: {
        url: `https://api.example.test/a?t=${M}`,
        query_string: `t=${M}`,
        headers: { Referer: `https://app.example.test/p?t=${M}` },
      },
      contexts: {
        myclash: { path: `/api/v1/event-passes/${M}?x=1` },
        nextjs: { request_path: `/reset-password#access_token=${M}` },
      },
    };
    expect(JSON.stringify(server.beforeSend(event))).not.toContain(M);
    expect(event.request.url).toBe('https://api.example.test/a');
    expect('query_string' in event.request).toBe(false);
    expect(event.contexts.myclash.path).toBe('/api/v1/event-passes/[token]');
  });

  it('scrubs URLs quoted in an error message and in the event message', () => {
    const event = {
      message: `fetch https://app.example.test/p?t=${M} failed`,
      exception: { values: [{ value: `Failed to load https://push.other.test/send/${M}` }] },
    };
    server.beforeSend(event);
    expect(event.message).toBe('fetch https://app.example.test/p failed');
    expect(event.exception.values[0]?.value).toBe('Failed to load https://push.other.test');
  });

  it('keeps the path of the request being served, whatever its Host says', () => {
    // The served request is ours by definition; only OUTGOING addresses are cut
    // to their origin. Found by the envelope probe: a Host of `localhost` lost
    // the route from every API report.
    const event = { request: { url: `http://localhost:14000/api/v1/x/live-state?t=${M}` } };
    server.beforeSend(event);
    expect(event.request.url).toBe('http://localhost:14000/api/v1/x/live-state');
  });

  it('scrubs a stack frame file name without cutting it to the origin', () => {
    const frame = {
      filename: `app:///reset-password?token=${M}#access_token=${M}`,
      abs_path: `app:///reset-password#access_token=${M}`,
    };
    const kept = { filename: 'app:///_next/static/chunks/x.js' };
    const event = { exception: { values: [{ stacktrace: { frames: [frame, kept] } }] } };
    browser.beforeSend(event);
    expect(frame).toEqual({ filename: 'app:///reset-password', abs_path: 'app:///reset-password' });
    expect(kept.filename).toBe('app:///_next/static/chunks/x.js');
  });

  it('scrubs the breadcrumbs it carries', () => {
    const event = {
      breadcrumbs: [
        { category: 'navigation', data: { from: `/reset-password#access_token=${M}`, to: '/me' } },
      ],
    };
    expect(JSON.stringify(browser.beforeSend(event))).not.toContain(M);
  });

  it('a field that throws becomes [scrub-failed], and the next field is still scrubbed', () => {
    const request = { url: `/a?t=${M}` };
    const contexts = { myclash: { path: `/b?t=${M}` } };
    const event = {
      get transaction(): string {
        throw new Error('getter');
      },
      request,
      contexts,
    };
    const out = server.beforeSend(event);
    expect(out).not.toBeNull();
    expect(request.url).toBe('/a');
    expect(contexts.myclash.path).toBe('/b');
  });

  it('a clean event survives whole', () => {
    const event = {
      request: { url: '/api/v1/events' },
      contexts: { myclash: { path: '/api/v1/events' } },
    };
    expect(server.beforeSend(structuredClone(event))).toEqual(event);
  });
});

describe('beforeBreadcrumb', () => {
  it('scrubs navigation from/to and fetch urls, and drops url.fragment', () => {
    const crumb = {
      category: 'navigation',
      data: {
        from: `/reset-password#access_token=${M}`,
        to: `/me?password_reset=1`,
        url: `/a?t=${M}`,
        'url.fragment': M,
      },
    };
    expect(JSON.stringify(browser.beforeBreadcrumb(crumb))).not.toContain(M);
    expect(crumb.data.to).toBe('/me');
  });
  it('strips attribute values from a click crumb, keeping the tag', () => {
    const crumb = { category: 'ui.click', message: `body > div > p[title="${EMAIL}"]` };
    browser.beforeBreadcrumb(crumb);
    expect(crumb.message).toBe('body > div > p[title]');
  });
  it('scrubs a URL quoted inside a console argument, a stack included', () => {
    // Found by the browser probe on the staff login page.
    const stack = `TypeError: x\n at http://app.example.test/login?event=${M}&u=${M}:6:77`;
    const crumb = {
      category: 'console',
      message: `see https://app.example.test/p?t=${M}`,
      data: { arguments: [{ stack }, `https://app.example.test/q#${M}`] },
    };
    browser.beforeBreadcrumb(crumb);
    expect(JSON.stringify(crumb)).not.toContain(M);
    expect(crumb.data.arguments[0]).toEqual({
      stack: 'TypeError: x\n at http://app.example.test/login',
    });
  });
  it('a crumb with no data survives', () => {
    expect(browser.beforeBreadcrumb({ category: 'console', message: 'hello' })).toEqual({
      category: 'console',
      message: 'hello',
    });
  });
});

describe('beforeSendSpan', () => {
  it('scrubs the name, URL attributes (raw, wrapped, arrays) and drops fragment and query', () => {
    const out = server.beforeSendSpan(
      span(`GET https://api.example.test/a?t=${M}`, {
        'url.full': `https://api.example.test/a?t=${M}`,
        'url.path': `/api/v1/event-passes/${M}`,
        'http.target': `/a?t=${M}`,
        'url.fragment': M,
        'url.query': `t=${M}`,
        'http.request.header.referer': [`https://app.example.test/p?t=${M}`],
        'browser.web_vital.lcp.url': { value: `https://app.example.test/x?t=${M}` },
      }),
    );
    expect(JSON.stringify(out)).not.toContain(M);
    expect(out.name).toBe('GET https://api.example.test/a');
    expect(out.attributes['url.path']).toBe('/api/v1/event-passes/[token]');
  });

  it('a foreign outgoing span loses its path-only fields; an own-host twin keeps them', () => {
    const foreign = server.beforeSendSpan(
      span('POST', {
        'url.full': `https://push.other.test/send/${M}`,
        'url.path': `/send/${M}`,
        'server.address': 'push.other.test',
      }),
    );
    expect(JSON.stringify(foreign)).not.toContain(M);
    expect(foreign.attributes['url.full']).toBe('https://push.other.test');
    const own = server.beforeSendSpan(
      span('GET', { 'url.full': 'https://db.example.test/rest/v1/x', 'url.path': '/rest/v1/x' }),
    );
    expect(own.attributes['url.path']).toBe('/rest/v1/x');
  });

  it('an incoming server span keeps its path whatever its Host', () => {
    const out = server.beforeSendSpan(
      span('GET /api/v1/x', {
        'sentry.op': 'http.server',
        'server.address': 'localhost',
        'url.path': '/api/v1/x',
      }),
    );
    expect(out.attributes['url.path']).toBe('/api/v1/x');
  });

  it('strips selector values from web-vital and click spans', () => {
    const out = browser.beforeSendSpan(
      span(`click p[title="${EMAIL}"]`, {
        'browser.web_vital.lcp.element': `body > p[title="${EMAIL}"]`,
        'browser.web_vital.cls.source.1': `div[aria-label="${M}"]`,
        'browser.web_vital.inp.target': { value: `button[aria-label="Remove ${M}"]` },
      }),
    );
    expect(JSON.stringify(out)).not.toContain(EMAIL);
    expect(JSON.stringify(out)).not.toContain(M);
    expect(out.attributes['browser.web_vital.lcp.element']).toBe('body > p[title]');
  });

  it('the browser drops device and network details; the server keeps its machine device data', () => {
    const attributes = {
      'network.connection.rtt': 50,
      'network.connection.effective_type': '4g',
      'device.processor_count': 8,
      'device.memory.estimated_capacity': 4,
    };
    expect(browser.beforeSendSpan(span('pageload', attributes)).attributes).toEqual({});
    expect(server.beforeSendSpan(span('GET', { 'device.processor_count': 8 })).attributes).toEqual({
      'device.processor_count': 8,
    });
  });

  it('returns a new object, so a frozen span is scrubbed too', () => {
    const frozen = Object.freeze(
      span('GET', Object.freeze({ 'url.full': `https://api.example.test/a?t=${M}` })),
    );
    const out = server.beforeSendSpan(frozen);
    expect(out).not.toBe(frozen);
    expect(JSON.stringify(out)).not.toContain(M);
  });

  it('a span whose attributes cannot be read falls back to ids only', () => {
    const broken = {
      ...span('GET', {}),
      get attributes(): Record<string, unknown> {
        throw new Error('getter');
      },
    };
    const out = server.beforeSendSpan(broken);
    expect(out.name).toBe('[scrub-failed]');
    expect(out.attributes).toEqual({});
    expect(out.trace_id).toBe('t');
  });

  it('a span with no attributes and a clean span survive', () => {
    expect(
      server.beforeSendSpan({ ...span('GET /x', {}), attributes: undefined as never }).attributes,
    ).toEqual({});
    expect(
      server.beforeSendSpan(
        span('GET /api/v1/x', { 'url.path': '/api/v1/x', 'http.response.status_code': 200 }),
      ),
    ).toEqual(span('GET /api/v1/x', { 'url.path': '/api/v1/x', 'http.response.status_code': 200 }));
  });
});

describe('sentryBrowserIntegrations', () => {
  it('drops culture context and keeps every other integration', () => {
    const defaults = [
      { name: 'Breadcrumbs' },
      { name: 'CultureContext' },
      { name: 'BrowserTracing' },
    ];
    expect(sentryBrowserIntegrations(defaults).map((i) => i.name)).toEqual([
      'Breadcrumbs',
      'BrowserTracing',
    ]);
  });
});
