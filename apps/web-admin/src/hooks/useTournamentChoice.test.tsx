import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberTournament, rememberedTournament } from '@/lib/tournament-choice';
import { useAddressFilters } from './useAddressFilters';
import { useTournamentChoice } from './useTournamentChoice';

/**
 * O7 (ruled 2026-10-14): a page's Tournament is the address's, then the last one picked in
 * this Event on this browser, then the first. The hook writes the choice back into the
 * address with its tab (the hash) and its other parameters kept.
 */

// One router for every render, as Next gives.
const NAVIGATION = vi.hoisted(() => {
  const replaced: string[] = [];
  return {
    search: new URLSearchParams(),
    replaced,
    router: { replace: (to: string) => replaced.push(to), push: () => undefined },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => NAVIGATION.router,
  useSearchParams: () => NAVIGATION.search,
}));

const IDS = ['t1', 't2', 't3'];

let shown: string;
let choose: (id: string) => void;
function Probe({ ids, remember }: { ids: string[]; remember?: boolean }) {
  const [chosen, pick] = useTournamentChoice('ev1', ids, { remember });
  useEffect(() => {
    shown = chosen;
    choose = pick;
  });
  return null;
}

let container: HTMLDivElement;
let root: Root;

function render(ids: string[] = IDS, remember?: boolean) {
  act(() => root.render(<Probe ids={ids} remember={remember} />));
}

/** The address moves, as `router.replace` or a followed link would move it. */
function addressSays(search: string) {
  NAVIGATION.search = new URLSearchParams(search);
}

beforeEach(() => {
  NAVIGATION.search = new URLSearchParams();
  NAVIGATION.replaced.length = 0;
  // The browser's `localStorage`, kept in a map the tests seed and read.
  const kept = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  });
  window.history.replaceState(null, '', '/org/club/events/ev1/pools?q=lea#matches');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('useTournamentChoice', () => {
  it('opens on the first, writes it into the address with the tab kept, and remembers it', () => {
    render();
    expect(shown).toBe('t1');
    expect(NAVIGATION.replaced).toEqual([
      '/org/club/events/ev1/pools?q=lea&tournamentId=t1#matches',
    ]);
    expect(rememberedTournament('ev1')).toBe('t1');
  });

  it('opens on the one last picked in this Event', () => {
    rememberTournament('ev1', 't2');
    render();
    expect(shown).toBe('t2');
  });

  it('takes a link that names a Tournament over the remembered one, and remembers the link', () => {
    rememberTournament('ev1', 't2');
    addressSays('tournamentId=t3');
    render();
    expect(shown).toBe('t3');
    expect(NAVIGATION.replaced).toEqual([]);
    expect(rememberedTournament('ev1')).toBe('t3');
  });

  it('falls back to the remembered one when the address names a Tournament the Event does not hold', () => {
    rememberTournament('ev1', 't2');
    addressSays('tournamentId=gone');
    render();
    expect(shown).toBe('t2');
  });

  it('shows nothing and writes nothing before the list arrives', () => {
    render([]);
    expect(shown).toBe('');
    expect(NAVIGATION.replaced).toEqual([]);
  });

  it('shows a click at once, before the address has moved', () => {
    addressSays('tournamentId=t1');
    render();
    act(() => choose('t2'));
    expect(shown).toBe('t2');
    expect(NAVIGATION.replaced.at(-1)).toBe(
      '/org/club/events/ev1/pools?q=lea&tournamentId=t2#matches',
    );
    expect(rememberedTournament('ev1')).toBe('t2');
  });

  it('follows a link to another Tournament that lands after a click', () => {
    addressSays('tournamentId=t1');
    render();
    act(() => choose('t2'));
    addressSays('tournamentId=t3');
    render();
    expect(shown).toBe('t3');
  });

  // A pick, then the one before, faster than the server answers: the first write landed
  // after the second pick and won.
  it('keeps the second of two quick picks when the first one lands after it', () => {
    addressSays('tournamentId=t1');
    render();
    act(() => choose('t2'));
    act(() => choose('t1'));
    expect(shown).toBe('t1');
    addressSays('tournamentId=t2'); // the first write lands late
    render();
    expect(shown).toBe('t1');
    expect(NAVIGATION.replaced.at(-1)).toBe(
      '/org/club/events/ev1/pools?q=lea&tournamentId=t1#matches',
    );
    addressSays('tournamentId=t1');
    render();
    expect(shown).toBe('t1');
  });

  it('follows a later link back to the Tournament a landed pick left', () => {
    addressSays('tournamentId=t1');
    render();
    act(() => choose('t2'));
    addressSays('tournamentId=t2');
    render();
    addressSays('tournamentId=t1');
    render();
    expect(shown).toBe('t1');
  });

  // The two writers of the address, on one page: the filter write is still out.
  it('keeps a filter still being written when the Tournament is switched', () => {
    window.history.replaceState(null, '', '/org/club/events/ev1/persons?tournamentId=t1#list');
    addressSays('tournamentId=t1');
    let filter: (change: { q?: string }) => void = () => undefined;
    function Both() {
      const [chosen, pick] = useTournamentChoice('ev1', IDS);
      const [, setFilters] = useAddressFilters({ q: '' });
      useEffect(() => {
        shown = chosen;
        choose = pick;
        filter = setFilters;
      });
      return null;
    }
    act(() => root.render(<Both />));
    act(() => filter({ q: 'lea' }));
    act(() => choose('t2'));
    expect(NAVIGATION.replaced.at(-1)).toBe(
      '/org/club/events/ev1/persons?tournamentId=t2&q=lea#list',
    );
  });

  it('with remember off, neither reads nor writes the memory', () => {
    rememberTournament('ev1', 't2');
    render(['all', ...IDS], false);
    expect(shown).toBe('all');
    act(() => choose('t3'));
    expect(shown).toBe('t3');
    expect(rememberedTournament('ev1')).toBe('t2');
  });
});
