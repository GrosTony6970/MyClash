import { describe, expect, it } from 'vitest';
import { rosterRequests } from './roster-requests';

/**
 * The paths of the two requests. That the page sends them for the person on the clicked line is
 * held by `page.roster-remove.test.tsx`.
 */
describe('the requests of a Workshop roster', () => {
  const tom = { personId: 'tom-roster-row' };

  it('"Remove" deletes the booking of the listed person', () => {
    expect(rosterRequests('session-1', tom).remove).toStrictEqual({
      path: '/api/v1/workshop-sessions/session-1/enrollments/tom-roster-row',
      method: 'DELETE',
    });
  });

  it('"Promote" names the same roster row', () => {
    expect(rosterRequests('session-1', tom).promote).toStrictEqual({
      path: '/api/v1/workshop-sessions/session-1/promote/tom-roster-row',
      method: 'POST',
    });
  });
});
