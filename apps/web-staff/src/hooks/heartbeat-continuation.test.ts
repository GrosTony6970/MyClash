import { describe, expect, it } from 'vitest';

import { shouldKeepBeating } from './heartbeat-continuation';

describe('shouldKeepBeating', () => {
  // THE REGRESSION. The hook never read the response, so a tablet on /login
  // POSTed a heartbeat every 20s forever and collected a 401 every time. At the
  // venue that is 3 refusals a minute per open tab, from one NAT'd address.
  it.each([401, 403])('stops on %i — no session, and retrying cannot make one', (status) => {
    expect(shouldKeepBeating(status)).toBe(false);
  });

  it('keeps beating on success', () => {
    expect(shouldKeepBeating(200)).toBe(true);
  });

  // A restarting API, a server fault, and the service worker's synthetic
  // offline answer. All temporary — giving up on them would leave the
  // organiser's Live board blind to a tablet that is working fine.
  it.each([500, 502, 503])('keeps beating on %i — temporary, not a verdict', (status) => {
    expect(shouldKeepBeating(status)).toBe(true);
  });

  // 404 is a deploy skew, not an authentication answer: the route moved or the
  // tablet is running an older bundle. Beating on costs one request per 20s and
  // recovers on its own once the two agree.
  it('keeps beating on 404', () => {
    expect(shouldKeepBeating(404)).toBe(true);
  });
});
