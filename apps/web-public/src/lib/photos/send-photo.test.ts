// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueItem } from './photo-queue';
import { SEND_TIMEOUT_MS, sendPhoto, type PhotoFields, type PhotoTarget } from './send-photo';
import { photoSender } from './send-queue';

/** A stand-in for the browser's XMLHttpRequest: records what the page set, fires what a test says. */
class FakeXhr {
  static last: FakeXhr;
  /** Every request made, in order. */
  static all: FakeXhr[] = [];
  /** Answers given on their own, one per `send`, while any are left; none: the test answers. */
  static script: Array<[number, string]> = [];
  method = '';
  url = '';
  headers: Record<string, string> = {};
  withCredentials = false;
  timeout = 0;
  body: FormData | null = null;
  status = 0;
  responseText = '';
  aborted = false;
  upload: {
    onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.last = this;
    FakeXhr.all.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    // As a browser does for a value no header may hold.
    if (/[^\x20-\xff]/.test(value)) throw new TypeError('Invalid header value');
    this.headers[name] = value;
  }
  send(body: FormData) {
    this.body = body;
    const next = FakeXhr.script.shift();
    if (next) queueMicrotask(() => this.answer(...next));
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  answer(status: number, text: string) {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }
}

const NO_FIELDS: PhotoFields = { name: '', caption: '', tag: null };
const file = () => new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' });

const QR: PhotoTarget = { kind: 'qr', eventId: 'ev-1', token: 'tok-123' };

function send(
  fields: PhotoFields = NO_FIELDS,
  signal = new AbortController().signal,
  target: PhotoTarget = QR,
) {
  const onProgress = vi.fn();
  const result = sendPhoto({
    apiUrl: 'http://api',
    target,
    file: file(),
    fields,
    onProgress,
    signal,
  });
  return { result, onProgress, xhr: FakeXhr.last };
}

beforeEach(() => {
  FakeXhr.all = [];
  FakeXhr.script = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the request', () => {
  it('posts to the Event, the token in its header and never in the address', () => {
    const { xhr } = send();
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('http://api/api/v1/events/ev-1/photos');
    expect(xhr.url).not.toContain('tok-123');
    expect(xhr.headers).toEqual({ 'x-photo-token': 'tok-123' });
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.timeout).toBe(SEND_TIMEOUT_MS);
    expect(SEND_TIMEOUT_MS).toBe(120_000);
  });

  it('from a personal space, posts to her own Event route with her login and no token header', () => {
    const { xhr } = send(NO_FIELDS, undefined, { kind: 'account', eventId: 'ev-1' });
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('http://api/api/v1/me/events/ev-1/photos');
    expect(xhr.headers).toEqual({});
    expect(xhr.withCredentials).toBe(true);
  });

  it('sends only the fields given, the tag by its kind, and the file last', () => {
    const { xhr } = send({
      name: '  ',
      caption: ' A good touch ',
      tag: { kind: 'workshop', id: 'w-1' },
    });
    const entries = [...xhr.body!.entries()];
    expect(entries.map(([key]) => key)).toEqual(['caption', 'workshopId', 'file']);
    expect(xhr.body!.get('caption')).toBe('A good touch');
    expect(xhr.body!.get('workshopId')).toBe('w-1');
    expect((xhr.body!.get('file') as File).name).toBe('a.jpg');
  });

  it('reports the share of the photo sent, when the browser knows it', () => {
    const { xhr, onProgress } = send();
    xhr.upload.onprogress!({ lengthComputable: true, loaded: 50, total: 100 });
    xhr.upload.onprogress!({ lengthComputable: false, loaded: 70, total: 0 });
    expect(onProgress.mock.calls).toEqual([[0.5]]);
  });
});

