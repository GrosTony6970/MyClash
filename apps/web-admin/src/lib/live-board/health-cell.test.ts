import { describe, expect, it } from 'vitest';
import { createTranslator, getMessages } from '@myclash/i18n';
import { healthCellText } from './health-cell';
import { deriveHealthState } from './live-board-state';
import { NOW, agoIso, mkRow, mkScorer } from './live-board.fixtures';
import type { BoardRow } from './types';

/**
 * The tablet's cell of a board row (ruling 951). A tablet that lost the network
 * with nothing queued kept its last check-in, "Synced", for ever.
 */
const t = createTranslator(getMessages('en'));
const cell = (row: BoardRow) =>
  healthCellText(row, deriveHealthState({ row, nowMs: NOW, serverNowMs: NOW }), NOW, 'en', t);

describe('healthCellText', () => {
  it('says "Synced" while the tablet checks in', () => {
    expect(cell(mkRow({ scorer: mkScorer({ lastSeenAt: agoIso(20) }) }))).toBe('Synced');
  });

  it('says how long nothing has come, once the tablet has gone quiet', () => {
    expect(cell(mkRow({ scorer: mkScorer({ lastSeenAt: agoIso(120) }) }))).toBe(
      'No news for 2 mins',
    );
    expect(cell(mkRow({ scorer: mkScorer({ lastSeenAt: agoIso(600) }) }))).toBe(
      'No news for 10 mins',
    );
  });

  it('keeps the queue and the refused hits of a tablet still talking', () => {
    const health = { outboxDepth: 3, oldestPendingAgeSec: 5, rejectedCount: 1, clockSkewMs: null };
    expect(cell(mkRow({ scorer: mkScorer({ lastSeenAt: agoIso(20) }), health }))).toBe(
      '✖ 3 waiting · 1 refused',
    );
  });
});
