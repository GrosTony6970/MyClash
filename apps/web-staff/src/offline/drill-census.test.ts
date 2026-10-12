/**
 * Every request the pad makes, and which side of the offline drill it is on
 * (operator, 2026-10-12).
 *
 * The drill stops every WRITE of a bout: the queue in `SyncEngine.postExchange`,
 * a press that goes straight to the server in `padRequest`. It was written
 * when the queue held hits only, and eight direct presses had grown beside it
 * that reached the server during a drill. Nothing said so.
 *
 * So this counts the CALLS, file by file, as an exact table. A call put back
 * on `apiRequest`, one more call, or a new file with a request, fails here:
 * name it as stopped by the drill (`drill`, `queue`) or as left open, with
 * the reason. Per call and not per file: `MatchView.tsx` keeps a read beside
 * its two presses.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(__dirname, '..', '..');

/** The names a request of the pad is made through (`api` is the desks' client, `lib/api.ts`). */
const CALL =
  /\b(apiRequest|padRequest|fetchRenewingLogin|fetchMe|fetchFn|fetch|api\s*\.(?:get|post|put|patch|delete))(?:<[^()]*>)?\(/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    const isSource = /\.tsx?$/.test(name) && !/\.(test|fixtures)\.tsx?$/.test(name);
    return isSource ? [path] : [];
  });
}

/** Comments name these functions too: only code is counted. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function census(): Record<string, string> {
  const found: Record<string, string> = {};
  for (const path of [...sources(join(APP, 'src')), ...sources(join(APP, 'app'))]) {
    const counts = new Map<string, number>();
    for (const [, call] of code(readFileSync(path, 'utf8')).matchAll(CALL)) {
      // `api` and its method can be on two lines.
      const name = call!.replace(/\s+/g, '');
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    if (counts.size === 0) continue;
    const file = relative(APP, path).replaceAll('\\', '/');
    found[file] = [...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => `${name} ${count}`)
      .join(', ');
  }
  return found;
}

/**
 * `drill`: through `padRequest`. `queue`: a row of the queue, sent by
 * `SyncEngine.postExchange`, which the drill answers. Everything else is left
 * open, for the reason beside it.
 */
const EXPECTED: Record<string, string> = {
  // drill: the forfeit.
  'src/components/ForfeitPanel.tsx': 'padRequest 1',
  // Rendered nowhere (older than the drill's census): its clock read and press.
  'src/components/MatchClock.tsx': 'apiRequest 2',
  // drill: the five corrections that post, and "Edit as no exchange".
  'src/components/MatchCorrectionsDrawer.tsx': 'padRequest 2',
  // open: the read of the next sequence. drill: Reopen and Reset, and Unlock.
  'src/components/MatchView.tsx': 'apiRequest 1, padRequest 2',
  // open: who is signed in.
  'src/components/StaffScreen.tsx': 'apiRequest 1',
  // open: the heartbeat goes during a drill, and reports the waiting entries.
  'src/hooks/useHeartbeat.ts': 'fetch 1',
  // open: the Pool's and the bracket's tables, read on demand.
  'src/hooks/useLazyFetch.ts': 'fetch 1',
  // open: the piste's list of bouts, a read.
  'src/hooks/useLiceMatches.ts': 'fetchFn 1',
  // open: the read of the server's clock.
  'src/hooks/usePadClock.ts': 'apiRequest 1',
  // open: the sign-out of an account.
  'src/lib/account-sign-out.ts': 'apiRequest 1',
  // open: the reads of a bout and of its lists.
  'src/lib/bout-list-read.ts': 'fetchFn 1',
  'src/lib/bout-read.ts': 'fetchFn 2',
  // drill: the undo's read of the server, so the undo works on the tablet alone.
  'src/lib/server-entries.ts': 'padRequest 3',
  // open: the read of the bout's status. Its void is `askVoid`, below.
  'src/lib/settle-undone.ts': 'apiRequest 1',
  // open: the desks (check-in, gear) are no part of a bout.
  'src/lib/useDesk.ts': 'api.get 1, api.post 3',
  'src/lib/useGear.ts': 'api.get 1, api.post 1',
  // open: the gear checks of a bout's two fighters, and the Events of the sign-in, reads.
  'src/lib/useMatchGear.ts': 'api.get 1',
  'src/lib/usePickerEvents.ts': 'api.get 1',
  // drill: the void of a hit or a card, for the undo and for its settle.
  'src/lib/void-entry.ts': 'padRequest 1',
  // open: setup data, a read kept on the tablet.
  'src/offline/cached-reads.ts': 'fetch 1',
  // The seam itself: the one `apiRequest` behind `padRequest`.
  'src/offline/drill-request.ts': 'apiRequest 1, padRequest 1',
  // queue: a clock press, a round press, a step of a level bout.
  'src/offline/press-send.ts': 'fetchRenewingLogin 3',
  // No caller (older than the drill's census): a read.
  'src/offline/reconcile.ts': 'fetch 1',
  // queue: a card and a hit. open: the two reads before a second try.
  'src/offline/sync.ts': 'fetch 2, fetchRenewingLogin 2',
  // open: who is signed in, and the pistes of this tablet.
  'app/lices/page.tsx': 'api.get 1, apiRequest 1, fetchMe 1',
  'app/page.tsx': 'apiRequest 1, fetchMe 1',
  // open: the sign-in, and the sign-out of the Event's banner.
  'app/login/MagicLinkForm.tsx': 'api.post 1',
  'app/login/useStaffPinLogin.ts': 'api.post 1',
  'src/components/EventBanner.tsx': 'api.post 1',
};

describe('the requests of the pad, and the offline drill', () => {
  it('each call is named: stopped by the drill, or left open for a reason', () => {
    expect(census()).toEqual(EXPECTED);
  });

  it('the queue meets the drill before any of its five doors', () => {
    const engine = readFileSync(join(APP, 'src', 'offline', 'sync.ts'), 'utf8');
    const drill = engine.indexOf('if (isDrillActive()) return Promise.resolve(offlineResponse());');
    expect(drill).toBeGreaterThan(0);
    expect(drill).toBeLessThan(engine.indexOf('switch (kindOf(entry)) {'));
    // One caller of each door: `postExchange`.
    for (const door of ['postPress(', 'postRoundPress(', 'postLevelPress(', 'this.postCard(']) {
      expect(engine.split(door), door).toHaveLength(2);
    }
    expect(engine.split('this.postHit('), 'postHit').toHaveLength(2);
  });

  it('the end of the drill sends the queue, at the tap and when its time has passed', () => {
    const banner = readFileSync(join(APP, 'src', 'components', 'OfflineDrillBanner.tsx'), 'utf8');
    expect(banner).toContain('getSyncEngine(getApiUrl()).sendAfterReconnect();');
    expect(banner).toContain('onClick={endDrillAndSend}');
    expect(banner).toContain('if (!isDrillActiveAt(endsAt, tick)) endDrillAndSend();');
    expect(banner.match(/endOfflineDrill\(\)/g)).toHaveLength(1);
  });
});
