/**
 * check-docs-drift.mjs — keeps the prose honest about facts the repo already owns.
 *
 * ── The failure this closes ─────────────────────────────────────────────────
 * Nothing in the chain compares prose against the repository. So the same three
 * facts kept rotting, and kept getting hand-swept:
 *
 *   - The pnpm prerequisite in README and CONTRIBUTING. A doc review fixed it
 *     from "pnpm 9+" to "pnpm 10.27+" on 2026-07-01. By 2026-08-19 engines
 *     required 11.20.0 and both docs still said 10.27. A contributor following
 *     either one installs a version `pnpm install` refuses.
 *   - The CI gate count. Commit 8be03b95 was titled "correct the CI gate count
 *     in CLAUDE.md and CONTRIBUTING.md". It drifted again, in three documents.
 *   - Paths. A sweep on 2026-08-19 found FIFTY backticked repo paths across the
 *     doc corpus that resolve to nothing — including `packages/db/src/schema/`,
 *     cited twice as the source of "full DDL" by a document whose own line 179
 *     said that directory had been deleted. There is no markdown link checker
 *     in this repo, so nothing had ever looked.
 *
 * A hand sweep buys about six weeks. This is the same shape as
 * check-design-drift.mjs: read the doc, read the thing it restates, compare.
 *
 * ── Why `scanned` counts comparisons and not files ──────────────────────────
 * The corpus is a fixed handful of files, so a file count would be near-constant
 * and prove nothing. What can silently shrink is the number of CLAIMS matched —
 * reword a sentence and its assertion stops firing while the gate still reports
 * a clean run over the same files. So `scanned` is the number of comparisons
 * actually made, and each assertion additionally refuses to find zero of its own
 * claims: a corpus with no version line and no gate-count sentence is a corpus
 * whose patterns have rotted, not one that is clean.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { defineGate } from './lib/gate.mjs';

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), 'utf8');
const exists = (p) => existsSync(join(root, p));

/**
 * The documents this gate reads. Deliberately NOT the whole tree:
 * `docs/superpowers/` is an archive of shipped plans whose paths are historical
 * by design, and `.agents/` is vendored third-party material.
 *
 * ── The one file from `.claude/` ────────────────────────────────────────────
 * `myclash-gates/SKILL.md` is the verification chain a human actually runs, and
 * it restates the same gate count derived from ci.yml below. It is named here
 * rather than reached by a scan because `.claude/` is in REPO_IGNORED_DIRS, so
 * nothing walks it — and that is exactly how the file sat stale by one gate
 * until 2026-08-19 with every gate green. A count nobody checks is a count that
 * drifts. The rest of `.claude/skills/` stays out: it is vendored or
 * third-party, and only this file restates a number this gate can derive.
 */
export function docCorpus() {
  const files = [
    'README.md',
    'CONTRIBUTING.md',
    'CLAUDE.md',
    'myclash.md',
    'DESIGN.md',
    '.claude/skills/myclash-gates/SKILL.md',
  ];
  for (const dir of ['docs', 'docs/design', 'docs/decisions']) {
    if (!exists(dir)) continue;
    for (const name of readdirSync(join(root, dir))) {
      if (name.endsWith('.md')) files.push(`${dir}/${name}`);
    }
  }
  return files.filter(exists).sort();
}

// ── Number words ─────────────────────────────────────────────────────────────
// The prose spells counts out, because "twenty-five further steps" reads better
// than "25 further steps". Both forms are accepted so a doc may use either.
const UNITS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };

/** Parse "25", "twenty-five" or "twenty" to a number; null when unparseable. */
export function parseCount(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  if (s in UNITS) return UNITS[s];
  if (s in TENS) return TENS[s];
  const m = /^([a-z]+)[-\s]([a-z]+)$/.exec(s);
  if (m && m[1] in TENS && m[2] in UNITS && UNITS[m[2]] < 10) return TENS[m[1]] + UNITS[m[2]];
  return null;
}

// ── 1. Toolchain versions ────────────────────────────────────────────────────

/** The versions the repo actually requires, from the files that enforce them. */
export function requiredVersions(manifestJson, nvmrc) {
  const manifest = JSON.parse(manifestJson);
  const engines = manifest.engines ?? {};
  const clean = (v) => (typeof v === 'string' ? v.replace(/^[^\d]*/, '').trim() : null);
  return {
    node: clean(engines.node) ?? String(nvmrc ?? '').trim(),
    pnpm: clean(engines.pnpm),
  };
}

/** `Node 26+, pnpm 11.20+` — the prerequisite line every setup doc carries. */
const PREREQ = /Node\s+(\d+)\+,\s*pnpm\s+([\d.]+)\+/g;

