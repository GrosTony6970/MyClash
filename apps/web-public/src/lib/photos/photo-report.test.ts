import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages } from '@myclash/i18n/public';
import { createTranslator } from '@myclash/i18n/runtime';
import type { ApiResult } from '@myclash/api-client';
import { reportAfter, sendReport } from './photo-report';

/**
 * A spectator's Report of a public photo (design Goal 6; rulings 452-453): what the page says
 * after it, and what it sends.
 */

const en = createTranslator(messages.en);
const fr = createTranslator(messages.fr);

/** Not a catalogue sentence, so no assertion can pass on the API's own words. */
const API_WORDS = 'The API said this in English.';

function refused(status: number, code: string | null = null): ApiResult<never> {
  return {
    ok: false,
    kind: 'http',
    status,
    detail: API_WORDS,
    code,
    details: null,
    validationErrors: null,
  };
}

describe('after a Report', () => {
  it('reads Reported when the server took it', () => {
    expect(reportAfter({ ok: true, data: { reported: true } }, en)).toEqual({ kind: 'reported' });
  });

  it('says the photo is no longer shown on any 404', () => {
    for (const code of ['photo_not_found', null]) {
      expect(reportAfter(refused(404, code), en)).toEqual({
        kind: 'gone',
        message: en('publicApp.photos.report.gone'),
      });
    }
  });

  it("says to try later at the phone's hourly limit, not the throttler's sentence", () => {
    const said = reportAfter(refused(429, 'photo_report_limit'), en);
    expect(said).toEqual({ kind: 'failed', message: en('publicApp.photos.report.limit') });
    expect(reportAfter(refused(429), en)).toEqual({
      kind: 'failed',
      message: en('common.apiFailure.tooManyRequests'),
    });
  });

  it('says maintenance, a network fault and a server fault in its own words', () => {
    expect(reportAfter(refused(503, 'read_only_mode'), en)).toEqual({
      kind: 'failed',
      message: en('common.apiFailure.readOnlyMode'),
    });
    expect(reportAfter({ ok: false, kind: 'network' }, en)).toEqual({
      kind: 'failed',
      message: en('common.apiFailure.network'),
    });
    expect(reportAfter(refused(500), en)).toEqual({
      kind: 'failed',
      message: en('publicApp.photos.report.failed'),
    });
  });

  it('has every sentence in English and French', () => {
    for (const key of ['gone', 'limit', 'failed']) {
      const english = en(`publicApp.photos.report.${key}`);
      const french = fr(`publicApp.photos.report.${key}`);
      expect(english).not.toMatch(/publicApp/);
      expect(french).not.toMatch(/publicApp/);
      expect(french).not.toBe(english);
    }
  });
});

describe('the Report sent', () => {
  afterEach(() => vi.unstubAllGlobals());

  function sent() {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ reported: true })));
    vi.stubGlobal('fetch', fetch);
    return () => {
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      return { url, init, body: JSON.parse(String(init.body)) as unknown };
    };
  }

  it('posts the comment, trimmed, as JSON', async () => {
    const request = sent();
    await sendReport('https://api.test', 'ev-1', 'ph-1', '  this is me  ');
    const { url, init, body } = request();
    expect(url).toBe('https://api.test/api/v1/events/ev-1/photos/ph-1/report');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(body).toEqual({ comment: 'this is me' });
  });

  it('posts null for no comment, or one of spaces', async () => {
    for (const comment of ['', '   ']) {
      const request = sent();
      await sendReport('https://api.test', 'ev-1', 'ph-1', comment);
      expect(request().body).toEqual({ comment: null });
      vi.unstubAllGlobals();
    }
  });
});
