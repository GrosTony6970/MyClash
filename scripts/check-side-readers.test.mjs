import assert from 'node:assert/strict';
import test from 'node:test';

import { countSideHits, findRawSideAssignments, judge } from './check-side-readers.mjs';

// The rule, on made-up sources. The real ledger, the ratchet and the registrations are tested
// in check-side-readers.repo.test.mjs.

const API = 'apps/api/src/modules/x/x.service.ts';
const READ = "const red = row['red_registration_id'];";

const ledgerOf = (readers = {}, rawSideAssignments = {}) => ({ readers, rawSideAssignments });
const findingsOf = (files, ledger = ledgerOf()) => judge(files, ledger).findings;
const rawOf = (source) => findRawSideAssignments(source, API);

// ── The ledger ───────────────────────────────────────────────────────────────

test('a reader nobody listed is a finding', () => {
  const findings = findingsOf([{ path: API, source: READ }]);

  assert.equal(findings.length, 1);
  assert.match(findings[0], /apps\/api\/src\/modules\/x\/x\.service\.ts/);
  assert.match(findings[0], /no ledger line/);
});

test('a visited reader whose count changed is a finding', () => {
  for (const verdict of ['side-key', 'individual-only', 'no-side-read']) {
    const ledger = ledgerOf({ [API]: { verdict, hits: 2, why: 'one person' } });

    const findings = findingsOf([{ path: API, source: READ }], ledger);

    assert.equal(findings.length, 1, verdict);
    assert.match(findings[0], /re-read this file, then update the count/);
  }
});

test('a not-yet reader whose count changed is not a finding', () => {
  const ledger = ledgerOf({ [API]: { verdict: 'not-yet', hits: 7, why: '1b: the cards' } });

  assert.deepEqual(findingsOf([{ path: API, source: READ }], ledger), []);
});

test('a ledger line for a file with no hits is a finding, unless it is listed by hand', () => {
  const clean = { path: API, source: 'const nothing = 1;' };

  const stale = findingsOf(
    [clean],
    ledgerOf({ [API]: { verdict: 'not-yet', hits: 1, why: '1b: x' } }),
  );
  assert.equal(stale.length, 1);
  assert.match(stale[0], /delete this line/);

  const byHand = ledgerOf({
    [API]: { verdict: 'not-yet', hits: 0, why: '1b: reads a card row', byHand: true },
  });
  assert.deepEqual(findingsOf([clean], byHand), []);
});

test('a not-yet without its slice is a finding', () => {
  for (const why of ['later', 'the cards, 1b', '3: someday']) {
    const ledger = ledgerOf({ [API]: { verdict: 'not-yet', hits: 1, why } });

    const findings = findingsOf([{ path: API, source: READ }], ledger);

    assert.equal(findings.length, 1, why);
    assert.match(findings[0], /slice/);
  }
});

test('an empty why is a finding', () => {
  const ledger = ledgerOf({ [API]: { verdict: 'individual-only', hits: 1, why: ' ' } });

  const findings = findingsOf([{ path: API, source: READ }], ledger);

  assert.equal(findings.length, 1);
  assert.match(findings[0], /why/);
});

test('a byHand line for a file that does not exist is a finding', () => {
  const ledger = ledgerOf({
    'apps/api/src/gone.ts': { verdict: 'not-yet', hits: 0, why: '1b: x', byHand: true },
  });

  const findings = findingsOf([{ path: API, source: '' }], ledger);

  assert.equal(findings.length, 1);
  assert.match(findings[0], /gone\.ts/);
  assert.match(findings[0], /delete this line/);
});

// ── Hits ─────────────────────────────────────────────────────────────────────

test('a side read through a foreign-key name is a hit', () => {
  assert.equal(
    countSideHits('red:registrations!matches_red_registration_id_fkey(persons(given_name))'),
    1,
  );
});

test('a side token after a letter or a digit is not a hit', () => {
  // `orderedRegistrationIds` (a waiting list) holds `redRegistrationId`; `_` still may come first.
  assert.equal(countSideHits('reorder(tournamentId, dto.orderedRegistrationIds);'), 0);
  assert.equal(countSideHits('const x = a2red_registration_id;'), 0);
  assert.equal(countSideHits('matches_blue_registration_id_fkey'), 1);
});

