import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';
import { canTick, checkInPath, checkInRefusalWords } from './workshop-booking';

/**
 * The instructor ticks the people in the room from the dashboard's roster (operator rulings
 * 539-547). A seat or a waiting-list place has a box; a refused person has none (541). A cancelled
 * session's box shows its state and takes no tap (526). A tick changes no booking.
 *
 * This package's vitest does not compile TSX: the owners are driven here, and the dashboard is
 * read as text for the wiring.
 */
const t = (key: string) => key;
const refused = (code: string): ApiFailure =>
  ({ ok: false, kind: 'http', status: 409, code, message: 'x' }) as unknown as ApiFailure;

describe("the instructor's Present box", () => {
  it('names the booking by its roster row', () => {
    expect(checkInPath('s-1', 'tom-row')).toBe(
      '/api/v1/workshop-sessions/s-1/enrollments/tom-row/check-in',
    );
  });

  it('is drawn for a seat and a waiting-list place, never a refusal (541)', () => {
    expect(['confirmed', 'waitlisted', 'refused'].map(canTick)).toEqual([true, true, false]);
  });

  it.each([
    ['CHECK_IN_REFUSED_BOOKING', 'publicApp.me.instructor.checkInRefused'],
    ['WORKSHOP_SESSION_CANCELLED', 'publicApp.workshopDetail.sessionCancelled'],
    ['SOMETHING_ELSE', 'publicApp.me.instructor.actionError'],
  ])('says %s in the reader’s words', (code, key) => {
    expect(checkInRefusalWords(refused(code), t)).toBe(key);
  });
});

describe('the dashboard', () => {
  const page = readFileSync(
    resolve(__dirname, '../../../app/me/instructor/InstructorDashboard.tsx'),
    'utf8',
  );

  it('sends the tick to the owner’s path with { present }, and reads the roster again', () => {
    expect(page).toMatch(
      /apiRequest\(apiUrl, checkInPath\(session\.id, entry\.personId\), \{\s+method: 'PUT',\s+body: \{ present \},\s+\}\);\s+if \(result\.ok\) await loadRoster\(\);\s+else setActionError\(checkInRefusalWords\(result, t\)\);/,
    );
  });

  it('draws the box only where canTick says, and takes no tap on a cancelled session', () => {
    expect(page).toContain('{canTick(r.status) && (');
    expect(page).toContain(
      'onTick={cancelled ? undefined : (entry, present) => void tick(entry, present)}',
    );
  });
});
