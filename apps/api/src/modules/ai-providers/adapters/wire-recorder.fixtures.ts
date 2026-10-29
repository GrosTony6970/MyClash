/**
 * A `fetch` double for the adapter wire tests. The real Anthropic and Mistral SDKs run against it,
 * so the tests see the request an SDK actually builds and the answer it actually parses — the
 * mocked `adapters.test.ts` replaces the SDKs and cannot see either.
 *
 * Anthropic calls `fetch(url, init)` and Mistral calls `fetch(request)`; both are read through
 * `new Request(input, init)` so the recording has one shape.
 */

export interface RecordedRequest {
  method: string;
  url: string;
  /** Header names lower-cased, as `Headers` reports them. */
  headers: Record<string, string>;
  body: unknown;
}

export interface CannedResponse {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

export type Route = (request: RecordedRequest) => CannedResponse;

export interface WireRecorder {
  fetch: typeof fetch;
  requests: RecordedRequest[];
  /** Calls no route answered. A test asserts this stays empty. */
  unrouted: string[];
}

function jsonResponse(canned: CannedResponse): Response {
  return new Response(JSON.stringify(canned.body), {
    status: canned.status ?? 200,
    headers: { 'content-type': 'application/json', ...canned.headers },
  });
}

async function readRequest(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<RecordedRequest> {
  const request = new Request(input, init);
  const text = await request.text();
  return {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers),
    body: text ? (JSON.parse(text) as unknown) : null,
  };
}

/**
 * Routes are keyed `METHOD /path`. An unrouted call is answered 404 rather than thrown: a throw
 * from `fetch` reads as a connection error to the Anthropic SDK, which retries twice and reports
 * only "Connection error.", while a 404 is not retried and its body names the call.
 */
export function recordFetch(routes: Record<string, Route>): WireRecorder {
  const requests: RecordedRequest[] = [];
  const unrouted: string[] = [];
  const fetchDouble = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const recorded = await readRequest(input, init);
    requests.push(recorded);
    const key = `${recorded.method} ${new URL(recorded.url).pathname}`;
    const route = routes[key];
    if (!route) {
      unrouted.push(`${key} (${recorded.url})`);
      return jsonResponse({ status: 404, body: { error: `no wire route for ${key}` } });
    }
    return jsonResponse(route(recorded));
  };
  return { fetch: fetchDouble as typeof fetch, requests, unrouted };
}

const REMOVED_SAMPLING_PARAMS = ['temperature', 'top_p', 'top_k'];

/**
 * Anthropic's Messages API, with the one rule of API version 2026-10-21 that our adapter can
 * break: "The `temperature`, `top_p`, and `top_k` request parameters are removed. A request that
 * sends any of them returns a 400 error on every model"
 * (https://platform.claude.com/docs/en/api/versioning).
 */
export function anthropicMessagesRoute(answer: unknown): Route {
  return (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const sendsRemoved = REMOVED_SAMPLING_PARAMS.some((name) => name in body);
    if (request.headers['anthropic-version'] === '2026-10-21' && sendsRemoved) {
      return {
        status: 400,
        body: {
          type: 'error',
          error: { type: 'invalid_request_error', message: 'temperature: not supported' },
        },
      };
    }
    return { body: answer };
  };
}

/** A provider's refusal of the key: 401, and no `x-should-retry` header, so nothing retries. */
export const unauthorizedRoute: Route = () => ({
  status: 401,
  body: { type: 'error', error: { type: 'authentication_error', message: 'invalid key' } },
});
