/**
 * Every file that reads a side of a Match is listed, with a verdict.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * A side of a Match is a Registration or a Team (0282). Code written before
 * teams reads a side through the Registration columns only, and a team bout
 * leaves those null. Slice 1a moved the scoring engine to one key per side
 * (`sideKey`); the readers that remain are many and spread over every app. This
 * gate lists each of them in `scripts/side-readers-ledger.json`, so the slices
 * that follow (1b, 1c, 2) cannot forget one:
 *
 *   side-key         visited; compares or builds sides through `sideKey`
 *   individual-only  visited; team Matches are out on purpose, with the reason
 *   no-side-read     names a side link and reads no side (a key-name list, a
 *                    migration that only declares columns)
 *   not-yet          not visited; its `why` opens with its slice (`1b:` …)
 *
 * A visited line pins the number of hits in its file: a new read in a file
 * judged done is a finding until somebody reads the file again. A `not-yet`
 * line pins no count — the file is read whole in its slice — and the set of
 * `not-yet` lines may only shrink (the ratchet in the test pins the list).
 *
 * ── What counts as a hit ────────────────────────────────────────────────────
 * The side tokens, inside a word but never after a letter or a digit:
 * `matches_red_registration_id_fkey` is how live-state.service.ts reads both
 * sides through an embed, while `orderedRegistrationIds` (a waiting list) is
 * not `redRegistrationId`. Plus a bare `registration_id` / `registrationId` in
 * a file that also names a side table, a penalty or a protest: a card, a
 * protest, a forfeit and a Pool member each name their side by Registration.
 *
 * Limits, known:
 * - A helper that reads `registration_id` from a card or Pool row without
 *   naming the table, a penalty or a protest is not counted. Pool entrant keys
 *   in display code (`StandingsTab`, `PoolsCompositionView` …) are caught only
 *   where such a word appears; the rename of the entrant key's type in 1b is
 *   their guard.
 * - A read through a view's name columns (`vw_tournament_query_matches`
 *   `red_name`, `blue_name`) holds no token. Such a file is listed by hand
 *   (`"byHand": true`, hits 0) when a slice finds it.
 * - The raw-assignment rule below scans `.ts` / `.tsx` under `apps/` only. A
 *   raw mapper in a `packages/` file (`packages/types/src/match-winner.ts`,
 *   `packages/ui/src/utils/*`, `packages/rules/src/formula/derive-stats.ts`) is
 *   caught only through its ledger line.
 *
 * ── Raw side ids ────────────────────────────────────────────────────────────
 * In `.ts` / `.tsx` under `apps/`, a value put into `redSideId`, `blueSideId`
 * or `winnerSideId` (`x: value` or `x = value`) must come from `sideKey(` or
 * another side id. Every `sideKey(…)` call is cut from the value first, and
 * any Registration name left over is a finding: a fallback such as
 * `?? row.red_registration_id` compiles and gives a team a score of zero. So
 * is a fallback to `''` (`sideKey(…) ?? ''`): two sides not known yet would
 * then compare equal. A
 * side id is never written into `winner_registration_id` either
 * (`winnerColumns` owns that write). A file may be excused by a
 * `rawSideAssignments` line with the exact count and a reason.
 *
 * ── The file list ───────────────────────────────────────────────────────────
 * `git ls-files --cached --others --exclude-standard --deduplicate`: tracked
 * files plus new files git does not ignore, so a new reader is seen before it
 * is staged. Not a walk of the disk: a walk counts the ignored
 * `apps/*\/next-env.d.ts` a Next build leaves, and `scanned` then differs by
 * machine. In a shared checkout `--others` also sees other sessions' untracked
 * files, so a red may name a file this session did not write.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import { defineGate } from './lib/gate.mjs';

const LEDGER_PATH = 'scripts/side-readers-ledger.json';
const OWN_FILES = new Set(['scripts/check-side-readers.mjs']);

export const SIDE_TOKENS = [
  'red_registration_id',
  'blue_registration_id',
  'winner_registration_id',
  'registration_a_id',
  'registration_b_id',
  'forfeiting_registration_id',
  'redRegistrationId',
  'blueRegistrationId',
  'winnerRegistrationId',
  'registrationAId',
  'registrationBId',
  'forfeitingRegistrationId',
  'redRegId',
  'blueRegId',
];

// `_` may come before a token (a foreign-key name); a letter or a digit may not.
const TOKENS = `(?<![A-Za-z0-9])(?:${SIDE_TOKENS.join('|')})`;
const TOKEN_HITS = new RegExp(TOKENS, 'g');
const BARE = /\b(?:registration_id|registrationId)\b/g;
const BARE_CONTEXT = /pool_members|match_penalties|match_forfeits|match_protests|penalt|protest/i;
// A Registration named in a value put into a side id: a side token, or any Registration id.
const REGISTRATION_IN_VALUE = new RegExp(`${TOKENS}|registration_?id`, 'i');
const VERDICTS = new Set(['side-key', 'individual-only', 'no-side-read', 'not-yet']);
const VISITED = new Set(['side-key', 'individual-only', 'no-side-read']);
const SLICE = /^(1b|1c|2):/;

/** Whether the gate reads this path at all. */
function isScanned(path) {
  return (
    /^(apps|packages|scripts)\//.test(path) &&
    /\.(ts|tsx|mjs|sql)$/.test(path) &&
    !/\.(test|spec|fixtures)\./.test(path) &&
    !path.endsWith('.harness.ts') &&
    !path.includes('test-helpers') &&
    !path.includes('/testing/') &&
    !path.startsWith('packages/db/fixtures/') &&
    !path.startsWith('packages/api-client/src/generated/') &&
    !OWN_FILES.has(path)
  );
}

