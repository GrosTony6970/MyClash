import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { refereeRoleLabel } from './referee-role';

const t = (key: string) => `[${key}]`;

describe('refereeRoleLabel', () => {
  it("is the organiser's own name for the role", () => {
    expect(refereeRoleLabel('Table', t)).toBe('Table');
    expect(refereeRoleLabel('Vidéo', t)).toBe('Vidéo');
  });

  it('is a plain "Referee" for a duty with no named role', () => {
    expect(refereeRoleLabel(null, t)).toBe('[publicApp.me.events.roleReferee]');
    expect(refereeRoleLabel(undefined, t)).toBe('[publicApp.me.events.roleReferee]');
    expect(refereeRoleLabel('', t)).toBe('[publicApp.me.events.roleReferee]');
  });
});

/**
 * The three schedules word a role one way. The pages are not mounted by this
 * suite, so their wiring is pinned as text; the browser stories read the words.
 */
describe('every schedule asks refereeRoleLabel', () => {
  const app = join(__dirname, '..', '..', '..', 'app', 'e', '[eventSlug]');
  const screens = {
    signedIn: readFileSync(join(__dirname, 'ScheduleView.tsx'), 'utf8'),
    guest: readFileSync(join(app, 'my-schedule', 'page.tsx'), 'utf8'),
    person: readFileSync(join(app, 'people', '[personId]', 'page.tsx'), 'utf8'),
  };

  it.each(Object.entries(screens))('%s', (_name, source) => {
    expect(source).toContain('refereeRoleLabel(');
  });

  it('no guest page prints the role id', () => {
    expect(screens.guest).not.toContain('role.replace(');
    expect(screens.person).not.toContain('role.replace(');
  });
});
