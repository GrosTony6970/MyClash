import test from 'node:test';
import assert from 'node:assert/strict';
import { describeOpsLock } from './ops-lock-probe.mjs';

const answer = (value, status = 200) => ({ status, body: JSON.stringify(value) });

// The one line a deploy reads before it moves the checkout (infra/scripts/lib/ops-jobs-wait.sh).
test('a free lock, and a held one with its kind and start', () => {
  assert.equal(describeOpsLock(answer({ held: false, kind: null, since: null })), 'free');
  assert.equal(
    describeOpsLock(answer({ held: true, kind: 'backup', since: '2026-11-20T01:02:03.000Z' })),
    'held backup 2026-11-20T01:02:03.000Z',
  );
});

test('a lock being written has no kind yet: it is still held, of an unknown job', () => {
  assert.equal(
    describeOpsLock(answer({ held: true, kind: null, since: null })),
    'held unknown unknown',
  );
});

test('anything else is unknown, with the reason', () => {
  assert.equal(describeOpsLock({ error: new Error('ECONNREFUSED') }), 'unknown unreachable');
  // An old runner image, from before GET /ops-lock: the first deploy after this one goes on.
  assert.equal(describeOpsLock(answer({ error: 'not_found' }, 404)), 'unknown status-404');
  assert.equal(describeOpsLock({ status: 200, body: '<html>' }), 'unknown bad-answer');
  assert.equal(describeOpsLock(answer({ held: 'yes' })), 'unknown bad-answer');
});

test('a kind or a start that is not one plain word cannot reach the line', () => {
  assert.equal(
    describeOpsLock(answer({ held: true, kind: 'backup\nfree', since: 'x y' })),
    'held unknown unknown',
  );
});