export function checkVersions(docs, required) {
  const findings = [];
  let compared = 0;
  const wantNode = Number(String(required.node).split('.')[0]);
  const wantPnpm = required.pnpm;

  for (const { path, text } of docs) {
    for (const m of text.matchAll(PREREQ)) {
      compared += 1;
      const [, node, pnpm] = m;
      if (Number(node) !== wantNode) {
        findings.push({
          message: `${path}: prerequisite says Node ${node}+, package.json engines requires ${wantNode}`,
        });
      }
      // A doc may quote a shorter prefix (11.20 for 11.20.0) but must not name a
      // version the engines field would reject.
      if (wantPnpm && !wantPnpm.startsWith(pnpm) && !pnpm.startsWith(wantPnpm)) {
        findings.push({
          message: `${path}: prerequisite says pnpm ${pnpm}+, package.json engines requires ${wantPnpm} — following the doc installs a version pnpm refuses`,
        });
      }
    }
  }
  return { findings, compared };
}

// ── 2. The CI gate count ─────────────────────────────────────────────────────

/**
 * Count the Lint job's steps after `Lint all workspaces`, split into builds and
 * gates. Derived from the workflow so the number cannot be typed by hand.
 */
export function countLintSteps(ciYaml) {
  const job = ciYaml.slice(ciYaml.indexOf('\n  lint:'));
  // The NEXT top-level job key: `\n  test:` at exactly two spaces with nothing
  // else on the line. A nested key sits at four or more; a comment starts `#`.
  // Searched from index 1, or it matches the `\n  lint:` this slice opens with —
  // which silently returns the whole rest of the workflow and inflates the count.
  const next = job.slice(1).search(/\n {2}[a-z][a-z0-9_-]*:[ \t]*\n/);
  const body = next > 0 ? job.slice(0, next + 1) : job;

  const steps = [];
  let current = null;
  for (const line of body.split('\n')) {
    const name = /^\s+- name:\s*(.+)$/.exec(line);
    if (name) {
      current = { name: name[1].trim(), run: null };
      steps.push(current);
      continue;
    }
    const run = /^\s+run:\s*(.+)$/.exec(line);
    if (run && current && current.run === null) current.run = run[1].trim();
  }

  const withRun = steps.filter((s) => s.run);
  const lintIndex = withRun.findIndex((s) => /^Lint all workspaces$/i.test(s.name));
  const after = lintIndex === -1 ? withRun : withRun.slice(lintIndex + 1);
  // A build is identified by its step NAME, not its command. Grepping the run
  // line for `build` also catches `pnpm perf:bundle -- --require-build`, which
  // is the bundle-budget GATE, and silently moves it to the wrong side.
  const builds = after.filter((s) => /^Build\b/i.test(s.name));
  return { total: after.length, builds: builds.length, gates: after.length - builds.length };
}

const TOTAL_CLAIM = /([\w-]+)\s+further\s+steps/gi;
const SPLIT_CLAIM = /([\w-]+)\s+further\s+(?:independent\s+)?gates?\s+and\s+([\w-]+)\s+builds?/gi;
const SPLIT_DASH =
  /([\w-]+)\s+further\s+steps\s+—\s+([\w-]+)\s+gates?\s+and\s+([\w-]+)\s+builds?/gi;

export function checkGateCount(docs, actual) {
  const findings = [];
  let compared = 0;

  const claim = (path, label, said, want) => {
    compared += 1;
    const n = parseCount(said);
    if (n === null) {
      findings.push({
        message: `${path}: cannot read "${said}" as a number in the ${label} claim`,
      });
      return;
    }
    if (n !== want) {
      findings.push({
        message: `${path}: says ${said} ${label}, .github/workflows/ci.yml has ${want}`,
      });
    }
  };

  for (const { path, text } of docs) {
    for (const m of text.matchAll(SPLIT_DASH)) {
      claim(path, 'further steps', m[1], actual.total);
      claim(path, 'gates', m[2], actual.gates);
      claim(path, 'builds', m[3], actual.builds);
    }
    const dashed = new Set([...text.matchAll(SPLIT_DASH)].map((m) => m[0]));
    for (const m of text.matchAll(TOTAL_CLAIM)) {
      if ([...dashed].some((d) => d.includes(m[0]))) continue;
      claim(path, 'further steps', m[1], actual.total);
    }
    for (const m of text.matchAll(SPLIT_CLAIM)) {
      claim(path, 'gates', m[1], actual.gates);
      claim(path, 'builds', m[2], actual.builds);
    }
  }
  return { findings, compared };
}

// ── 3. The E2E spec range ────────────────────────────────────────────────────

const RANGE_CLAIM = /Specs are numbered\s+`?(\d+)`?…`?(\d+)`?/g;

