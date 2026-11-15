import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advisoryHits,
  annotate,
  githubRepository,
  invokedInCi,
  isOutage,
  printable,
  repositoryAdvisoryFindings,
  uncheckableVersions,
} from './check-repo-advisories.mjs';

const API = 'https://api.github.com';

test('only github.com repositories are read, in each spelling package.json uses', () => {
  assert.equal(githubRepository('git+https://github.com/nestjs/nest.git'), 'nestjs/nest');
  assert.equal(
    githubRepository({ url: 'https://github.com/vercel/next.js.git', directory: 'x' }),
    'vercel/next.js',
  );
  assert.equal(githubRepository('git://github.com/fastify/fastify.git'), 'fastify/fastify');
  assert.equal(githubRepository('git@github.com:delvedor/find-my-way.git'), 'delvedor/find-my-way');
  assert.equal(githubRepository('github:colinhacks/zod'), 'colinhacks/zod');
  assert.equal(githubRepository('colinhacks/zod'), 'colinhacks/zod');
  assert.equal(githubRepository('https://gitlab.com/owner/repo.git'), null);
  assert.equal(githubRepository('https://github.com.evil.example/owner/repo'), null);
  assert.equal(githubRepository(undefined), null);
});

test('GitHub out of reach is a 5xx, a 429 or a rate-limit 403, never another answer', () => {
  const answer = (status, headers = {}, text = '') => ({
    status,
    headers: new Headers(headers),
    text,
  });
  assert.equal(isOutage(answer(502)), true);
  assert.equal(isOutage(answer(429)), true);
  assert.equal(isOutage(answer(403, { 'x-ratelimit-remaining': '0' })), true);
  assert.equal(isOutage(answer(403, { 'retry-after': '60' })), true);
  assert.equal(isOutage(answer(403, {}, 'You have exceeded a secondary rate limit')), true);
  assert.equal(isOutage(answer(403, {}, 'Resource not accessible by integration')), false);
  assert.equal(isOutage(answer(404)), false);
});

const DEPS = new Map([
  ['@nestjs/common', { versions: new Set(['12.3.2']), importers: new Set(['apps/api']) }],
  ['@nestjs/core', { versions: new Set(['12.5.0']), importers: new Set(['apps/api']) }],
]);
const REPOS = new Map([['nestjs/nest', ['@nestjs/common', '@nestjs/core']]]);
/** A repository advisory; `extra.patched` is its one vulnerability's `patched_versions`. */
const advisory = (id, severity, name, range, { patched, ...extra } = {}) => ({
  ghsa_id: id,
  severity,
  html_url: `https://github.com/nestjs/nest/security/advisories/${id}`,
  withdrawn_at: null,
  vulnerabilities: [
    {
      package: { ecosystem: 'npm', name },
      vulnerable_version_range: range,
      ...(patched ? { patched_versions: patched } : {}),
    },
  ],
  ...extra,
});

/** A fake GitHub: `routes` maps a URL to [status, body, headers] or a function that throws. */
function fakeGitHub(routes) {
  const asked = [];
  const fetchImpl = async (url, options) => {
    asked.push(url);
    // A redirect must come back to this code, which decides whether to follow it.
    assert.equal(options.redirect, 'manual');
    const route = routes[url];
    if (typeof route === 'function') return route();
    const [status, body, headers = {}] = route ?? [404, { message: 'Not Found' }];
    return {
      status,
      url,
      headers: new Headers(headers),
      text: async () => JSON.stringify(body),
    };
  };
  return { asked, client: { token: 'probe-marker-token', fetchImpl } };
}
const LIST = `${API}/repos/nestjs/nest/security-advisories?state=published&per_page=100`;
const run = (routes, ignored = new Set()) => {
  const github = fakeGitHub(routes);
  return repositoryAdvisoryFindings({
    deps: DEPS,
    repos: REPOS,
    ignored,
    client: github.client,
  }).then((result) => ({ ...result, asked: github.asked }));
};

test('a repository-only high advisory on a locked version is a finding; one GitHub lists is not', async () => {
  const listed = advisory('GHSA-list-ed00-0000', 'high', '@nestjs/common', '>= 12.0.0, < 12.5.0');
  const fresh = advisory(
    'GHSA-fres-h000-0000',
    'critical',
    '@nestjs/common',
    '>= 12.0.0, < 12.5.0',
  );
  const { findings, answered } = await run({
    [LIST]: [200, [listed, fresh]],
    [`${API}/advisories/GHSA-list-ed00-0000`]: [200, {}],
    [`${API}/advisories/GHSA-fres-h000-0000`]: [404, {}],
  });
  assert.equal(answered, 1);
  assert.equal(findings.length, 1);
  assert.match(
    findings[0],
    /^GHSA-fres-h000-0000 \(critical\) on @nestjs\/common@12\.3\.2, inside ">= 12\.0\.0, < 12\.5\.0"/u,
  );
});