describe('the answer', () => {
  it('a 201 is the photo sent', async () => {
    const { xhr, result } = send();
    xhr.answer(201, JSON.stringify({ id: 'p1', status: 'waiting' }));
    await expect(result).resolves.toEqual({ ok: true, data: { id: 'p1', status: 'waiting' } });
  });

  it('a 403 keeps its code, a 413 its limit', async () => {
    const refused = send();
    refused.xhr.answer(403, JSON.stringify({ code: 'photo_link_invalid', detail: 'Not valid.' }));
    await expect(refused.result).resolves.toMatchObject({
      ok: false,
      kind: 'unauthenticated',
      status: 403,
      code: 'photo_link_invalid',
    });

    const large = send();
    large.xhr.answer(
      413,
      JSON.stringify({ code: 'file_too_large', detail: 'Too big.', maxBytes: 12 }),
    );
    await expect(large.result).resolves.toMatchObject({
      ok: false,
      kind: 'http',
      status: 413,
      code: 'file_too_large',
    });
  });

  it("an edge proxy's HTML page is a refusal with no code; an empty 201 never arrived", async () => {
    const edge = send();
    edge.xhr.answer(502, '<html>Bad Gateway</html>');
    await expect(edge.result).resolves.toMatchObject({
      ok: false,
      kind: 'http',
      status: 502,
      code: null,
    });

    const empty = send();
    empty.xhr.answer(201, '');
    await expect(empty.result).resolves.toEqual({ ok: false, kind: 'network' });
  });

  it('a dropped connection and the page cut are both a lost connection', async () => {
    const dropped = send();
    dropped.xhr.onerror!();
    await expect(dropped.result).resolves.toEqual({ ok: false, kind: 'network' });

    const cut = send();
    cut.xhr.ontimeout!();
    await expect(cut.result).resolves.toEqual({ ok: false, kind: 'network' });
  });

  it('a throw while the request is opened is a lost connection, never a rejection', async () => {
    const result = sendPhoto({
      apiUrl: 'http://api',
      target: { kind: 'qr', eventId: 'ev-1', token: 'tök☃' },
      file: file(),
      fields: NO_FIELDS,
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    });
    await expect(result).resolves.toEqual({ ok: false, kind: 'network' });
  });

  it('leaving the page aborts the send', async () => {
    const controller = new AbortController();
    const { xhr, result } = send(NO_FIELDS, controller.signal);
    controller.abort();
    await expect(result).resolves.toEqual({ ok: false, kind: 'aborted' });
    expect(xhr.aborted).toBe(true);
  });
});

describe('a login over an hour old (photoSender)', () => {
  const ACCOUNT: PhotoTarget = { kind: 'account', eventId: 'ev-1' };
  const SENT = JSON.stringify({ id: 'p1', status: 'waiting' });
  const LAPSED: [number, string] = [401, JSON.stringify({ code: 'unauthorized' })];
  const item: QueueItem = {
    key: 1,
    file: file(),
    state: 'waiting',
    progress: 0,
    message: null,
    sent: null,
  };

  async function sendWith(target: PhotoTarget, renewed: boolean, script: Array<[number, string]>) {
    FakeXhr.script = script;
    const renew = vi.fn(async () => renewed);
    const signal = new AbortController().signal;
    const send = photoSender({ apiUrl: 'http://api', target, signal }, renew);
    const result = await send(item, NO_FIELDS, { progress: vi.fn(), busy: vi.fn() });
    return { result, renew };
  }

  it('from a personal space, renews the login once and sends the photo once more', async () => {
    const { result, renew } = await sendWith(ACCOUNT, true, [LAPSED, [201, SENT]]);
    expect(result).toEqual({ ok: true, data: { id: 'p1', status: 'waiting' } });
    expect(renew.mock.calls).toEqual([['http://api']]);
    expect(FakeXhr.all).toHaveLength(2);
  });

  it('a login that does not come back answers the 401, sent once', async () => {
    const { result, renew } = await sendWith(ACCOUNT, false, [LAPSED]);
    expect(result).toMatchObject({ ok: false, kind: 'unauthenticated', status: 401 });
    expect(renew).toHaveBeenCalledOnce();
    expect(FakeXhr.all).toHaveLength(1);
  });

  it('a 403 is an answer, not a lapsed login: nothing is renewed', async () => {
    const noName: [number, string] = [403, JSON.stringify({ code: 'photo_no_name' })];
    const { result, renew } = await sendWith(ACCOUNT, true, [noName]);
    expect(result).toMatchObject({ ok: false, status: 403, code: 'photo_no_name' });
    expect(renew).not.toHaveBeenCalled();
    expect(FakeXhr.all).toHaveLength(1);
  });

  it('the QR link needs no login: its 401 is answered as it is', async () => {
    const qr: PhotoTarget = { kind: 'qr', eventId: 'ev-1', token: 'tok-123' };
    const { renew } = await sendWith(qr, true, [LAPSED]);
    expect(renew).not.toHaveBeenCalled();
    expect(FakeXhr.all).toHaveLength(1);
  });
});
