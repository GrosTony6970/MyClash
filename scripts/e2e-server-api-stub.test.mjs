import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { answerFor, startServerApiStub } from './e2e-server-api-stub.mjs';

/**
 * The stub answers the reads a web-public page makes on the server, in the
 * browser suite. Two rules matter more than its fixtures: a path it does not
 * know gets NO answer (older stories need "the read never lands"), and a draft
 * Event is shown only to a request that carries a login.
 */

const LOGIN = 'mc_locale=fr; sb-access-token=abc';

test('a known Event answers its row', () => {
  const answer = answerFor('GET', '/api/v1/events/test-event', undefined);
  assert.equal(answer.status, 200);
  assert.equal(answer.json.name, 'Open de Lyon');
  assert.equal(answer.json.status, 'running');
  assert.equal(answer.json.id, 'ev-test');
});

test('an unknown Event is a 404, and a broken one a 500', () => {
  assert.equal(answerFor('GET', '/api/v1/events/no-such-event', undefined).status, 404);
  assert.equal(answerFor('GET', '/api/v1/events/broken-event', LOGIN).status, 500);
});

test('a draft Event is a 404 without a login and its row with one', () => {
  assert.equal(answerFor('GET', '/api/v1/events/draft-event', undefined).status, 404);
  assert.equal(answerFor('GET', '/api/v1/events/draft-event', 'mc_locale=fr').status, 404);
  assert.equal(answerFor('GET', '/api/v1/events/draft-event', LOGIN).json.status, 'draft');
});

test("a draft Event's lists refuse a read that carries no login", () => {
  for (const path of [
    '/api/v1/events/ev-draft/tournaments',
    '/api/v1/events/draft-event/participants',
    '/api/v1/events/draft-event/public-workshops',
    '/api/v1/events/draft-event/live-state',
    '/api/v1/events/slug/draft-event/venues',
  ]) {
    assert.equal(answerFor('GET', path, undefined).status, 404, path);
    assert.equal(answerFor('GET', path, LOGIN).status, 200, path);
  }
});

test("a Tournament's page read answers its row, by the Event's slug and its own", () => {
  const path = '/api/v1/events/test-event/tournaments/longsword-open/standings';
  const { tournament, pools } = answerFor('GET', path, undefined).json;
  assert.equal(tournament.name, 'Longsword Open');
  assert.equal(tournament.status, 'running');
  assert.deepEqual(pools, []);
});

test('a draft Tournament, and a Tournament of a draft Event, need a login', () => {
  for (const path of [
    '/api/v1/events/test-event/tournaments/sabre-draft/standings',
    '/api/v1/events/draft-event/tournaments/longsword-open/standings',
  ]) {
    assert.equal(answerFor('GET', path, undefined).status, 404, path);
    assert.equal(answerFor('GET', path, LOGIN).status, 200, path);
  }
  const draft = answerFor(
    'GET',
    '/api/v1/events/test-event/tournaments/sabre-draft/standings',
    LOGIN,
  );
  assert.equal(draft.json.tournament.status, 'draft');
});

test('a Tournament the stub does not know gets no answer', () => {
  const unknown = '/api/v1/events/test-event/tournaments/no-such/standings';
  assert.equal(answerFor('GET', unknown, undefined), null);
  assert.equal(
    answerFor('GET', '/api/v1/events/test-event/tournaments/longsword-open/other', undefined),
    null,
  );
});

test('a league answers its row by its slug, and its standings by its id', () => {
  const league = answerFor('GET', '/api/v1/leagues/lyon-cup', undefined).json;
  assert.equal(league.name, 'Coupe de Lyon');
  const { rows } = answerFor('GET', `/api/v1/leagues/${league.id}/standings`, undefined).json;
  // One fighter with a public page, one whose page the public may not open.
  assert.deepEqual(
    rows.map((row) => [row.global_persons.display_name, row.fighterSlug]),
    [
      ['Léa Martin', 'lea-martin'],
      ['Paul Hidden', null],
    ],
  );
  assert.equal(answerFor('GET', '/api/v1/leagues/lg-1/club-standings', undefined), null);
});

