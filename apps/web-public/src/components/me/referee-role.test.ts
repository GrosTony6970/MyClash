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
 * The three schedules and the Tournament page word a role one way. The pages
 * are not mounted by this suite, so their wiring is pinned as text; the browser
 * stories read the words.
 */
describe('every schedule asks refereeRoleLabel', () => {
  const app = join(__dirname, '..', '..', '..', 'app', 'e', '[eventSlug]');
  const tournament = join(app, 't', '[tournamentSlug]');
  const screens = {
    signedIn: readFileSync(join(__dirname, 'ScheduleView.tsx'), 'utf8'),
    guest: readFileSync(join(app, 'my-schedule', 'page.tsx'), 'utf8'),
    person: readFileSync(join(app, 'people', '[personId]', 'page.tsx'), 'utf8'),
  };

  it.each(Object.entries(screens))('%s', (_name, source) => {
    expect(source).toContain('refereeRoleLabel(');
  });

  // The Tournament page kept its own map: the raw id for a role it did not know, and an
  // English "Referee" for none. It now words the name the server sends, as the schedules do.
  it.each([
    ['the Pool footers', 'PoolsCompositionView.tsx'],
    ['the bracket cards', 'BracketLive.tsx'],
  ])('%s', (_name, file) => {
    const source = readFileSync(join(tournament, file), 'utf8');
    expect(source).toContain("from '@/components/me/referee-role'");
    expect(source).toContain('refereeRoleLabel(r.roleLabel, t)');
    expect(source).not.toContain('refereeRoleLabel(r.role)');
  });

  it('no guest page prints the role id', () => {
    expect(screens.guest).not.toContain('role.replace(');
    expect(screens.person).not.toContain('role.replace(');
  });
});