test('a medium, a withdrawn, an ignored or an out-of-range advisory is no finding, and costs no lookup', async () => {
  const { findings, asked } = await run(
    {
      [LIST]: [
        200,
        [
          advisory('GHSA-medi-um00-0000', 'medium', '@nestjs/common', '< 13.0.0'),
          advisory('GHSA-with-draw-0000', 'high', '@nestjs/common', '< 13.0.0', {
            withdrawn_at: '2026-11-13',
          }),
          advisory('GHSA-igno-red0-0000', 'high', '@nestjs/common', '< 13.0.0'),
          advisory('GHSA-past-fix0-0000', 'high', '@nestjs/core', '< 12.5.0', {
            patched: '12.5.0',
          }),
          advisory('GHSA-othe-rpkg-0000', 'high', '@nestjs/testing', '< 13.0.0'),
        ],
      ],
    },
    new Set(['GHSA-igno-red0-0000']),
  );
  assert.deepEqual(findings, []);
  assert.deepEqual(asked, [LIST]);
});

test('a range nobody can read is a finding once GitHub has not listed the advisory', async () => {
  const { findings } = await run({
    [LIST]: [
      200,
      [advisory('GHSA-unre-adab-le00', 'high', '@nestjs/common', 'all versions before the fix')],
    ],
    [`${API}/advisories/GHSA-unre-adab-le00`]: [404, {}],
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /leaves this version in doubt; read the advisory by hand/u);
});

// A hand writes the package as it likes (`withastro/astro`, `luxon.js`): a loose name that means
// one of ours is in doubt whatever its range says (ruling 806); another package's name is not.
test('a package named off its npm spelling is in doubt, never skipped', async () => {
  const loose = [
    // Range and patch both say 12.3.2 is safe: only the loose name keeps it in doubt.
    advisory('GHSA-loos-enam-e000', 'high', 'nestjs/common', '>= 99.0.0', { patched: '12.3.0' }),
    advisory('GHSA-loos-enam-e001', 'critical', 'Common.js', '>= 99.0.0', { patched: '12.3.0' }),
    advisory('GHSA-othe-rpkg-e002', 'high', '@nestjs/microservices', '< 99.0.0'),
  ];
  const { findings } = await run({
    [LIST]: [200, loose],
    [`${API}/advisories/GHSA-loos-enam-e000`]: [404, {}],
    [`${API}/advisories/GHSA-loos-enam-e001`]: [404, {}],
  });
  assert.equal(findings.length, 2);
  assert.match(
    findings[0],
    /on @nestjs\/common@12\.3\.2: .* for a package written "nestjs\/common"/u,
  );
  assert.match(findings[1], /for a package written "Common\.js" leaves this version in doubt/u);
});

test("GitHub's pages are followed, and a page or a redirect off api.github.com is refused", async () => {
  const page2 = `${API}/repositories/1/security-advisories?after=x`;
  const followed = await run({
    [LIST]: [200, [], { link: `<${page2}>; rel="next"` }],
    [page2]: [200, [advisory('GHSA-page-twoo-0000', 'high', '@nestjs/common', '< 13.0.0')]],
    [`${API}/advisories/GHSA-page-twoo-0000`]: [404, {}],
  });
  assert.equal(followed.findings.length, 1);
  const leaving = await run({
    [LIST]: [200, [], { link: '<https://example.test/steal>; rel="next"' }],
  });
  assert.match(
    leaving.findings[0],
    /^nestjs\/nest not checked: refused to leave https:\/\/api\.github\.com/u,
  );
  assert.equal(leaving.asked.includes('https://example.test/steal'), false);
});

test('GitHub out of reach is a warning per repository (ruling 776); a 404 or a refused token is an error', async () => {
  const down = await run({
    [LIST]: () => {
      throw new TypeError('fetch failed');
    },
  });
  assert.equal(down.answered, 0);
  assert.deepEqual(down.findings, [
    { level: 'warn', message: 'nestjs/nest not checked: GitHub out of reach: fetch failed' },
  ]);
  const limited = await run({ [LIST]: [403, {}, { 'x-ratelimit-remaining': '0' }] });
  assert.equal(limited.findings[0].level, 'warn');
  const refused = await run({
    [LIST]: [403, { message: 'Resource not accessible by integration' }],
  });
  assert.equal(refused.findings[0], 'nestjs/nest not checked: nestjs/nest: GitHub answered 403');
  const missing = await run({});
  assert.equal(
    missing.findings[0],
    'nestjs/nest not checked: nestjs/nest: no such repository on GitHub (404)',
  );
});

test('text from GitHub is printed without control characters, so it cannot start a line of its own', async () => {
  const hostile = advisory(
    'GHSA-host-ile0-0000',
    'high',
    '@nestjs/common',
    '< 13.0.0\n::error::forged',
  );
  const { findings } = await run({
    [LIST]: [200, [hostile]],
    [`${API}/advisories/GHSA-host-ile0-0000`]: [404, {}],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].includes('\n'), false);
  assert.equal(printable('a\r\nb\u0007c\u009bd'), 'a  b c d');
});

test('an outage becomes an escaped annotation, and only a run of the file in CI writes one', () => {
  const lines = [];
  annotate(
    [
      { level: 'warn', message: 'nestjs/nest not checked: 100%\nhost down' },
      'an error is no annotation',
    ],
    (line) => lines.push(line),
  );
  assert.deepEqual(lines, [
    '::warning title=Repository advisories::nestjs/nest not checked: 100%25%0Ahost down\n',
  ]);
  // Imported here, as CI's test step imports it: never the entry point, so it never annotates.
  assert.equal(invokedInCi, false);
});

test('a hit names the locked version that sits in the range', () => {
  const deps = new Map([
    ['x', { versions: new Set(['1.0.0', '2.0.0']), importers: new Set(['.']) }],
  ]);
  const hits = advisoryHits(
    [advisory('GHSA-twoo-vers-0000', 'high', 'x', '< 1.5.0', { patched: '1.5.0' })],
    deps,
    ['x'],
    new Set(),
  );
  assert.deepEqual(
    hits.map((hit) => hit.version),
    ['1.0.0'],
  );
});

test('a listed version hit is a finding, printing the range that hit', async () => {
  const twoRanges = {
    ...advisory('GHSA-twoo-rang-0000', 'high', '@nestjs/common', '>= 13.0.0, < 13.1.0'),
    vulnerabilities: [
      { package: { name: '@nestjs/common' }, vulnerable_version_range: '>= 13.0.0, < 13.1.0' },
      {
        package: { name: '@nestjs/common' },
        vulnerable_version_range: '12.3.1, 12.3.2',
        patched_versions: '12.3.3',
      },
    ],
  };
  const { findings } = await run({
    [LIST]: [200, [twoRanges]],
    [`${API}/advisories/GHSA-twoo-rang-0000`]: [404, {}],
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /on @nestjs\/common@12\.3\.2, inside "12\.3\.1, 12\.3\.2"/u);
});

test('a connection lost while GitHub sends its answer is a warning, not a red (ruling 776)', async () => {
  const { findings, answered } = await run({
    [LIST]: () => ({
      status: 200,
      headers: new Headers(),
      text: () => Promise.reject(new TypeError('terminated')),
    }),
  });
  assert.equal(answered, 0);
  assert.deepEqual(findings, [
    { level: 'warn', message: 'nestjs/nest not checked: GitHub out of reach: terminated' },
  ]);
});

test('a redirect is followed only within api.github.com, and the pages are bounded', async () => {
  const moved = `${API}/repositories/1/security-advisories?state=published&per_page=100`;
  const renamed = await run({
    [LIST]: [301, {}, { location: moved }],
    [moved]: [200, [advisory('GHSA-move-d000-0000', 'high', '@nestjs/common', '< 13.0.0')]],
    [`${API}/advisories/GHSA-move-d000-0000`]: [404, {}],
  });
  assert.equal(renamed.findings.length, 1);
  const away = await run({ [LIST]: [302, {}, { location: 'https://example.test/x' }] });
  assert.match(away.findings[0], /refused to leave https:\/\/api\.github\.com/u);
  assert.equal(away.asked.includes('https://example.test/x'), false);
  const endless = await run({ [LIST]: [200, [], { link: `<${LIST}>; rel="next"` }] });
  assert.equal(
    endless.findings[0],
    'nestjs/nest not checked: nestjs/nest: more than 50 pages of advisories',
  );
  assert.equal(endless.asked.length, 50);
});

test('the old workflow command form is broken too, and a dot segment is no repository', () => {
  assert.equal(printable('range ##[error]forged'), 'range # #[error]forged');
  assert.equal(githubRepository('https://github.com/../orgs'), null);
  assert.equal(githubRepository('https://github.com/owner/..'), null);
});

test('a locked version no range can be compared with is an error', () => {
  const deps = new Map([
    ['alias', { versions: new Set(['real-name@1.0.0']), importers: new Set(['.']) }],
    ['plain', { versions: new Set(['1.0.0']), importers: new Set(['.']) }],
  ]);
  assert.deepEqual(uncheckableVersions(deps), [
    'alias: locked as "real-name@1.0.0", which no advisory range can be compared with',
  ]);
  // Reported there, and skipped by the advisory reading, which would throw on it.
  const fixed = advisory('GHSA-alia-s000-0000', 'high', 'alias', '< 2.0.0', { patched: '2.0.0' });
  assert.deepEqual(advisoryHits([fixed], deps, ['alias'], new Set()), []);
});
