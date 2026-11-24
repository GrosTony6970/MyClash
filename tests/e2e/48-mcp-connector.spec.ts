import { createHash, randomBytes } from 'node:crypto';
import {
  test,
  expect,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';
import { FIGHTER_LOGINS, publicBase, signInFighter, type Fighter } from './_fighters';

/**
 * Connecting Claude to a MyClash account, end to end (MCP slice 1). Runs when
 * fighter A of `_fighters.ts` is set.
 *
 * A person adds `https://api.<domain>/api/v1/mcp` to Claude and presses
 * Connect. Claude reads the door's metadata, finds GoTrue's OAuth server,
 * registers itself, sends the person to the consent page, swaps the code for a
 * token and calls the door. This spec plays Claude Code (a local callback on
 * 127.0.0.1) as fighter A:
 *
 *   1. a normal password login still works — the GoTrue issuer change touches
 *      every login token, not only Claude's;
 *   2. both discovery documents answer, and name each other;
 *   3. register, authorize with PKCE, Approve on the consent page, swap the
 *      code, then `initialize`, `tools/list` and `whoami` on the door;
 *   4. the connector token opens no other API route;
 *   5. a client whose callback is not Claude's is refused on the consent page,
 *      with no Approve button;
 *   6. GoTrue's own account endpoints with the connector token: refused since
 *      2.198 (PUT /user, grants: 403); GET /user still 200, for now
 *      (Review Focus 1 of the slice's plan);
 *   7. a refreshed token still calls the door and opens no other route, and
 *      GoTrue's plain refresh grant gives the connector's refresh token no
 *      client-less login;
 *   8. Disconnect on /me/security ends the refresh.
 *
 * Leaves behind: the two OAuth clients it registers. GoTrue lets nobody but its
 * admin delete a client, and an unapproved one grants nothing. The grant of the
 * approved one is disconnected by step 7, or by the clean-up below.
 */
const FIGHTER_A = FIGHTER_LOGINS.find((login) => login.label === 'A');

/** The API's own host: `E2E_API_URL`, else `api.` beside the public site. */
const apiBase = (
  process.env.E2E_API_URL ?? `https://api.${new URL(publicBase).hostname.replace(/^app\./, '')}`
).replace(/\/$/, '');

/** Claude Code's local callback. Nothing listens there: the browser context answers it. */
const CALLBACK = 'http://127.0.0.1:53682/callback';
const CALLBACK_URL = /^http:\/\/127\.0\.0\.1:53682\/callback(?:\?|$)/;

/** The MCP transport refuses a POST without both. */
const MCP_HEADERS = {
  accept: 'application/json, text/event-stream',
  'content-type': 'application/json',
};

interface AuthServer {
  issuer: string;
  authorize: string;
  token: string;
  register: string;
  /** What Claude asks for: the scopes the door's metadata lists. */
  scope: string;
}

interface Tokens {
  access: string;
  refresh: string;
}

/** The body of a 2xx, or a failure naming the status and the body. */
async function json<T>(res: APIResponse): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()}: ${(await res.text()).slice(0, 300)}`).toBe(
    true,
  );
  return (await res.json()) as T;
}

/** RFC 7636: a random verifier and its S256 challenge. */
function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** Dynamic client registration (RFC 7591), as a public client with one callback. */
async function register(
  http: APIRequestContext,
  server: AuthServer,
  name: string,
  redirectUri: string,
): Promise<string> {
  const client = await json<{ client_id: string }>(
    await http.post(server.register, {
      data: {
        client_name: name,
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
    }),
  );
  expect(client.client_id, 'registration returned no client_id').toBeTruthy();
  return client.client_id;
}

/** Open the authorize URL in the fighter's browser and land on the consent page. */
async function openConsent(
  page: Page,
  server: AuthServer,
  clientId: string,
  redirectUri: string,
  challenge: string,
  state: string,
): Promise<void> {
  const url = new URL(server.authorize);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: server.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  await page.goto(url.toString());
  await page.waitForURL(/\/oauth\/consent\?authorization_id=/);
}

async function refresh(
  http: APIRequestContext,
  server: AuthServer,
  clientId: string,
  refreshToken: string,
): Promise<APIResponse> {
  return http.post(server.token, {
    form: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId },
  });
}

test.describe.serial('mcp connector', () => {
  test.skip(
    !FIGHTER_A,
    'set E2E_FIGHTER_A_EMAIL/PASSWORD: a personal account with an approved claim on a fighter ' +
      'profile (see tests/e2e/_fighters.ts)',
  );

  const run = Date.now().toString(36);
  const clientName = `E2E connector (auto) ${run}`;
  let bare: APIRequestContext;
  let a: Fighter;
  let page: Page;
  let server: AuthServer;
  let clientId = '';
  let tokens: Tokens;
  let disconnected = false;

  test.beforeAll(async ({ playwright }) => {
    // No cookie of anyone's: Claude calls with its Bearer token and nothing else.
    bare = await playwright.request.newContext({ ignoreHTTPSErrors: true });
  });

  test.afterAll(async () => {
    // A failed run must not leave Claude connected to the fighter's account.
    if (a && clientId && !disconnected) {
      const res = await a.api.delete(`me/connected-apps/${encodeURIComponent(clientId)}`);
      if (!res.ok()) console.warn(`[e2e] could not disconnect ${clientName}: ${res.status()}`);
    }
    await a?.context.close();
    await bare?.dispose();
  });

  test('a normal login still works', async ({ browser }) => {
    a = await signInFighter(browser, FIGHTER_A!);
    const me = await a.api.json<{ type: string }>(await a.api.get('me'));
    expect(me.type, 'a password login after the issuer change').toBe('claimed');
    page = await a.context.newPage();
  });

  test('discovery answers', async () => {
    const resource = await json<{
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
    }>(await bare.get(`${apiBase}/.well-known/oauth-protected-resource/api/v1/mcp`));
    expect(resource.resource).toBe(`${apiBase}/api/v1/mcp`);
    const issuer = resource.authorization_servers[0] ?? '';
    expect(issuer, 'the door names its sign-in server').toMatch(/^https:\/\//);

    // RFC 8414's path insertion, the address Claude reads: the edge rewrites it
    // onto GoTrue's own document.
    const at = new URL(issuer);
    const metadata = await json<{
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint?: string;
      code_challenge_methods_supported?: string[];
    }>(await bare.get(`${at.origin}/.well-known/oauth-authorization-server${at.pathname}`));
    expect(metadata.issuer, 'GOTRUE_JWT_ISSUER must be the address the door names').toBe(issuer);
    expect(metadata.registration_endpoint, 'dynamic registration is on').toBeTruthy();
    expect(metadata.code_challenge_methods_supported).toContain('S256');

    server = {
      issuer,
      authorize: metadata.authorization_endpoint,
      token: metadata.token_endpoint,
      register: metadata.registration_endpoint!,
      scope: resource.scopes_supported.join(' '),
    };
  });

  test("Claude Code's flow", async () => {
    clientId = await register(bare, server, clientName, CALLBACK);
    const { verifier, challenge } = pkce();
    const state = randomBytes(16).toString('base64url');

    // The consent page sends the browser to the callback with the code.
    await a.context.route(CALLBACK_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '' }),
    );
    await openConsent(page, server, clientId, CALLBACK, challenge, state);
    const callback = page.waitForRequest(CALLBACK_URL);
    await page.getByRole('button', { name: 'Approve' }).click();
    const back = new URL((await callback).url());
    expect(back.searchParams.get('state')).toBe(state);
    const code = back.searchParams.get('code');
    expect(code, `the callback carries a code: ${back.search}`).toBeTruthy();

    const issued = await json<{ access_token: string; refresh_token?: string }>(
      await bare.post(server.token, {
        form: {
          grant_type: 'authorization_code',
          code: code!,
          redirect_uri: CALLBACK,
          client_id: clientId,
          code_verifier: verifier,
        },
      }),
    );
    expect(issued.refresh_token, 'the token answer carries a refresh token').toBeTruthy();
    tokens = { access: issued.access_token, refresh: issued.refresh_token! };

    let id = 0;
    const rpc = async <T>(method: string, params: object): Promise<T> => {
      id += 1;
      const answer = await json<{ result?: T; error?: unknown }>(
        await bare.post(`${apiBase}/api/v1/mcp`, {
          headers: { ...MCP_HEADERS, authorization: `Bearer ${tokens.access}` },
          data: { jsonrpc: '2.0', id, method, params },
        }),
      );
      expect(answer.error, `${method} answered an error`).toBeUndefined();
      return answer.result as T;
    };

    const hello = await rpc<{ serverInfo: { name: string } }>('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'myclash-e2e', version: '1.0.0' },
    });
    expect(hello.serverInfo.name).toBe('myclash');

    const listed = await rpc<{ tools: { name: string }[] }>('tools/list', {});
    expect(listed.tools.map((tool) => tool.name)).toEqual(['whoami']);

    const called = await rpc<{ content: { type: string; text: string }[]; isError?: boolean }>(
      'tools/call',
      { name: 'whoami', arguments: {} },
    );
    expect(called.isError ?? false).toBe(false);
    const who = JSON.parse(called.content[0]?.text ?? '{}') as { email: string | null };
    expect(who.email?.toLowerCase()).toBe(FIGHTER_A!.email.toLowerCase());
  });

  test('the token opens no other door', async () => {
    const res = await bare.get(`${apiBase}/api/v1/me/events`, {
      headers: { authorization: `Bearer ${tokens.access}` },
    });
    expect(res.status(), 'a connector token on an ordinary route').toBe(403);
  });

  test("a stranger's client is refused", async () => {
    const stranger = await register(
      bare,
      server,
      `E2E stranger (auto) ${run}`,
      'https://evil.example/cb',
    );
    const { challenge } = pkce();
    await openConsent(page, server, stranger, 'https://evil.example/cb', challenge, 'stranger');
    await expect(page.getByRole('alert')).toContainText('MyClash only connects to Claude');
    await expect(page.getByRole('alert')).toContainText('evil.example');
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });

  test("GoTrue's own account endpoints with a connector token", async () => {
    // No X-Supabase-Api-Version header: the answer is the one a plain client gets.
    // /logout is left out on purpose: it would end the session the later steps use.
    const headers = { authorization: `Bearer ${tokens.access}` };

    const put = await bare.put(`${server.issuer}/user`, { headers, data: { data: {} } });
    expect(put.status(), 'GoTrue 2.198 refuses a connector token on PUT /user').toBe(403);
    expect(
      ((await put.json()) as { error_code?: string }).error_code,
      'PUT /user refusal error_code',
    ).toBe('no_authorization');

    const grants = await bare.get(`${server.issuer}/user/oauth/grants`, { headers });
    expect(grants.status(), 'GoTrue 2.198 refuses a connector token on the grants list').toBe(403);
    expect(
      ((await grants.json()) as { error_code?: string }).error_code,
      'grants refusal error_code',
    ).toBe('no_authorization');

    const res = await bare.get(`${server.issuer}/user`, { headers });
    expect(
      res.status(),
      'GoTrue announced it will refuse OAuth client tokens on /user in a later release — when ' +
        'this goes red, move to /oauth/userinfo',
    ).toBe(200);
  });

  test('a refreshed token is still a connector token', async () => {
    // The refresh works while connected, so the refusal after Disconnect is the disconnect's.
    // Each refresh rotates the refresh token: the newest one is always kept.
    const renewed = await json<{ access_token: string; refresh_token: string }>(
      await refresh(bare, server, clientId, tokens.refresh),
    );
    tokens = { access: renewed.access_token, refresh: renewed.refresh_token };

    const called = await bare.post(`${apiBase}/api/v1/mcp`, {
      headers: { ...MCP_HEADERS, authorization: `Bearer ${tokens.access}` },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'whoami', arguments: {} },
      },
    });
    const answer = await json<{ result?: { content: { text: string }[] } }>(called);
    const who = JSON.parse(answer.result?.content[0]?.text ?? '{}') as { email: string | null };
    expect(who.email?.toLowerCase(), 'the refreshed token calls the door').toBe(
      FIGHTER_A!.email.toLowerCase(),
    );

    const other = await bare.get(`${apiBase}/api/v1/me/events`, {
      headers: { authorization: `Bearer ${tokens.access}` },
    });
    expect(other.status(), 'a refreshed connector token on an ordinary route').toBe(403);
  });

  test("GoTrue's plain refresh grant with the connector's refresh token", async () => {
    // GoTrue's own refresh endpoint, not the OAuth one: it must not turn the connector's
    // refresh token into a login that carries no `client_id`. Behind Traefik GoTrue is reached
    // directly, so no `apikey` header is needed (there is no Kong in front).
    const res = await bare.post(`${server.issuer}/token?grant_type=refresh_token`, {
      data: { refresh_token: tokens.refresh },
    });
    if (res.status() >= 400) {
      expect(res.status(), `the plain refresh was refused: ${await res.text()}`).toBeLessThan(500);
      return;
    }
    const plain = (await res.json()) as { access_token: string; refresh_token?: string };
    // Keep the newest refresh token for the Disconnect step.
    tokens = { access: plain.access_token, refresh: plain.refresh_token ?? tokens.refresh };
    const payload = JSON.parse(
      Buffer.from(plain.access_token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { client_id?: unknown };
    expect(
      typeof payload.client_id === 'string' && payload.client_id.length > 0,
      'a token from the plain refresh grant must still carry the connector client_id',
    ).toBe(true);
  });

  test('disconnect', async () => {
    await page.goto(`${publicBase}/me/security`);
    const row = page.getByRole('listitem').filter({ hasText: clientName });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Disconnect' }).click();
    await expect(row).toHaveCount(0);
    disconnected = true;

    const after = await refresh(bare, server, clientId, tokens.refresh);
    expect(
      after.status(),
      `a refresh after Disconnect: ${await after.text()}`,
    ).toBeGreaterThanOrEqual(400);
    expect(after.status()).toBeLessThan(500);
  });
});
