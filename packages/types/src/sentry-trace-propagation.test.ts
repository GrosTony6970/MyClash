import { describe, expect, it } from 'vitest';
import { sentryTracePropagationTargets } from './sentry-trace-propagation';

/** Whether Sentry would send its headers to `url`: any target matches (RegExp targets only). */
function sends(targets: RegExp[], url: string): boolean {
  return targets.some((target) => target.test(url));
}

describe('sentryTracePropagationTargets', () => {
  const targets = sentryTracePropagationTargets({
    ownHosts: ['api', 'supabase-kong', 'app.myclash.test'],
    domain: ' MyClash.test ',
  });

  it.each([
    'http://api:4000/api/v1/events',
    'http://api',
    'http://supabase-kong:8000/rest/v1/events?select=id',
    'https://app.myclash.test/api/v1/me',
    'https://app.myclash.test#x',
    'https://myclash.test/',
    'https://staff.myclash.test:8443/x',
    'HTTPS://APP.MYCLASH.TEST/x',
  ])('sends them to our own %s', (url) => {
    expect(sends(targets, url)).toBe(true);
  });

  it.each([
    'https://api.anthropic.com/v1/messages',
    'https://api.openai.com/v1/chat/completions',
    // A host of ours named only in the query, the path or the user part is not ours.
    'https://evil.test/?h=app.myclash.test',
    'https://evil.test/login?next=https://app.myclash.test/x',
    'https://evil.test/app.myclash.test/x',
    'https://app.myclash.test@evil.test/x',
    // Our name as a prefix of another host is not ours.
    'https://app.myclash.test.evil.test/x',
    'http://api.evil.test/x',
    'https://notmyclash.test/x',
    'ftp://app.myclash.test/x',
  ])('keeps them from %s', (url) => {
    expect(sends(targets, url)).toBe(false);
  });

  it('a dot in a host is a dot, not any character', () => {
    expect(sends(targets, 'https://appxmyclash.test/x')).toBe(false);
  });

  it('no host and no domain: an empty list, which Sentry reads as "nowhere"', () => {
    expect(sentryTracePropagationTargets({ ownHosts: [] })).toEqual([]);
    expect(sentryTracePropagationTargets({ ownHosts: [], domain: '  ' })).toEqual([]);
  });
});
