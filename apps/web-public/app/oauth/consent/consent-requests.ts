import { apiRequest, fetchMe } from '@myclash/api-client';
import type { ConsentAction, ConsentAnswer, ConsentView } from '@myclash/types';
import { getPublicApiUrl } from '@/lib/api-url';
import { loginHref } from '@/lib/sign-in-return';

/** The two calls the consent page makes to the API, and the one that decides which to make. */

const CONSENT_PATH = '/api/v1/me/oauth-consent';

/** The request could not be asked about: the network is down, or GoTrue gave no usable answer. */
type Unreachable = { kind: 'network' };

/** What the page does first: sign the person in, or show the request. */
export type Opened = ConsentView | Unreachable | { kind: 'login'; href: string };

function pathOf(authorizationId: string): string {
  return `${CONSENT_PATH}/${encodeURIComponent(authorizationId)}`;
}

/** Where sign-in sends a person to come back to this very request. */
function backHere(authorizationId: string): string {
  return loginHref(`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
}

export async function fetchConsent(
  authorizationId: string,
): Promise<ConsentView | Unreachable | { kind: 'login'; href: string }> {
  const res = await apiRequest<ConsentView>(getPublicApiUrl(), pathOf(authorizationId), {
    signal: AbortSignal.timeout(15000),
  });
  if (res.ok) return res.data;
  // `apiRequest` already renewed the login once; a 401 now means it is gone.
  if (res.kind === 'unauthenticated' && res.status === 401) {
    return { kind: 'login', href: backHere(authorizationId) };
  }
  return { kind: 'network' };
}

/**
 * The page's first move. `/me` answers 200 `anonymous` to a signed-out person, so that answer
 * (never a failed response) sends them to sign in; a request that cannot be asked is not a
 * signed-out person. A missing id is an expired request: there is nothing to ask GoTrue about.
 */
export async function openConsent(authorizationId: string | null): Promise<Opened> {
  const id = authorizationId?.trim();
  if (!id) return { kind: 'expired' };
  const me = await fetchMe(getPublicApiUrl(), { signal: AbortSignal.timeout(15000) });
  if (!me.ok) return { kind: 'network' };
  if (me.data.type === 'anonymous') return { kind: 'login', href: backHere(id) };
  return fetchConsent(id);
}

export async function answerConsent(
  authorizationId: string,
  action: ConsentAction,
): Promise<
  ConsentAnswer | { kind: 'refused' | 'expired' | 'network' } | { kind: 'login'; href: string }
> {
  const res = await apiRequest<ConsentAnswer>(getPublicApiUrl(), pathOf(authorizationId), {
    method: 'POST',
    body: { action },
    signal: AbortSignal.timeout(15000),
  });
  if (res.ok) return res.data;
  // `apiRequest` already renewed the login once; a 401 now means it is gone, not that the
  // server did not answer.
  if (res.kind === 'unauthenticated' && res.status === 401) {
    return { kind: 'login', href: backHere(authorizationId) };
  }
  if (res.kind === 'unauthenticated' && res.status === 403) return { kind: 'refused' };
  if (res.kind === 'http' && res.status === 410) return { kind: 'expired' };
  return { kind: 'network' };
}
