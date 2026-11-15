import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import semver from 'semver';

import { inRange, packageNamed } from './lib/advisory-range.mjs';
import { defineGate, isInvokedDirectly, nothingToCount } from './lib/gate.mjs';

/**
 * The security advisories our direct dependencies' own GitHub repositories publish, against the
 * versions the lockfile holds (operator rulings 776-777, 2026-11-15).
 *
 * `pnpm audit` reads GitHub's global advisory database. A project's own repository advisory
 * reaches that database only once GitHub reviews it, days later: Nest published nine on
 * 2026-11-12 and the audit stayed clean while the lockfile sat inside three high ones. This reads
 * `repos/<owner>/<repo>/security-advisories` for the repository of each direct dependency and
 * fails on a high or critical one that holds a locked version AND that the global database does
 * not list yet (once it does, `pnpm audit` owns it: some repository advisories carry open ranges
 * such as `>= 15, >= 16` that only the reviewed copy corrects).
 *
 * - Direct dependencies only, on every push (777). Their repository: the installed package's
 *   own `repository` field, github.com only.
 * - GitHub out of reach (a network error, a connection lost mid-answer, a timeout, a 5xx, a rate
 *   limit) is a warning and the gate passes (776), with an annotation in CI. So is a dependency
 *   whose package.json names no github.com repository: there is no feed to read. A repository
 *   GitHub does not know, a refused token, or a locked version no range can be compared with is
 *   an error: none of those mends itself.
 * - Doubt means report (ruling 806, scripts/lib/advisory-range.mjs): an advisory whose range its
 *   patched versions contradict, or that no rule reads, or that names one of our packages off its
 *   npm spelling (`withastro/astro`), is reported for a person to read, never passed.
 * - One ignore list with the audit: `auditConfig.ignoreGhsas` in pnpm-workspace.yaml.
 * - Text from GitHub or a package is printed without control characters or `##[`, so it cannot
 *   write a workflow command; a request, redirects followed by hand included, never leaves
 *   https://api.github.com, where the token goes.
 */

const API = 'https://api.github.com';
const FAILING = new Set(['high', 'critical']);
const TIMEOUT_MS = 10_000;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const MAX_PAGES = 50;
const MAX_REDIRECTS = 3;

/**
 * Text from outside, safe to print: no control character (so no line of its own, where `::` starts
 * a workflow command) and no `##[` (the old command form, which the runner reads anywhere).
 */
export function printable(text) {
  return String(text)
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/##\[/gu, '# #[');
}

/** The lockfile's dependency document (the last one; pnpm 12 writes its own version first). */
function dependencyDocument(lockText) {
  const documents = lockText.split(/^---$/mu).filter((part) => part.includes('importers:'));
  const last = documents.at(-1);
  if (!last) throw new Error('pnpm-lock.yaml holds no `importers:` block.');
  return last;
}

/**
 * Each external direct dependency: the versions it is locked at, and the workspaces that declare
 * it. `link:` (a workspace package) is skipped; a peer suffix `(…)` is cut.
 */
export function lockedDirectDependencies(lockText) {
  const lines = dependencyDocument(lockText).split(/\r?\n/u);
  const start = lines.indexOf('importers:');
  const deps = new Map();
  let importer = null;
  let name = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/u.test(line)) break;
    const importerKey = /^ {2}(\S[^:]*):$/u.exec(line);
    if (importerKey) importer = importerKey[1];
    const nameKey = /^ {6}'?([^':]+)'?:$/u.exec(line);
    if (nameKey) name = nameKey[1];
    const version = /^ {8}version: (\S+)$/u.exec(line);
    if (!version || !importer || !name || version[1].startsWith('link:')) continue;
    const entry = deps.get(name) ?? { versions: new Set(), importers: new Set() };
    entry.versions.add(version[1].replace(/\(.*$/u, ''));
    entry.importers.add(importer);
    deps.set(name, entry);
  }
  if (deps.size === 0) throw new Error('pnpm-lock.yaml lists no external direct dependency.');
  return deps;
}

