/**
 * The app opens the last piste at once (quick win P17; operator, 2026-10-12):
 * on arrival only, and only a piste of the person who is signed in now. The
 * live proof is `tests/a11y/pad-last-piste.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { arrivalPathForRole, landingPathForRole } from './landing';
import {
  forgetPiste,
  isArrival,
  pisteToOpen,
  PISTES_ON_ARRIVAL,
  rememberedPiste,
  rememberPiste,
} from './last-piste';

describe('the piste to open at once', () => {
  it('is the last piste, when it is still one of the pistes of this sign-in', () => {
    expect(pisteToOpen(true, ['piste-1', 'piste-3'], 'piste-3')).toBe('piste-3');
  });

  // Another person, another Event, or a piste taken off this account.
  it('is none when the last piste is not one of them: the list is shown', () => {
    expect(pisteToOpen(true, ['piste-1', 'piste-2'], 'piste-3')).toBeNull();
  });

  it('is none when nothing is remembered and there are several pistes', () => {
    expect(pisteToOpen(true, ['piste-1', 'piste-2'], null)).toBeNull();
  });

  it('is the one piste of a tablet that has one, remembered or not', () => {
    expect(pisteToOpen(true, ['piste-7'], null)).toBe('piste-7');
    expect(pisteToOpen(true, ['piste-7'], 'piste-3')).toBe('piste-7');
  });

  it('is none with no assigned piste', () => {
    expect(pisteToOpen(true, [], 'piste-3')).toBeNull();
  });

  // The link "Your Lices" of a piste: the list must stay reachable.
  it('is none when the list is not opened as an arrival', () => {
    expect(pisteToOpen(false, ['piste-1', 'piste-3'], 'piste-3')).toBeNull();
    expect(pisteToOpen(false, ['piste-7'], null)).toBeNull();
  });
});

describe('an arrival', () => {
  it('is the address the app and the sign-in go to', () => {
    expect(PISTES_ON_ARRIVAL).toBe('/lices?arrive=1');
    expect(isArrival('?arrive=1')).toBe(true);
  });

  it.each(['', '?arrive=0', '?arrive', '?other=1'])('is not %j', (search) => {
    expect(isArrival(search)).toBe(false);
  });

  it('is where a scoring account lands after its sign-in, and no other role', () => {
    expect(arrivalPathForRole('scoring')).toBe(PISTES_ON_ARRIVAL);
    expect(arrivalPathForRole(undefined)).toBe(PISTES_ON_ARRIVAL);
    expect(arrivalPathForRole('checkin')).toBe('/desk');
    expect(arrivalPathForRole('gear')).toBe('/gear');
  });

  // A scorer sent away from the desk is not arriving: the list is shown.
  it('is not where a wrong screen sends its reader', () => {
    expect(landingPathForRole('scoring')).toBe('/lices');
  });
});

describe('what the tablet keeps', () => {
  afterEach(() => vi.unstubAllGlobals());

  function storage() {
    const kept = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => kept.get(key) ?? null,
        setItem: (key: string, value: string) => void kept.set(key, value),
        removeItem: (key: string) => void kept.delete(key),
      },
    });
    return kept;
  }

  it('is the piste the official opened, until somebody signs out', () => {
    const kept = storage();
    expect(rememberedPiste()).toBeNull();

    rememberPiste('piste-3');
    expect(rememberedPiste()).toBe('piste-3');
    expect([...kept.keys()]).toEqual(['myclash.staff.lastPiste.v1']);

    forgetPiste();
    expect(rememberedPiste()).toBeNull();
  });

  it('is nothing on a tablet whose store refuses: the list is shown, and nothing breaks', () => {
    const refuse = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('window', {
      localStorage: { getItem: refuse, setItem: refuse, removeItem: refuse },
    });

    expect(() => rememberPiste('piste-3')).not.toThrow();
    expect(rememberedPiste()).toBeNull();
    expect(() => forgetPiste()).not.toThrow();
  });
});

describe('the screens of the pad', () => {
  const read = (...path: string[]) => readFileSync(join(__dirname, '..', '..', ...path), 'utf8');
  const list = read('app', 'lices', 'page.tsx');

  it('the app, the PIN sign-in and the sign-in by link all land as an arrival', () => {
    expect(read('app', 'page.tsx')).toContain(
      "router.replace(decision.kind === 'allow' ? PISTES_ON_ARRIVAL : '/login');",
    );
    expect(read('app', 'login', 'useStaffPinLogin.ts')).toContain(
      'window.location.href = arrivalPathForRole(me?.account?.role);',
    );
    expect(read('app', 'login', 'MagicLinkForm.tsx')).toContain('redirectTo: PISTES_ON_ARRIVAL,');
  });

  it('the list checks the last piste against the pistes the server gave for this sign-in', () => {
    expect(list).toMatch(
      /const open = pisteToOpen\(\s+arriving,\s+lices\.map\(\(lice\) => lice\.id\),\s+rememberedPiste\(\),\s+\);/,
    );
    expect(list).toContain('const arriving = isArrival(window.location.search);');
  });

  // `replace`, both times: the browser's Back never comes back to an address that leaves.
  it('the list leaves for the piste, or drops the mark of the arrival', () => {
    expect(list).toMatch(
      /if \(open\) \{\s+leaving = true;\s+router\.replace\(`\/lices\/\$\{open\}`\);\s+return;\s+\}/,
    );
    expect(list).toContain("if (arriving) router.replace('/lices');");
    expect(list).toContain('if (!leaving) setLoading(false);');
  });

  // Not at the tap of a card alone: the Back of a bout and a link open a piste too.
  it('a piste is remembered by its own screen, however the official got there', () => {
    expect(read('app', 'lices', '[liceId]', 'page.tsx')).toMatch(
      /params\.then\(\(\{ liceId: id \}\) => \{\s+setLiceId\(id\);[^}]*rememberPiste\(id\);\s+\}\);/,
    );
    expect(list).not.toContain('rememberPiste');
  });

  it('the link of a piste goes to the plain list', () => {
    expect(read('app', 'lices', '[liceId]', '_components', 'LiceHeader.tsx')).toContain(
      'href="/lices"',
    );
  });

  it('the sign-out of the Event banner forgets the piste', () => {
    expect(read('src', 'components', 'EventBanner.tsx')).toMatch(
      /forgetPiste\(\);\s+router\.replace\(signInPath\(pathname \?\? ''\)\);/,
    );
  });
});
