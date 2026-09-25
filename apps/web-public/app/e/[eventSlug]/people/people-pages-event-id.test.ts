import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The people pages call the API with the Event's id (operator rulings 121a, 121b).
 *
 * Both sent the Event's SLUG where every route wants its id, so the search answered 400 and every
 * participant link said "Person not found"; the profile read also named a route that never
 * existed. The Follow button guessed "signed in" from httpOnly cookies it cannot read, so no tap
 * reached the server and a signed-out tap "saved locally" into a key nothing reads.
 *
 * This package's vitest does not compile TSX, so the pages are read as text.
 */
const read = (...path: string[]) => readFileSync(join(__dirname, ...path), 'utf8');

describe('the person page', () => {
  const source = read('[personId]', 'page.tsx');

  it('reads the profile and the schedule under the Event id', () => {
    expect(source).toContain('const event = await fetchEventInfo(eventSlug, apiUrl);');
    expect(source).toContain('const people = `/api/v1/events/${event.id}/people/${personId}`;');
    expect(source).toContain('apiRequest<PersonProfile>(apiUrl, people)');
    expect(source).toContain('apiRequest<PersonSchedule>(apiUrl, `${people}/schedule`)');
  });

  it('follows, unfollows and joins as a guest under the Event id', () => {
    expect(source).toContain('`/api/v1/events/${eventId}/follows/${personId}`');
    expect(source).toContain('`/api/v1/events/${eventId}/follows`');
    expect(source).toContain('`${apiUrl}/api/v1/events/${eventId}/guest-sessions`');
    expect(source).not.toMatch(/api\/v1\/events\/\$\{eventSlug\}/);
  });

  it('flips Follow only on the server’s yes, and says why when it refuses', () => {
    expect(source).toContain('const refusal = followRefusal(result);');
    expect(source).toContain('if (refusal) toast.error(t(refusal));');
    expect(source).toContain('else setFollowing(!following);');
    expect(source).not.toContain('document.cookie');
    expect(source).not.toContain('localStorage');
  });

  it('says "Person not found" only on a 404; any other failure says it failed', () => {
    // The branch must SET the failure, not only exist.
    expect(source).toMatch(
      /\} else if \(!\(profileRes\.kind === 'http' && profileRes\.status === 404\)\) \{\s*(\/\/[^\n]*\s*)*setLoadFailed\(true\);/,
    );
    expect(source).toMatch(
      /loadFailed\s*\?\s*t\('publicApp\.following\.personLoadError'\)\s*:\s*t\('publicApp\.following\.personNotFound'\)/,
    );
  });
});

describe('the people search page', () => {
  it('looks people up under the Event id', () => {
    const source = read('page.tsx');
    expect(source).toContain('fetchEventInfo(eventSlug, apiUrl)');
    expect(source).toContain('`${apiUrl}/api/v1/events/${eventId}/persons/lookup?q=');
    expect(source).not.toMatch(/api\/v1\/events\/\$\{eventSlug\}/);
  });
});