/** The GHSA ids `auditConfig.ignoreGhsas` lists: `[]`, a flow list or a block list. */
export function ignoredAdvisories(workspaceText) {
  const at = workspaceText.search(/^auditConfig:$/mu);
  if (at === -1) throw new Error('pnpm-workspace.yaml has no `auditConfig:` block.');
  const rest = workspaceText.slice(at).split(/\r?\n/u).slice(1);
  const key = /^ {2}ignoreGhsas:(.*)$/u.exec(rest[0] ?? '');
  if (!key) throw new Error('`auditConfig:` does not start with `ignoreGhsas:`.');
  const inline = key[1].trim();
  if (inline.startsWith('[')) {
    const ids = inline.slice(1, -1).split(',');
    return new Set(ids.map((id) => id.trim().replace(/^['"]|['"]$/gu, '')).filter(Boolean));
  }
  if (inline) throw new Error(`\`ignoreGhsas:\` holds a shape this gate cannot read: ${inline}`);
  const ids = new Set();
  for (const line of rest.slice(1)) {
    const item = /^ {4}- (GHSA-[\w-]+)$/u.exec(line);
    if (!item) break;
    ids.add(item[1]);
  }
  return ids;
}

/** `owner/repo` from a package.json `repository`, or null when it is not on github.com. */
export function githubRepository(repository) {
  const url = typeof repository === 'string' ? repository : repository?.url;
  if (typeof url !== 'string') return null;
  const shorthand = /^github:([^/]+\/[^/#]+)$/u.exec(url) ?? /^([^/:@.]+\/[^/:@#]+)$/u.exec(url);
  const full = /^(?:git\+)?(?:https?|git|ssh):\/\/(?:git@)?github\.com[/:]([^/]+\/[^/#?]+)/u.exec(
    url,
  );
  const scp = /^git@github\.com:([^/]+\/[^/#]+)$/u.exec(url);
  const found = (shorthand ?? full ?? scp)?.[1]?.replace(/\.git$/u, '');
  const dotSegment = found?.split('/').some((segment) => /^\.{1,2}$/u.test(segment));
  return found && REPO.test(found) && !dotSegment ? found : null;
}

/** A GitHub answer that says GitHub is out of reach for now, not that something is wrong. */
export function isOutage(response) {
  if (response.status >= 500 || response.status === 429) return true;
  if (response.status !== 403) return false;
  const headers = response.headers;
  return (
    headers.get('x-ratelimit-remaining') === '0' ||
    headers.has('retry-after') ||
    /secondary rate limit/iu.test(response.text ?? '')
  );
}

class Outage extends Error {}

/** The answer to one request, its body read: a connection lost on the way is an outage too. */
async function fetchAnswer(url, { token, fetchImpl }) {
  try {
    const res = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, headers: res.headers, text: await res.text() };
  } catch (error) {
    throw new Outage(`GitHub out of reach: ${printable(error?.message ?? error)}`);
  }
}

/**
 * One GET on api.github.com: the status, headers, text and the next page's URL. A redirect is
 * followed by hand, and only within api.github.com (a renamed repository answers 301 to
 * /repositories/<id>/…), so no request, and no token, ever goes elsewhere.
 */
async function githubGet(url, client) {
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (new URL(target).origin !== API) {
      throw new Error(`refused to leave ${API}: ${printable(target)}`);
    }
    const answer = await fetchAnswer(target, client);
    const location = answer.headers.get('location');
    if (answer.status >= 300 && answer.status < 400 && location) {
      target = new URL(location, target).href;
      continue;
    }
    if (isOutage(answer)) {
      throw new Outage(`GitHub answered ${answer.status} (out of reach for now)`);
    }
    const next = /<([^>]+)>;\s*rel="next"/u.exec(answer.headers.get('link') ?? '');
    return { ...answer, next: next?.[1] ?? null };
  }
  throw new Error(`more than ${MAX_REDIRECTS} redirects from ${printable(url)}`);
}

/** Every published advisory of one repository, following GitHub's pages (at most 50). */
async function repositoryAdvisories(repo, client) {
  const advisories = [];
  let url = `${API}/repos/${repo}/security-advisories?state=published&per_page=100`;
  for (let pages = 0; url; pages += 1) {
    if (pages === MAX_PAGES) throw new Error(`${repo}: more than ${MAX_PAGES} pages of advisories`);
    const page = await githubGet(url, client);
    if (page.status === 404) throw new Error(`${repo}: no such repository on GitHub (404)`);
    if (page.status !== 200) throw new Error(`${repo}: GitHub answered ${page.status}`);
    advisories.push(...JSON.parse(page.text));
    url = page.next;
  }
  return advisories;
}

/**
 * Each high or critical advisory naming one of `names` at a locked version, or unreadable, once
 * per advisory, package and version, with the range that hit (Nest's list a package twice, one
 * range per major).
 */
export function advisoryHits(advisories, deps, names, ignored) {
  const hits = new Map();
  for (const advisory of advisories) {
    const failing = FAILING.has(String(advisory.severity).toLowerCase());
    if (!failing || advisory.withdrawn_at || ignored.has(advisory.ghsa_id)) continue;
    for (const vulnerability of advisory.vulnerabilities ?? []) {
      const written = vulnerability.package?.name;
      const name = packageNamed(written, names);
      if (!name) continue;
      const range = vulnerability.vulnerable_version_range;
      // Every entry of this advisory for this package speaks for the others' versions: Nest's and
      // vitest's list one range per major, and the fix on 3.x is what calls 3.2.6 fixed when the
      // 4.x entry is read.
      const allPatched = (advisory.vulnerabilities ?? [])
        .filter((other) => packageNamed(other.package?.name, names) === name)
        .map((other) => String(other.patched_versions ?? '').trim())
        .filter(Boolean)
        .join(', ');
      // A finding names this entry's own patched text, the one written beside its range.
      const patched = vulnerability.patched_versions;
      for (const version of deps.get(name).versions) {
        // A version no range can be compared with is reported by uncheckableVersions.
        if (!semver.valid(version)) continue;
        // A package named off its npm spelling is in doubt whatever its range says (ruling 806).
        const hit = written === name ? inRange(version, range, allPatched) : null;
        const key = `${advisory.ghsa_id}|${name}|${version}`;
        if (hit === false || hits.get(key)?.readable) continue;
        hits.set(key, { advisory, name, written, version, range, patched, readable: hit === true });
      }
    }
  }
  return [...hits.values()];
}

/** Whether GitHub's global database lists the advisory (then `pnpm audit` reports it). */
async function inGlobalDatabase(ghsaId, client) {
  const answer = await githubGet(`${API}/advisories/${encodeURIComponent(ghsaId)}`, client);
  if (answer.status === 200) return true;
  if (answer.status === 404) return false;
  throw new Error(`advisories/${printable(ghsaId)}: GitHub answered ${answer.status}`);
}

/** The finding for one hit the global database does not list yet. */
function hitFinding({ advisory, name, written, version, range: hitRange, patched, readable }) {
  const range = printable(hitRange);
  const what = `${printable(advisory.ghsa_id)} (${printable(advisory.severity)}) on ${name}@${version}`;
  const where = `published by the package's repository and not yet in GitHub's global database: ${printable(advisory.html_url)}`;
  if (readable) return `${what}, inside "${range}", ${where}`;
  const spelled = written === name ? '' : ` for a package written "${printable(written)}"`;
  const fix = String(patched ?? '').trim()
    ? `patched "${printable(patched)}"`
    : 'no patched version given';
  return `${what}: its range "${range}" (${fix})${spelled} leaves this version in doubt; read the advisory by hand. It is ${where}`;
}

/** A locked version no range can be compared with (an `npm:` alias, a tarball): an error. */
export function uncheckableVersions(deps) {
  const messages = [];
  for (const [name, { versions }] of deps) {
    for (const version of versions) {
      if (!semver.valid(version)) {
        messages.push(
          `${name}: locked as "${printable(version)}", which no advisory range can be compared with`,
        );
      }
    }
  }
  return messages;
}

/** Which repository each direct dependency comes from, read from its installed package.json. */
export function repositoriesOf(deps, root) {
  const repos = new Map();
  const errors = [];
  for (const [name, { importers }] of deps) {
    const manifest = [...importers]
      .map((importer) => join(root, importer, 'node_modules', name, 'package.json'))
      .find((path) => existsSync(path));
    if (!manifest) {
      errors.push(`${name}: not installed, so its repository is unknown (run pnpm install)`);
      continue;
    }
    const repo = githubRepository(JSON.parse(readFileSync(manifest, 'utf8')).repository);
    if (!repo) {
      // No GitHub feed to read, so nothing this check can see or mend: said, not failed.
      errors.push({
        level: 'warn',
        message: `${name}: its package.json names no github.com repository; not checked`,
      });
      continue;
    }
    repos.set(repo, [...(repos.get(repo) ?? []), name]);
  }
  return { repos, errors };
}

/**
 * Checks every repository. GitHub out of reach is a warning for that repository; any other
 * answer it cannot use (a 404, a refused token, a request that would leave api.github.com) is an
 * error for that repository, and the others are still checked.
 */
export async function repositoryAdvisoryFindings({ deps, repos, ignored, client }) {
  const findings = [];
  const listed = new Map();
  let answered = 0;
  for (const [repo, names] of repos) {
    try {
      const hits = advisoryHits(await repositoryAdvisories(repo, client), deps, names, ignored);
      for (const hit of hits) {
        const id = hit.advisory.ghsa_id;
        if (!listed.has(id)) listed.set(id, await inGlobalDatabase(id, client));
        if (!listed.get(id)) findings.push(hitFinding(hit));
      }
      answered += 1;
    } catch (error) {
      const message = `${repo} not checked: ${printable(error?.message ?? error)}`;
      findings.push(error instanceof Outage ? { level: 'warn', message } : message);
    }
  }
  return { findings, answered };
}

/** The token: GITHUB_TOKEN, GH_TOKEN, or the gh CLI's own; none means unauthenticated reads. */
function githubToken() {
  const fromEnv = process.env['GITHUB_TOKEN'] || process.env['GH_TOKEN'];
  if (fromEnv) return fromEnv;
  try {
    return execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Each warning as a CI annotation, escaped as GitHub's toolkit escapes data. The harness prints a
 * warning as `  ! …`, which the runner does not read as a command, so this line is the one the
 * run's summary shows (ruling 776: visible, never silent).
 */
export function annotate(findings, write = (line) => process.stdout.write(line)) {
  for (const finding of findings) {
    if (finding?.level !== 'warn') continue;
    const data = finding.message
      .replace(/%/gu, '%25')
      .replace(/\r/gu, '%0D')
      .replace(/\n/gu, '%0A');
    write(`::warning title=Repository advisories::${data}\n`);
  }
}

/** Only a run of this file in CI annotates: a test imports it, and CI runs the tests too. */
export const invokedInCi =
  isInvokedDirectly(import.meta.url) && process.env['GITHUB_ACTIONS'] === 'true';

export const gate = defineGate({
  name: 'Repository advisories',
  entry: import.meta.url,
  run: async ({ argv }) => {
    const root = process.cwd();
    const lockPath = argv[argv.indexOf('--lockfile') + 1] ?? '';
    const lockText = readFileSync(
      argv.includes('--lockfile') ? lockPath : join(root, 'pnpm-lock.yaml'),
      'utf8',
    );
    const deps = lockedDirectDependencies(lockText);
    const ignored = ignoredAdvisories(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'));
    const { repos, errors } = repositoriesOf(deps, root);
    const client = { token: githubToken(), fetchImpl: fetch };
    const checked = await repositoryAdvisoryFindings({ deps, repos, ignored, client });
    const answered = checked.answered;
    const findings = [...uncheckableVersions(deps), ...errors, ...checked.findings];
    if (invokedInCi) annotate(findings);
    return {
      findings,
      // Every repository out of reach is a warning, not a broken gate (ruling 776).
      scanned: answered || nothingToCount('GitHub answered for no repository; each is named above'),
      summary: `${answered} repositories of ${deps.size} direct dependencies publish no high or critical advisory on a locked version that GitHub's global database does not list yet.`,
      remedy:
        'Bump the dependency past the advisory (the newest release past the one-day gate,\n' +
        'ruling 773). An advisory that cannot apply here goes in auditConfig.ignoreGhsas in\n' +
        'pnpm-workspace.yaml with its reason, the list pnpm audit reads too.',
    };
  },
});
