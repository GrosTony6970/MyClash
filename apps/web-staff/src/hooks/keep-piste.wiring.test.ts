import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The pad has no React test setup, so the wiring of "the tablet keeps its
 * piste" is pinned as text (quick-win ruling 8). What the pieces DO is held by
 * `lib/keep-piste.test.ts`, and on a screen by
 * `tests/a11y/pad-next-bout-no-network.spec.ts`.
 */
const APP = join(__dirname, '..', '..');
const read = (...path: string[]) => readFileSync(join(APP, ...path), 'utf8');

describe('the tablet keeps its piste', () => {
  it('while the piste list is open, and while a bout of the piste is open', () => {
    expect(read('app', 'lices', '[liceId]', 'page.tsx')).toContain('useKeepPiste(apiUrl, liceId);');
    // The bout's own piste: a table goes from bout to bout and never sees the list.
    expect(read('app', 'matches', '[matchId]', 'page.tsx')).toContain(
      'useKeepPiste(apiUrl, match?.liceId);',
    );
  });

  it('asks nothing with no network, while the tab is hidden, or while a read is out', () => {
    const hook = read('src', 'hooks', 'useKeepPiste.ts');

    expect(hook).toContain('if (busy || document.hidden || !navigator.onLine) return;');
    expect(hook).toContain('window.setInterval(keep, KEEP_PISTE_EVERY_MS)');
    expect(hook).toContain("window.addEventListener('online', keep);");
    expect(hook).toContain("document.addEventListener('visibilitychange', keep);");
    expect(hook).toContain('export const KEEP_PISTE_EVERY_MS = 5 * 60_000;');
  });

  // The catalogue is kept by Tournament: a hook that asks without the bout's
  // Tournament reads the per-bout key, which a bout never opened does not have.
  it('hands the bout’s Tournament down to the read of the penalty catalogue', () => {
    expect(read('src', 'components', 'MatchView.tsx')).toContain(
      'tournamentId: match.tournamentId,',
    );
    expect(read('src', 'hooks', 'useMatchScoringData.ts')).toContain(
      'usePenalties(apiUrl, matchId, refreshKey, args.tournamentId);',
    );
    const penalties = read('src', 'hooks', 'usePenalties.ts');
    expect(penalties).toContain(
      'readPenaltyCatalogue<PenaltyRuleset | null>(apiUrl, matchId, tournamentId, controller.signal)',
    );
    expect(penalties).toContain('}, [apiUrl, matchId, tournamentId]);');
  });

  it('reads a Tournament’s rules through one function, on the bout screen too', () => {
    const view = read('src', 'components', 'MatchView.tsx');
    expect(view).toContain('}>(apiUrl, match.tournamentId, controller.signal).then((result) => {');
    expect(view).not.toContain('/api/v1/tournaments/');
  });
});
