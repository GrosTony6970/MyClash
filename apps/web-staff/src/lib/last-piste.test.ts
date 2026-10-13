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
  pisteHolder,
  pisteToOpen,
  pisteWithNoNetwork,
  PISTES_ON_ARRIVAL,
  rememberedPiste,
  rememberPiste,
  signedInAs,
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

// Operator, 2026-10-13: the app opened with no wifi opens the piste it last had.
describe('where the tablet goes with no network', () => {
  it('is the piste it last opened: the server cannot say whose pistes these are', () => {
    expect(pisteWithNoNetwork('piste-3')).toBe('/lices/piste-3');
  });

  // Signed out by the banner, or a tablet that never opened a piste.
  it('is the sign-in screen when it remembers none', () => {
    expect(pisteWithNoNetwork(null)).toBe('/login');
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

// Operator, 2026-10-13. Anna works piste 3 and goes home without "Log out".
// Ben signs in with a desk account. With no wifi the app gave Ben piste 3.
describe('who had the piste', () => {
  afterEach(() => vi.unstubAllGlobals());

  function tablet(kept: Record<string, string> = {}) {
    const store = new Map(Object.entries(kept));
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    });
  }

  it('is the PIN account, or the MyClash account when no PIN session answers', () => {
    expect(pisteHolder({ account: { id: 'staff-1' } }, null)).toBe('pin:staff-1');
    expect(pisteHolder(null, { user: { id: 'user-9' } })).toBe('account:user-9');
    // The PIN account first, as the door of the pad asks it first.
    expect(pisteHolder({ account: { id: 'staff-1' } }, { user: { id: 'user-9' } })).toBe(
      'pin:staff-1',
    );
    // A PIN account and a MyClash account never read as one person.
    expect(pisteHolder({ account: { id: 'x' } }, null)).not.toBe(
      pisteHolder(null, { user: { id: 'x' } }),
    );
  });

  it('is nobody when the answers name nobody', () => {
    expect(pisteHolder(null, null)).toBeNull();
    expect(pisteHolder({}, { user: {} })).toBeNull();
  });

  it('the same person keeps the piste, sign-in after sign-in', () => {
    tablet();
    signedInAs('pin:anna');
    rememberPiste('piste-3');

    signedInAs('pin:anna');

    expect(rememberedPiste()).toBe('piste-3');
    expect(pisteWithNoNetwork(rememberedPiste())).toBe('/lices/piste-3');
  });

  it('another person does not get it: with no network, sign-in', () => {
    tablet();
    signedInAs('pin:anna');
    rememberPiste('piste-3');

    signedInAs('pin:ben');

    expect(rememberedPiste()).toBeNull();
    expect(pisteWithNoNetwork(rememberedPiste())).toBe('/login');
  });

  it('the piste the other person then opens is theirs', () => {
    tablet();
    signedInAs('pin:anna');
    rememberPiste('piste-3');
    signedInAs('pin:ben');
    rememberPiste('piste-1');

    signedInAs('pin:ben');

    expect(rememberedPiste()).toBe('piste-1');
  });

  it('an answer that names nobody changes nothing', () => {
    tablet();
    signedInAs('pin:anna');
    rememberPiste('piste-3');

    signedInAs(null);
    expect(rememberedPiste()).toBe('piste-3');

    // And the tablet still knows it was Anna.
    signedInAs('pin:anna');
    expect(rememberedPiste()).toBe('piste-3');
  });

  it('a piste kept with no person, from before this rule, is forgotten once', () => {
    tablet({ 'myclash.staff.lastPiste.v1': 'piste-3' });

    signedInAs('pin:anna');

    expect(rememberedPiste()).toBeNull();
  });

  it('a tablet whose store refuses breaks nothing', () => {
    const refuse = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('window', {
      localStorage: { getItem: refuse, setItem: refuse, removeItem: refuse },
    });

    expect(() => signedInAs('pin:anna')).not.toThrow();
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
      /useEffect\(\(\) => \{[^}]*if \(liceId\) rememberPiste\(liceId\);\s+\}, \[liceId\]\);/,
    );
    expect(list).not.toContain('rememberPiste');
  });

  it('the link of a piste goes to the plain list', () => {
    expect(read('app', 'lices', '[liceId]', '_components', 'LiceHeader.tsx')).toContain(
      'href="/lices"',
    );
  });

  // Before the read of the pistes: a remembered piste of another person is
  // gone when `pisteToOpen` reads it.
  it('the list of pistes tells the tablet who is signed in, before it reads the pistes', () => {
    const told = list.indexOf(
      'signedInAs(pisteHolder(staff.ok ? staff.data : null, account?.ok ? account.data : null));',
    );
    expect(told).toBeGreaterThan(-1);
    expect(told).toBeLessThan(list.indexOf("api.get('/api/v1/staff/assigned-lices')"));
    expect(told).toBeGreaterThan(list.indexOf("if (decision.kind === 'sign_in')"));
  });

  it('the PIN sign-in tells it too: a desk account never opens the list of pistes', () => {
    expect(read('app', 'login', 'useStaffPinLogin.ts')).toMatch(
      /const me = await signIn\([^)]*\);\s+(\/\/[^\n]*\s+)*signedInAs\(pisteHolder\(me, null\)\);/,
    );
  });

  it('the sign-out of the Event banner forgets the piste', () => {
    expect(read('src', 'components', 'EventBanner.tsx')).toMatch(
      /forgetPiste\(\);\s+router\.replace\(signInPath\(pathname \?\? ''\)\);/,
    );
  });
});