/** The number of side reads in one file. */
export function countSideHits(source) {
  let hits = (source.match(TOKEN_HITS) ?? []).length;
  // The case-insensitive context also matches the two table names spelled in it.
  if (BARE_CONTEXT.test(source)) hits += (source.match(BARE) ?? []).length;
  return hits;
}

// ── Raw side ids ─────────────────────────────────────────────────────────────

const OPEN = '([{';
const CLOSE = ')]}';
const IDENT = /[A-Za-z0-9_$]/;

/**
 * The value that starts at `from`, read across lines: up to the first `,` or
 * `;` or closing bracket at depth 0. A value the formatter wrapped (nothing
 * after the `:` or `=`) starts on the next line. `<…>` counts as a bracket
 * only right after a name, so a generic type (`Map<string, string>`) is one
 * value and a comparison is not a bracket.
 */
function valueAt(source, from) {
  let start = from;
  const lineEnd = source.indexOf('\n', from);
  if (lineEnd !== -1 && source.slice(from, lineEnd).trim() === '') start = lineEnd + 1;
  const open = [];
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (OPEN.includes(ch) || (ch === '<' && IDENT.test(source[i - 1]))) open.push(ch);
    else if (ch === '>' && open.at(-1) === '<' && source[i - 1] !== '=') open.pop();
    else if (CLOSE.includes(ch) && open.some((o) => o !== '<')) {
      while (open.pop() === '<');
    } else if (CLOSE.includes(ch) || (open.length === 0 && (ch === ',' || ch === ';'))) {
      return { text: source.slice(start, i), end: i };
    }
  }
  return { text: source.slice(start), end: source.length };
}

/** The value with every balanced `sideKey(…)` call cut out. */
function withoutSideKeyCalls(value) {
  let rest = value;
  for (let at = rest.indexOf('sideKey('); at !== -1; at = rest.indexOf('sideKey(')) {
    let depth = 0;
    let end = at + 'sideKey'.length;
    for (; end < rest.length; end += 1) {
      if (rest[end] === '(') depth += 1;
      else if (rest[end] === ')' && --depth === 0) break;
    }
    rest = rest.slice(0, at) + rest.slice(end + 1);
  }
  return rest;
}

