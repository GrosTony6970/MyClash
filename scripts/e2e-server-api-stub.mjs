import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * The API a web-public page reads ON THE SERVER, for the browser suite.
 *
 * No API runs in that suite. A spec answers the BROWSER's calls with
 * `page.route`, which never sees a read the Next server makes while it draws a
 * page. So a page drawn on the server (the Event home, a tab's title, a league)
 * could only be opened empty, and nothing held what it shows.
 *
 * `scripts/run-e2e.mjs` starts this beside the dev servers and points
 * web-public's server reads at it (`API_URL_INTERNAL`). The browser's own API
 * address does not change.
 *
 * ── A path it does not know gets NO answer ──────────────────────────────────
 * The socket is closed. Older stories lean on "the server's read never lands"
 * (`tests/a11y/error-page.spec.ts`), and a 404 here would turn their error page
 * into a not-found page. Add a fixture under a NEW id; never answer by default.
 */
export const SERVER_API_STUB_PORT = 4010;

/** The cookie web-public forwards for a signed-in visitor (`src/lib/login-cookie.ts`). */
const LOGIN_COOKIE = 'sb-access-token';

const EVENTS = {
  'test-event': { id: 'ev-test', name: 'Open de Lyon', status: 'running' },
  'quiet-event': { id: 'ev-quiet', name: 'Coupe de Dijon', status: 'published' },
  // A draft: the API shows it to a member of its club only. Any login stands for one here.
  'draft-event': { id: 'ev-draft', name: 'Tournoi de Nancy', status: 'draft', membersOnly: true },
};

function eventRow(slug) {
  const event = EVENTS[slug];
  return {
    id: event.id,
    slug,
    name: event.name,
    status: event.status,
    event_kind: 'standard',
    city: 'Lyon',
    country: 'FR',
    start_date: '2026-03-14',
    end_date: '2026-03-15',
    timezone: 'Europe/Paris',
    organization_id: 'org-1',
    organizations: { name: 'Cercle de Lyon', slug: 'cercle-de-lyon' },
  };
}

function tournament(eventId) {
  return {
    id: `${eventId}-t1`,
    slug: 'longsword-open',
    name: 'Longsword Open',
    status: 'running',
    color: null,
    ruleset_code: null,
    registered: 12,
    waitlistCount: 0,
    poolCount: 2,
    bracketSize: 8,
    refereeCount: 4,
    poolFightsTotal: 30,
    poolFightsCompleted: 10,
    bracketFightsTotal: 7,
    bracketFightsCompleted: 0,
    scheduledStart: '2026-03-14T08:00:00.000Z',
    scheduledEnd: '2026-03-14T16:00:00.000Z',
  };
}

const ok = (json) => ({ status: 200, json });
const NOT_FOUND = { status: 404, json: { statusCode: 404, detail: 'not found' } };
const BROKEN = { status: 500, json: { statusCode: 500, detail: 'Internal server error' } };

/** The lists the Event home reads by the Event's slug, by the last word of their path. */
const HOME_LISTS = {
  participants: () => [{ personId: 'p-1', tournaments: [{ registrationState: 'active' }] }],
  'public-workshops': () => [],
  'live-state': () => ({ lices: [] }),
};

function signedIn(cookie) {
  return (cookie ?? '').includes(`${LOGIN_COOKIE}=`);
}

/** The slug of a known Event this caller may read, or the answer that refuses the read. */
function readable(slug, cookie) {
  if (slug === 'broken-event') return BROKEN;
  if (slug === 'no-such-event') return NOT_FOUND;
  const event = EVENTS[slug];
  if (!event) return null;
  if (event.membersOnly && !signedIn(cookie)) return NOT_FOUND;
  return slug;
}

/**
 * Three bouts that are over (a page of one opens no live channel): one with its
 * two fighters named, one whose names are not known, and one the public may not
 * read, as the API marks it for a member of its club.
 */
const BOUTS = {
  'bout-1': { names: ['Jean Dupont', 'Paul Martin'] },
  'bout-nameless': { names: ['', ''] },
  'bout-hidden': { names: ['Jean Dupont', 'Paul Martin'], hiddenFromPublic: true },
};

function boutRow(id) {
  return {
    id,
    match_number_label: 'L1-P1-M03',
    status: 'completed',
    red_score: 5,
    blue_score: 3,
    started_at: '2026-03-14T09:00:00.000Z',
    ended_at: '2026-03-14T09:03:00.000Z',
    red_registration_id: 'r-red',
    blue_registration_id: 'r-blue',
    winner_registration_id: 'r-red',
    end_reason: 'first_to_points',
    ...(BOUTS[id].hiddenFromPublic ? { hiddenFromPublic: true } : {}),
  };
}

function boutSummary(id) {
  const [redName, blueName] = BOUTS[id].names;
  return {
    roundCode: 'P1',
    redName,
    blueName,
    redClub: null,
    blueClub: null,
    eventTimezone: 'Europe/Paris',
    referees: [],
    bestOf: 1,
    matchFormat: null,
    scoringConfig: null,
  };
}

/** The four reads of a bout's page: `rest` is what follows `/matches/`. */
function boutAnswer([id, read, ...more]) {
  if (more.length > 0) return null;
  // A bout that is not there: each of the four reads says so.
  if (id === 'no-such-bout') return NOT_FOUND;
  if (!BOUTS[id]) return null;
  if (read === undefined) return ok(boutRow(id));
  if (read === 'summary') return ok(boutSummary(id));
  return read === 'exchanges' || read === 'penalties' ? ok([]) : null;
}

function slugOfId(eventId) {
  return Object.keys(EVENTS).find((slug) => EVENTS[slug].id === eventId);
}

/**
 * The answer to one request: `{ status, json }`, or `null` for a path this stub
 * does not know (the caller then closes the socket).
 */
export function answerFor(method, url, cookie) {
  if (method !== 'GET') return null;
  const parts = url.split('?')[0].split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1') return null;
  const rest = parts.slice(3);
  if (parts[2] === 'matches') return boutAnswer(rest);
  if (parts[2] !== 'events') return null;

  // GET /events/:slug
  if (rest.length === 1) {
    const slug = readable(rest[0], cookie);
    return typeof slug === 'string' ? ok(eventRow(slug)) : slug;
  }
  // GET /events/slug/:slug/venues
  if (rest.length === 3 && rest[0] === 'slug' && rest[2] === 'venues') {
    const slug = readable(rest[1], cookie);
    return typeof slug === 'string' ? ok([]) : slug;
  }
  if (rest.length !== 2) return null;
  // GET /events/:id/tournaments is asked by the Event's id, the other lists by its slug.
  if (rest[1] === 'tournaments') {
    const slug = readable(slugOfId(rest[0]) ?? '', cookie);
    return typeof slug === 'string' ? ok([tournament(rest[0])]) : slug;
  }
  const list = HOME_LISTS[rest[1]];
  if (!list) return null;
  const slug = readable(rest[0], cookie);
  return typeof slug === 'string' ? ok(list()) : slug;
}

/** Starts the stub; resolves with its server once it listens. */
export function startServerApiStub(port = SERVER_API_STUB_PORT) {
  const server = http.createServer((request, response) => {
    const answer = answerFor(request.method ?? '', request.url ?? '', request.headers.cookie);
    if (!answer) {
      request.socket.destroy();
      return;
    }
    response.writeHead(answer.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(answer.json));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// Alone, for one app's dev server started by hand: `node scripts/e2e-server-api-stub.mjs`.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startServerApiStub();
  console.log(`server API stub on http://127.0.0.1:${SERVER_API_STUB_PORT}`);
}