export function checkSpecRange(readmeText, specNumbers) {
  const findings = [];
  let compared = 0;
  if (specNumbers.length === 0) return { findings, compared };

  const lo = specNumbers[0];
  const hi = specNumbers[specNumbers.length - 1];
  for (const m of readmeText.matchAll(RANGE_CLAIM)) {
    compared += 1;
    if (Number(m[1]) !== lo || Number(m[2]) !== hi) {
      findings.push({
        message: `tests/e2e/README.md: says specs are numbered ${m[1]}…${m[2]}, tests/e2e holds ${String(lo).padStart(2, '0')}…${String(hi).padStart(2, '0')}`,
      });
    }
  }
  return { findings, compared };
}

// ── 4. Dangling paths ────────────────────────────────────────────────────────

/**
 * Paths that are correctly absent. Every entry needs a reason, because the
 * whole point of this assertion is that an absent path is normally a bug.
 *
 * Three classes recur, and all three are legitimate:
 *   - prose that describes something DELETED, in the past tense
 *   - template placeholders
 *   - elided paths written for a human to read
 */
export const ALLOWED_ABSENT = new Map([
  ['docs/decisions/ADR-NNN.md', 'template placeholder in the ADR README'],
  ['infra/supabase/kong.yml', 'past tense: records that Kong was removed from the dev compose'],
  ['packages/design-tokens', 'past tense: records the dead token package that was deleted'],
  ['packages/design-tokens/', 'past tense: DESIGN.md records the same deleted package'],
  ['packages/db/src/client.ts', 'past tense: records a factory with zero callers, deleted 2026-08'],
  ['docs/prototype/', 'past tense: records a directory the design language wrongly pointed at'],
  [
    'apps/web-public/scripts/landing-bundle-budget.mjs',
    'past tense: records the per-app budget script that was removed',
  ],
]);

/** A path written for a human rather than for a filesystem. */
export function isElided(p) {
  return p.includes('...') || p.includes('…') || /[<>{}*]/.test(p) || /\bNNN\b/.test(p);
}

const PATH_IN_BACKTICKS = /`((?:apps|packages|scripts|infra|docs|tests)\/[A-Za-z0-9_./[\]-]+)`/g;

export function checkPaths(docs, resolve) {
  const findings = [];
  let compared = 0;
  const seen = new Set();

  for (const { path, text } of docs) {
    for (const m of text.matchAll(PATH_IN_BACKTICKS)) {
      const target = m[1];
      if (isElided(target)) continue;
      const key = `${path}::${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      compared += 1;
      if (resolve(target)) continue;
      if (ALLOWED_ABSENT.has(target)) continue;
      findings.push({
        message: `${path}: cites \`${target}\`, which does not exist. Repoint it, or add it to ALLOWED_ABSENT with the reason it is correctly absent.`,
      });
    }
  }
  return { findings, compared };
}

// ── The gate ─────────────────────────────────────────────────────────────────

function specNumbersFrom(dir) {
  if (!exists(dir)) return [];
  return readdirSync(join(root, dir))
    .map((n) => /^(\d+)-.*\.spec\.ts$/.exec(n))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

export const gate = defineGate({
  name: 'Documentation drift',
  entry: import.meta.url,
  run: () => {
    const docs = docCorpus().map((path) => ({ path, text: read(path) }));

    const versions = checkVersions(
      docs,
      requiredVersions(read('package.json'), exists('.nvmrc') ? read('.nvmrc') : ''),
    );
    const gates = checkGateCount(docs, countLintSteps(read('.github/workflows/ci.yml')));
    const specs = exists('tests/e2e/README.md')
      ? checkSpecRange(read('tests/e2e/README.md'), specNumbersFrom('tests/e2e'))
      : { findings: [], compared: 0 };
    const paths = checkPaths(docs, exists);

    const findings = [
      ...versions.findings,
      ...gates.findings,
      ...specs.findings,
      ...paths.findings,
    ];

    // Each assertion must find its own claims. A pattern that stops matching is
    // indistinguishable from a clean corpus in the finding count alone.
    for (const [label, r] of [
      ['toolchain version', versions],
      ['CI gate count', gates],
      ['E2E spec range', specs],
      ['repository path', paths],
    ]) {
      if (r.compared === 0) {
        findings.push({
          message: `no ${label} claim matched anywhere in the corpus — the pattern has rotted, or the claim was reworded. This gate is not checking what it says it checks.`,
        });
      }
    }

    const compared = versions.compared + gates.compared + specs.compared + paths.compared;
    return {
      findings,
      scanned: compared,
      summary: `Docs match the repo: ${versions.compared} version, ${gates.compared} gate-count, ${specs.compared} spec-range and ${paths.compared} path assertions over ${docs.length} document(s) (${compared} comparisons).`,
      remedy:
        'Correct the prose, or correct the thing it describes. A count in prose is a cache of a lookup — prefer saying how to count.',
    };
  },
});
