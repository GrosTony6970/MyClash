import assert from 'node:assert/strict';
import test from 'node:test';

import {
  E2E_SLUG_PREFIX,
  deleteEvent,
  exitCodeFor,
  selectDisposable,
  sweep,
} from './e2e-cleanup.mjs';

/**
 * Offline coverage for the E2E leftover sweep. No network: a fake request
 * context records every call, so the ORDER of the delete sequence and the
 * source of the verification are both assertable.
 */

const res = (status, body = []) => ({
  ok: () => status >= 200 && status < 300,
  status: () => status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

/**
 * @param list          the org's events, for a run that reads the list once
 * @param listSequence  one entry per list read, to model rows surviving a delete
 * @param deleteStatus  status the event hard-delete answers with
 */
function fakeApi({ list = [], deleteStatus = 200, listSequence } = {}) {
  const calls = [];
  let listReads = 0;
  const api = {
    get: async (path) => {
      calls.push(['GET', path]);
      if (path.includes('/organizations/') && path.endsWith('/events')) {
        const body = listSequence ? (listSequence[listReads] ?? []) : list;
        listReads += 1;
        return res(200, body);
      }
      if (path.endsWith('/tournaments')) return res(200, [{ id: 't-1' }]);
      return res(404, 'not found');
    },
    patch: async (path) => {
      calls.push(['PATCH', path]);
      return res(200);
    },
    delete: async (path) => {
      calls.push(['DELETE', path]);
      if (path.startsWith('/api/v1/events/'))
        return res(deleteStatus, deleteStatus === 200 ? [] : 'nope');
      return res(200);
    },
  };
  return { api, calls };
}

const event = (slug, kind = 'test') => ({ id: `id-${slug}`, slug, event_kind: kind });

test('claims only anchored e2e- slugs', () => {
  const picked = selectDisposable([
    event('e2e--msr87p1n', 'standard'),
    event('e2e-archive-abc'),
    event('e2e-archive-abc-restored-123'),
    // A real event that merely mentions e2e must NOT be swept: this deletes
    // hard and does not ask.
    event('fal-2026-e2e-demo'),
    event('swordfish-2027'),
    { id: 'no-slug' },
  ]);

  assert.deepEqual(
    picked.map((e) => e.slug),
    ['e2e--msr87p1n', 'e2e-archive-abc', 'e2e-archive-abc-restored-123'],
  );
  assert.equal(E2E_SLUG_PREFIX.test('my-e2e-event'), false);
});

test('carries the event kind through, so the report distinguishes the two shapes', () => {
  const picked = selectDisposable([event('e2e-run', 'standard'), event('e2e-copy', 'test')]);
  assert.deepEqual(
    picked.map((e) => e.kind),
    ['standard', 'test'],
  );
});

test('deletes in the order that actually works', async () => {
  const { api, calls } = fakeApi();

  await deleteEvent(api, { id: 'ev-1', slug: 'e2e-x' });

  assert.deepEqual(calls, [
    // Club flip FIRST: a standard event holding results refuses both deletes.
    ['PATCH', '/api/v1/events/ev-1'],
    ['GET', '/api/v1/events/ev-1/tournaments'],
    // Pools before the tournament: matches RESTRICT-reference registrations.
    ['DELETE', '/api/v1/tournaments/t-1/pools'],
    ['DELETE', '/api/v1/tournaments/t-1'],
    ['DELETE', '/api/v1/events/ev-1?mode=hard'],
  ]);
});

test('verifies against the org list, not the delete responses', async () => {
  // The trap this script exists for. The deletes all "succeed", but the org
  // still holds one of them — a per-id check would have reported success.
  const { api } = fakeApi({
    listSequence: [[event('e2e-gone'), event('e2e-stubborn')], [event('e2e-stubborn')]],
  });
  const lines = [];

  const summary = await sweep({ api, orgId: 'org-1', log: (l) => lines.push(l) });

  assert.equal(summary.found, 2);
  assert.equal(summary.deleted, 2, 'both deletes reported ok');
  assert.equal(summary.failed, 0);
  assert.equal(summary.remaining, 1, 'but the list says one survived');
  assert.ok(lines.some((l) => l.includes('STILL PRESENT') && l.includes('e2e-stubborn')));
});

test('reports a refused delete instead of counting it', async () => {
  const { api } = fakeApi({
    listSequence: [[event('e2e-x')], [event('e2e-x')]],
    deleteStatus: 409,
  });

  const summary = await sweep({ api, orgId: 'org-1', log: () => {} });

  assert.equal(summary.deleted, 0);
  assert.equal(summary.failed, 1);
  assert.equal(summary.remaining, 1);
});

test('--dry-run touches nothing', async () => {
  const { api, calls } = fakeApi({ list: [event('e2e-x')] });

  const summary = await sweep({ api, orgId: 'org-1', dryRun: true, log: () => {} });

  assert.equal(summary.found, 1);
  assert.equal(summary.deleted, 0);
  assert.equal(summary.remaining, 1, 'dry run leaves everything in place');
  assert.deepEqual(
    calls.filter(([method]) => method !== 'GET'),
    [],
    'no writes',
  );
});

test('an empty org is a no-op, not a failure', async () => {
  const { api, calls } = fakeApi({ list: [] });

  const summary = await sweep({ api, orgId: 'org-1', log: () => {} });

  assert.deepEqual(summary, { found: 0, deleted: 0, failed: 0, remaining: 0 });
  assert.equal(calls.length, 1, 'lists once and stops');
});

test('a dry run that finds leftovers still exits 0', () => {
  // It shipped exiting 1, which made the reporting mode fail on every normal
  // use — the fastest way to teach everyone to ignore the exit code.
  const found = { found: 5, deleted: 0, failed: 0, remaining: 5 };

  assert.equal(exitCodeFor(found, true), 0, 'a report is not a failure');
  assert.equal(exitCodeFor(found, false), 1, 'a real sweep leaving 5 behind IS');
});

test('exits non-zero when a real sweep cannot finish the job', () => {
  assert.equal(exitCodeFor({ found: 0, deleted: 0, failed: 0, remaining: 0 }, false), 0);
  assert.equal(exitCodeFor({ found: 2, deleted: 2, failed: 0, remaining: 0 }, false), 0);
  assert.equal(exitCodeFor({ found: 2, deleted: 1, failed: 1, remaining: 1 }, false), 1);
  // Deletes all "succeeded" but the list disagrees — the case this script exists for.
  assert.equal(exitCodeFor({ found: 2, deleted: 2, failed: 0, remaining: 1 }, false), 1);
});

test('a failing list throws rather than reporting a clean sweep', async () => {
  const api = {
    get: async () => res(500, 'boom'),
    patch: async () => res(200),
    delete: async () => res(200),
  };

  await assert.rejects(
    () => sweep({ api, orgId: 'org-1', log: () => {} }),
    /could not list events/,
  );
});