/** A raw value: a Registration left once `sideKey` is cut, or a value with no side id at all. */
function isRawValue(value) {
  const rest = withoutSideKeyCalls(value);
  if (REGISTRATION_IN_VALUE.test(rest)) return true;
  if (value.includes('sideKey(') || rest.includes('SideId')) return false;
  return !/^\s*(?:null|undefined)\s*$/.test(value);
}

const TYPE_PART = /^(?:string|number|boolean|null|undefined|[A-Z][\w.]*(?:<.*>)?(?:\[\])?)$/;
const isType = (text) => text.split('|').every((part) => TYPE_PART.test(part.trim()));
/** The first `=` that assigns: not `==`, `===`, `!=`, `<=`, `>=` or `=>`. */
const assignIndex = (text) => text.search(/(?<![=!<>])=(?![=>])/);

/** A `x: value` member: a type (`string | null`), a type with its first value, or a value. */
function isRawMember(value) {
  const eq = assignIndex(value);
  const head = eq === -1 ? value : value.slice(0, eq);
  if (!isType(head)) return isRawValue(value);
  return eq !== -1 && isRawValue(value.slice(eq + 1));
}

/** `const { redSideId: red } = sides`: a side id copied out, not one put in. */
function isRenameOut(source, value) {
  if (!/^\s*[A-Za-z_$][\w$]*\s*$/.test(value.text)) return false;
  let depth = 0;
  for (let i = value.end; i < source.length; i += 1) {
    if (OPEN.includes(source[i])) depth += 1;
    else if (CLOSE.includes(source[i]) && depth-- === 0) {
      return source[i] === '}' && /^\s*=(?![=>])/.test(source.slice(i + 1));
    }
  }
  return false;
}

const INTO_SIDE = /\b(?:red|blue|winner)SideId(?:\??:|\s*=(?![=>]))/g;
const INTO_WINNER =
  /winner_registration_id['"]?:|\[['"]winner_registration_id['"]\]\s*(?::|=(?![=>]))|\.winner_registration_id\s*=(?![=>])/g;

const lineOf = (source, index) => source.slice(0, index).split('\n').length;
const textOfLine = (source, index) => source.split('\n')[lineOf(source, index) - 1].trim();
const isComment = (source, index) => /^(?:\/\/|\/\*|\*)/.test(textOfLine(source, index));

// `sideKey(…) ?? ''`: a side not known yet becomes '', and two such sides compare equal.
const EMPTY_FALLBACK = /(?:\?\?|\|\|)\s*(?:''|"")/;
const RAW = 'a raw value in a side id; build it with `sideKey`';
const EMPTY = "an empty side becomes ''; two empty sides would compare equal";

/** Why the value put into a side id is a finding, or null when it is not one. */
function rawIntoSide(source, match) {
  const value = valueAt(source, match.index + match[0].length);
  const member = match[0].endsWith(':');
  if (member && isRenameOut(source, value)) return null;
  if (EMPTY_FALLBACK.test(withoutSideKeyCalls(value.text))) return EMPTY;
  return (member ? isRawMember(value.text) : isRawValue(value.text)) ? RAW : null;
}

/** Raw values put into a side id, and side ids written into a Registration column. */
export function findRawSideAssignments(source, repoPath) {
  if (!/^apps\/.*\.tsx?$/.test(repoPath)) return [];
  const found = [];
  const at = (index, what) =>
    found.push({
      index,
      text: `${repoPath}:${lineOf(source, index)}: ${what} (${textOfLine(source, index)})`,
    });

  for (const m of source.matchAll(INTO_SIDE)) {
    const why = isComment(source, m.index) ? null : rawIntoSide(source, m);
    if (why) at(m.index, why);
  }
  for (const m of source.matchAll(INTO_WINNER)) {
    if (isComment(source, m.index)) continue;
    if (!valueAt(source, m.index + m[0].length).text.includes('SideId')) continue;
    at(m.index, 'a side id written into a Registration column; use `winnerColumns`');
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.text);
}