test('each occurrence of a side token counts', () => {
  const source = [
    'const a = m.redRegId;',
    'const b = m.blueRegId;',
    "select('winner_registration_id, registration_a_id, registration_b_id')",
    'const f = row.forfeitingRegistrationId;',
  ].join('\n');

  assert.equal(countSideHits(source), 6);
});

test('bare registration_id counts only beside a side table, a penalty or a protest', () => {
  assert.equal(countSideHits('const r = row.registration_id; const s = x.registrationId;'), 0);

  for (const context of [
    "from('pool_members')",
    "from('match_forfeits')",
    "from('match_penalties')",
    "from('match_protests')",
    '// a Penalty row',
    'type ProtestRow = {}',
  ]) {
    const source = `${context}\nconst r = row.registration_id; const s = x.registrationId;`;
    assert.equal(countSideHits(source), 2, context);
  }

  // Whole words only: the side tokens are not counted twice.
  assert.equal(countSideHits("from('match_penalties').select('red_registration_id')"), 1);
});

// ── Raw side ids ─────────────────────────────────────────────────────────────

test('a raw assignment into a side id is a finding', () => {
  const found = rawOf("const m = { redSideId: row['red_registration_id'] as string };");

  assert.equal(found.length, 1);
  assert.match(found[0], /x\.service\.ts:1:/);
});

test('a raw assignment wrapped onto the next line is still a finding', () => {
  const source = [
    'const m = {',
    '  winnerSideId:',
    "    row['winner_registration_id'] as string,",
    '};',
  ].join('\n');

  assert.equal(rawOf(source).length, 1);
});

test('a raw fallback beside a side id or a sideKey call is a finding', () => {
  for (const source of [
    "const m = { redSideId: bout.redSideId ?? bout.red_registration_id ?? '' };",
    'const m = { redSideId: cond ? sideKey(a, b) : row.red_registration_id };',
    'const redSideId = row.red_registration_id;',
    'this.winnerSideId = entry.registrationId;',
  ]) {
    assert.equal(rawOf(source).length, 1, source);
  }
});

test('a fallback to an empty side id is a finding, even behind sideKey', () => {
  for (const source of [
    "const m = { redSideId: sideKey(a, b) ?? '' };",
    'const m = { blueSideId: sideKey(a, b) || "" };',
    "const winnerSideId = sideKey(a, b) ?? '';",
  ]) {
    const found = rawOf(source);
    assert.equal(found.length, 1, source);
    assert.match(found[0], /an empty side becomes ''; two empty sides would compare equal/);
  }
  assert.deepEqual(rawOf('const m = { redSideId: sideKey(a, b) as string };'), []);
});

test('an assignment through sideKey passes, on one line or wrapped', () => {
  const oneLine = 'const m = { redSideId: sideKey(row.red_registration_id, row.red_team_id) };';
  const wrapped = [
    'const m = {',
    '  blueSideId:',
    "    sideKey(m['blue_registration_id'] as Id, m['blue_team_id'] as Id) as string,",
    '};',
  ].join('\n');
  const copied = 'const m = { winnerSideId: scored.winnerSideId, redSideId };';
  const assigned = 'const redSideId = sideKey(row.red_registration_id, row.red_team_id);';

  for (const source of [oneLine, wrapped, copied, assigned]) assert.deepEqual(rawOf(source), []);
});

test('a type declaration is not an assignment', () => {
  assert.deepEqual(rawOf('interface Bout { redSideId: string; }'), []);
  assert.deepEqual(rawOf('interface Bout { redSideId: Map<string, string>; }'), []);
});

test('a type wrapped over several members is not an assignment', () => {
  assert.deepEqual(
    rawOf('bout: { redSideId?: string | null; winnerSideId: string | null; endReason: string }'),
    [],
  );
});

test('a typed declaration is judged by its first value', () => {
  assert.deepEqual(rawOf('let winnerSideId: string | null = null;'), []);
  assert.equal(rawOf('let winnerSideId: string | null = row.winner_registration_id;').length, 1);
});

test('a comment is not an assignment', () => {
  const source = [
    '// redSideId: row.red_registration_id',
    '/**',
    ' * winnerSideId: m.winner_registration_id, as the old code did',
    ' */',
  ].join('\n');

  assert.deepEqual(rawOf(source), []);
});

