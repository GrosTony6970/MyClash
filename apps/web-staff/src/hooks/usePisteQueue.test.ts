/**
 * The piste list has the bout screen's sync bar, and sends the tablet's queue
 * (quick win P16; operator, 2026-10-12). The live proof is
 * `tests/a11y/pad-piste-bar.spec.ts`; this pins the wiring a story cannot tell
 * apart: ONE bar, the tab's ONE engine, and the order of the listener and the
 * first send.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PAD = join(__dirname, '..', '..');
const read = (...path: string[]) => readFileSync(join(PAD, ...path), 'utf8');
const page = read('app', 'lices', '[liceId]', 'page.tsx');
const header = read('app', 'lices', '[liceId]', '_components', 'LiceHeader.tsx');
const hook = read('src', 'hooks', 'usePisteQueue.ts');

describe('the piste list', () => {
  it('draws the sync bar of the bout screen, once, and no bar of its own', () => {
    expect(page.match(/<SyncBar\b/g)).toHaveLength(1);
    expect(page).not.toContain('NetworkBar');
    expect(header).not.toContain('NetworkBar');
    expect(header).not.toContain('data-testid="network-bar"');
  });

  it('gives the bar the queue of the tablet, and the inbox its Review opens', () => {
    expect(page).toContain('const { syncEngine, syncState } = usePisteQueue(apiUrl);');
    expect(page).toMatch(
      /<SyncBar\s+networkStatus=\{networkStatus\}\s+syncState=\{syncState\}\s+syncEngine=\{syncEngine\}\s+onReview=\{\(\) => setInboxOpen\(true\)\}\s+\/>/,
    );
    expect(page).toMatch(
      /<QuarantineInbox\s+open=\{inboxOpen\}\s+onClose=\{\(\) => setInboxOpen\(false\)\}\s+syncEngine=\{syncEngine\}\s+\/>/,
    );
  });
});

describe('the queue on the piste list', () => {
  it('is the one engine of the tab', () => {
    expect(hook).toContain('const syncEngine = useMemo(() => getSyncEngine(apiUrl), [apiUrl]);');
    expect(hook).toContain('const syncState = useSyncState(syncEngine);');
  });

  it('is tried again while it waits for a network', () => {
    expect(hook).toContain('useSendWhileOffline(syncEngine, syncState);');
  });

  // An engine tells its state only when it sends: without the send at the
  // opening, the bar is green over a full queue.
  it('is sent when the screen opens, after the listener of the network is on', () => {
    const listens = hook.indexOf("window.addEventListener('online', networkIsBack);");
    const sends = hook.indexOf('syncEngine.sendBehind();');
    expect(listens).toBeGreaterThan(-1);
    expect(sends).toBeGreaterThan(listens);
  });

  // Not `sendBehind`: a send in flight that met no network would take it down.
  it('is sent when the network is back, after the send in flight', () => {
    expect(hook).toContain('const networkIsBack = () => syncEngine.sendAfterReconnect();');
    expect(hook).toContain("return () => window.removeEventListener('online', networkIsBack);");
  });
});
