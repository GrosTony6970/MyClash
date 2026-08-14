import { describe, expect, it } from 'vitest';
import { classifyFighterResponse, isRenderable, shouldNotFound } from './fighter-outcome';

describe('classifyFighterResponse', () => {
  it('renders only a 2xx', () => {
    expect(classifyFighterResponse(200)).toBe('ok');
    expect(isRenderable(classifyFighterResponse(200))).toBe(true);
  });

  it('404s a slug that does not exist', () => {
    // The defect this replaces: a not-found BODY at status 200. Point a crawler
    // at a directory of profile links and every dead slug became an indexable
    // page saying nothing.
    expect(shouldNotFound(classifyFighterResponse(404))).toBe(true);
    expect(isRenderable(classifyFighterResponse(404))).toBe(false);
  });

  it('404s an erased slug rather than rendering it', () => {
    // The API answers 410 because search engines drop it faster than a 404 --
    // the point, when the reason for anonymising was a cached result carrying
    // the person's name. A Next page cannot emit an arbitrary status, so this
    // becomes a 404: still de-indexed, which is what the 410 was for. What
    // mattered was never serving it at 200.
    expect(classifyFighterResponse(410)).toBe('gone');
    expect(shouldNotFound(classifyFighterResponse(410))).toBe(true);
  });

  it('does NOT 404 when the API failed to answer', () => {
    // The load-bearing case. An outage that reads as "this fighter does not
    // exist" tells a crawler every profile is gone, at once, and a crawl during
    // an incident replaces real indexed profiles with nothing.
    for (const status of [500, 502, 503, 504, 429]) {
      const outcome = classifyFighterResponse(status);
      expect(outcome).toBe('error');
      expect(shouldNotFound(outcome)).toBe(false);
      expect(isRenderable(outcome)).toBe(false);
    }
  });

  it('treats an unexpected status as a failure, not as content', () => {
    for (const status of [0, 302, 418]) {
      expect(classifyFighterResponse(status)).toBe('error');
    }
  });
});