test('a side id copied out by a destructuring rename is not an assignment', () => {
  assert.deepEqual(rawOf('const { redSideId: red, blueSideId: blue } = sides;'), []);
  assert.deepEqual(rawOf(['const {', '  redSideId: red,', '} = match;'].join('\n')), []);
  // An object literal is not a pattern, even with a bare name for its value.
  assert.equal(rawOf('return { redSideId: redId };').length, 1);
});

test('a raw assignment counts only in .ts and .tsx under apps/', () => {
  const source = "const m = { redSideId: row['red_registration_id'] };";

  assert.equal(findRawSideAssignments(source, 'apps/web-staff/src/x.tsx').length, 1);
  assert.deepEqual(findRawSideAssignments(source, 'packages/ui/src/x.ts'), []);
  assert.deepEqual(findRawSideAssignments(source, 'apps/api/src/x.mjs'), []);
});

test('a side id written into winner_registration_id is a finding', () => {
  const shapes = [
    'const u = { winner_registration_id: scored.winnerSideId };',
    "const u = { ['winner_registration_id']: scored.winnerSideId };",
    "matchUpdates['winner_registration_id'] = scored.winnerSideId;",
    'row.winner_registration_id = outcome.winnerSideId;',
    [
      "updates['winner_registration_id'] =",
      "  series.winnerColor === 'red'",
      '    ? match.redSideId',
      "    : series.winnerColor === 'blue'",
      '      ? match.blueSideId',
      '      : null;',
    ].join('\n'),
  ];

  for (const source of shapes) {
    const found = rawOf(source);
    assert.equal(found.length, 1, source);
    assert.match(found[0], /use `winnerColumns`/);
  }
});

test('a Registration id written into winner_registration_id passes', () => {
  const sources = [
    'return { winner_registration_id: registrationId, winner_team_id: teamId };',
    "updates['winner_registration_id'] = null;",
    'if (row.winner_registration_id === match.redSideId) return;',
  ];

  for (const source of sources) assert.deepEqual(rawOf(source), [], source);
});

test('a raw assignment is a finding unless the ledger excuses it with its exact count', () => {
  const files = [{ path: API, source: "const m = { redSideId: '', blueSideId: '' };" }];

  assert.equal(findingsOf(files).length, 2);

  const excused = ledgerOf({}, { [API]: { count: 2, why: 'asks only for the round count' } });
  assert.deepEqual(findingsOf(files, excused), []);

  const wrongCount = ledgerOf({}, { [API]: { count: 1, why: 'asks only for the round count' } });
  assert.equal(findingsOf(files, wrongCount).length, 1);

  const stale = ledgerOf({}, { [API]: { count: 2, why: 'x' } });
  assert.match(findingsOf([{ path: API, source: '' }], stale)[0], /delete this line/);
});

// ── What is scanned ──────────────────────────────────────────────────────────

test('a test file is not scanned', () => {
  for (const path of [
    'apps/api/src/x.test.ts',
    'apps/web-staff/src/x.spec.tsx',
    'apps/api/src/x.fixtures.ts',
    'apps/api/src/common/testing/rows.ts',
    'apps/api/test-helpers/rows.ts',
    'packages/db/fixtures/seed.sql',
    'packages/api-client/src/generated/schema.ts',
  ]) {
    const result = judge([{ path, source: READ }], ledgerOf());
    assert.equal(result.scanned, 0, path);
    assert.deepEqual(result.findings, [], path);
  }
});

test('a harness file is not scanned', () => {
  const result = judge([{ path: 'apps/api/src/x.harness.ts', source: READ }], ledgerOf());

  assert.equal(result.scanned, 0);
  assert.deepEqual(result.findings, []);
});

test('only source files under apps/, packages/ and scripts/ are scanned', () => {
  const kept = ['apps/a.ts', 'apps/a.tsx', 'packages/db/migrations/1.sql', 'scripts/a.mjs'];
  const dropped = ['docs/a.ts', 'tests/e2e/a.ts', 'apps/a.md', 'apps/a.json', 'apps/a.js'];
  const files = [...kept, ...dropped].map((path) => ({ path, source: 'x' }));

  assert.equal(judge(files, ledgerOf()).scanned, kept.length);
});
