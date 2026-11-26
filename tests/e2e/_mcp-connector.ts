import { createHash, randomBytes } from 'node:crypto';
import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { publicBase } from './_fighters';

/** What the MCP connector spec (48) shares: the door's address, the OAuth steps, PKCE. */

/** The API's own host: `E2E_API_URL`, else `api.` beside the public site. */
export const apiBase = (
  process.env.E2E_API_URL ?? `https://api.${new URL(publicBase).hostname.replace(/^app\./, '')}`
).replace(/\/$/, '');

/** The MCP transport refuses a POST without both. */
export const MCP_HEADERS = {
  accept: 'application/json, text/event-stream',
  'content-type': 'application/json',
};

export interface AuthServer {
  issuer: string;
  authorize: string;
  token: string;
  register: string;
  /** What Claude asks for: the scopes the door's metadata lists. */
  scope: string;
}

export interface Tokens {
  access: string;
  refresh: string;
}

/** The body of a 2xx, or a failure naming the status and the body. */
export async function json<T>(res: APIResponse): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()}: ${(await res.text()).slice(0, 300)}`).toBe(
    true,
  );
  return (await res.json()) as T;
}

/** RFC 7636: a random verifier and its S256 challenge. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** Dynamic client registration (RFC 7591), as a public client with one callback. */
export async function register(
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
export async function openConsent(
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

export async function refresh(
  http: APIRequestContext,
  server: AuthServer,
  clientId: string,
  refreshToken: string,
): Promise<APIResponse> {
  return http.post(server.token, {
    form: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId },
  });
}
