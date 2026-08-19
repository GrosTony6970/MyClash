import assert from 'node:assert/strict';
import test from 'node:test';

import { driftFindings, isWriteMode, routeCount, routes } from './check-openapi-drift.mjs';

const client = (...paths) =>
  `export interface paths {\n${paths.map((path) => `  "${path}": {\n  };`).join('\n')}\n}`;

test('routes are read out of a generated client', () => {
  assert.deepEqual(routes(client('/api/v1/events', '/api/v1/events/{id}')), [
    '/api/v1/events',
    '/api/v1/events/{id}',
  ]);
});

test('only versioned API paths count as routes', () => {
  assert.deepEqual(routes(client('/api/v1/events', '/health', '/api/v2/other')), [
    '/api/v1/events',
  ]);
});

test('the count is of distinct routes', () => {
  assert.equal(routeCount(client('/api/v1/a', '/api/v1/a', '/api/v1/b')), 2);
});

test('an identical client has not drifted', () => {
  const source = client('/api/v1/a', '/api/v1/b');

  assert.deepEqual(driftFindings(source, source), []);
});

test('a route on the API but not in the client is reported as added', () => {
  const committed = client('/api/v1/a');
  const formatted = client('/api/v1/a', '/api/v1/b');

  assert.deepEqual(driftFindings(committed, formatted), [
    '+ /api/v1/b is on the API, not in the client',
  ]);
});

test('a route in the client but no longer on the API is reported as removed', () => {
  const committed = client('/api/v1/a', '/api/v1/gone');
  const formatted = client('/api/v1/a');

  assert.deepEqual(driftFindings(committed, formatted), [
    '- /api/v1/gone is in the client, not on the API',
  ]);
});

test('both directions are reported at once', () => {
  // The failure this gate was written for was exactly this shape: 36 routes
  // missing from the client while 5 it still advertised had been deleted.
  const findings = driftFindings(client('/api/v1/old'), client('/api/v1/new'));

  assert.deepEqual(findings, [
    '+ /api/v1/new is on the API, not in the client',
    '- /api/v1/old is in the client, not on the API',
  ]);
});

test('a long drift is capped, and says how much it did not print', () => {
  const many = Array.from({ length: 25 }, (_, i) => `/api/v1/r${i}`);

  const findings = driftFindings(client(), client(...many), 20);

  assert.equal(findings.filter((line) => line.startsWith('+')).length, 20);
  assert.ok(findings.includes('… and 5 more route(s) on the API'));
});

test('drift with no route change still reports something', () => {
  // A changed request body or a renamed schema moves no route. Returning an
  // empty list there would fail the build with nothing under the header.
  const committed = `${client('/api/v1/a')}\n// body: string`;
  const formatted = `${client('/api/v1/a')}\n// body: number`;

  assert.deepEqual(driftFindings(committed, formatted), [
    'the route list matches, but the generated types differ',
  ]);
});

test('--write switches the gate from checking to regenerating', () => {
  assert.equal(isWriteMode(['--write']), true);
  assert.equal(isWriteMode([]), false);
  assert.equal(isWriteMode(['--other']), false);
});