// ── The ledger ───────────────────────────────────────────────────────────────

function judgeReader(path, line, hits, findings) {
  if (!VERDICTS.has(line.verdict)) {
    findings.push(`${path}: unknown verdict "${line.verdict}" in ${LEDGER_PATH}`);
  }
  if (typeof line.why !== 'string' || !line.why.trim()) {
    findings.push(`${path}: the ledger line has no why`);
  } else if (line.verdict === 'not-yet' && !SLICE.test(line.why)) {
    findings.push(`${path}: a not-yet line opens its why with its slice (1b:, 1c: or 2:)`);
  }
  if (hits === 0 && line.byHand !== true) {
    findings.push(`${path}: the file reads no side any more; delete this line`);
  } else if (VISITED.has(line.verdict) && line.hits !== hits) {
    findings.push(
      `${path}: the ledger says ${line.hits} side reads, the file has ${hits}; re-read this file, then update the count`,
    );
  }
}

function judgeRaw(path, excuse, raws, findings) {
  if (!excuse) {
    findings.push(...raws);
    return;
  }
  if (typeof excuse.why !== 'string' || !excuse.why.trim()) {
    findings.push(`${path}: the rawSideAssignments line has no why`);
  }
  if (raws.length === 0) {
    findings.push(`${path}: the file holds no raw side id any more; delete this line`);
  } else if (excuse.count !== raws.length) {
    findings.push(
      `${path}: rawSideAssignments excuses ${excuse.count}, the file holds ${raws.length}: ` +
        raws.join('; '),
    );
  }
}

/** The rule over a list of files and the ledger. */
export function judge(files, ledger) {
  const readers = ledger.readers ?? {};
  const rawLines = ledger.rawSideAssignments ?? {};
  const findings = [];
  const seen = new Set();

  for (const { path, source } of files) {
    if (!isScanned(path)) continue;
    seen.add(path);
    const hits = countSideHits(source);
    const line = readers[path];
    if (line) judgeReader(path, line, hits, findings);
    else if (hits > 0) {
      findings.push(`${path}: ${hits} side reads and no ledger line; read the file, then add one`);
    }
    const raws = findRawSideAssignments(source, path);
    if (raws.length > 0 || rawLines[path]) judgeRaw(path, rawLines[path], raws, findings);
  }
  for (const path of [...Object.keys(readers), ...Object.keys(rawLines)]) {
    if (!seen.has(path)) findings.push(`${path}: no such file is scanned; delete this line`);
  }
  return { findings, scanned: seen.size };
}

// ── The run ──────────────────────────────────────────────────────────────────

function listFiles() {
  return execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
    .split('\0')
    .filter((path) => path && isScanned(path) && existsSync(path));
}

function summaryOf(ledger, scanned) {
  const lines = Object.values(ledger.readers ?? {});
  const byVerdict = [...VERDICTS]
    .map((verdict) => `${lines.filter((l) => l.verdict === verdict).length} ${verdict}`)
    .join(', ');
  const raw = Object.values(ledger.rawSideAssignments ?? {}).reduce((n, l) => n + l.count, 0);
  return (
    `Match side readers: ${scanned} files scanned, ${lines.length} readers listed (${byVerdict}), ` +
    `${raw} raw side assignments excused.`
  );
}

export const gate = defineGate({
  name: 'Match side readers',
  entry: import.meta.url,
  run: () => {
    const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
    const files = listFiles().map((path) => ({ path, source: readFileSync(path, 'utf8') }));
    const { findings, scanned } = judge(files, ledger);
    return {
      findings,
      scanned,
      summary: summaryOf(ledger, scanned),
      remedy:
        `Each file that reads a side of a Match has a line in ${LEDGER_PATH}. Read the file, ` +
        'then give it a verdict: side-key, individual-only, no-side-read, or not-yet with its ' +
        'slice. A side id is built with `sideKey` and written with `winnerColumns`.',
    };
  },
});