test('a fighter answers a profile with two recent bouts, one with no Event address', () => {
  const fighter = answerFor('GET', '/api/v1/fighters/lea-martin', undefined).json;
  assert.equal(fighter.displayName, 'Léa Martin');
  assert.deepEqual(
    fighter.recentMatches.map((bout) => [bout.id, bout.eventSlug, bout.status]),
    [
      ['bout-1', 'test-event', 'completed'],
      ['bout-2', null, 'completed'],
    ],
  );
  assert.equal(answerFor('GET', '/api/v1/fighters/lea-martin/career', undefined), null);
  assert.equal(answerFor('GET', '/api/v1/fighters/nobody', undefined), null);
});

test("a public Event's lists answer anybody", () => {
  const tournaments = answerFor('GET', '/api/v1/events/ev-test/tournaments', undefined);
  assert.equal(tournaments.json[0].name, 'Longsword Open');
  // A running Event has a bout in play on its piste; an Event not yet running, a bout to come.
  const [live] = answerFor('GET', '/api/v1/events/test-event/live-state', undefined).json.lices;
  assert.equal(live.runningMatch.status, 'running');
  assert.equal(live.nextMatch, null);
  const [quiet] = answerFor('GET', '/api/v1/events/quiet-event/live-state', undefined).json.lices;
  assert.equal(quiet.runningMatch, null);
  assert.equal(quiet.nextMatch.status, 'scheduled');
  assert.equal(
    answerFor('GET', '/api/v1/events/test-event/participants?x=1', undefined).status,
    200,
  );
});

test('the bout that is not there answers 404 on each of its reads', () => {
  for (const path of ['', '/summary', '/exchanges', '/penalties']) {
    assert.equal(answerFor('GET', `/api/v1/matches/no-such-bout${path}`, undefined).status, 404);
  }
});

test('a bout answers its row, its two names, and two empty lists', () => {
  assert.equal(answerFor('GET', '/api/v1/matches/bout-1', undefined).json.status, 'completed');
  const summary = answerFor('GET', '/api/v1/matches/bout-1/summary', undefined).json;
  assert.deepEqual([summary.redName, summary.blueName], ['Jean Dupont', 'Paul Martin']);
  assert.deepEqual(answerFor('GET', '/api/v1/matches/bout-1/exchanges', undefined).json, []);
  assert.deepEqual(answerFor('GET', '/api/v1/matches/bout-1/penalties', undefined).json, []);
  assert.equal(
    answerFor('GET', '/api/v1/matches/bout-nameless/summary', undefined).json.redName,
    '',
  );
  assert.equal(
    answerFor('GET', '/api/v1/matches/bout-1', undefined).json.hiddenFromPublic,
    undefined,
  );
  assert.equal(
    answerFor('GET', '/api/v1/matches/bout-hidden', undefined).json.hiddenFromPublic,
    true,
  );
  assert.equal(answerFor('GET', '/api/v1/matches/bout-1/other', undefined), null);
  assert.equal(answerFor('GET', '/api/v1/matches/bout-1/summary/x', undefined), null);
});

test('a path the stub does not know has no answer', () => {
  assert.equal(answerFor('GET', '/api/v1/matches/m-1', undefined), null);
  assert.equal(answerFor('GET', '/api/v1/events/some-other-event', undefined), null);
  assert.equal(answerFor('GET', '/api/v1/events/ev-unknown/tournaments', undefined), null);
  assert.equal(answerFor('GET', '/api/v1/events/test-event/programme', undefined), null);
  assert.equal(answerFor('POST', '/api/v1/events/test-event', undefined), null);
  assert.equal(answerFor('GET', '/', undefined), null);
  // Not an Event and not a bout: a league, a fighter, the caller's own space.
  assert.equal(answerFor('GET', '/api/v1/leagues/some-league', undefined), null);
  assert.equal(answerFor('GET', '/api/v1/me', undefined), null);
});

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path, headers }, (response) => {
      let body = '';
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('error', reject);
  });
}

test('over http: a known path answers JSON, an unknown path closes the socket', async () => {
  const server = await startServerApiStub(0);
  const { port } = server.address();
  try {
    const known = await get(port, '/api/v1/events/draft-event', { cookie: LOGIN });
    assert.equal(known.status, 200);
    assert.equal(JSON.parse(known.body).name, 'Tournoi de Nancy');

    await assert.rejects(get(port, '/api/v1/matches/m-1'), /socket hang up|ECONNRESET/);
  } finally {
    server.close();
  }
});
