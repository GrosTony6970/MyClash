/**
 * Gate: no control character written as a RAW BYTE in source.
 *
 * ── The failure this closes ─────────────────────────────────────────────────
 * Five files held a control character as a raw byte instead of an escape
 * sequence. Four held a NUL, used as a separator in a composite key; one held
 * 0x03 0x04 inside a zip magic-number assertion whose own comment already
 * spelled them \x03\x04. Every use was sound. The encoding was the defect, and
 * it cost three things:
 *
 *   - Git decides "binary" by looking for a NUL, so the four NUL files produced
 *     NO DIFF AT ALL. `git show <sha> -- <path>` printed the commit message and
 *     nothing else; --numstat reported "-  -" where the line counts belong.
 *     Every change ever made to those files passed review unseen.
 *   - Ripgrep classifies them binary and SILENTLY SKIPS them while walking a
 *     directory. Two audits in this repo reasoned from sweeps that were missing
 *     a file and said so nowhere.
 *   - git grep degrades to "Binary file ... matches" — no line, no content.
 *
 * ── Why CI never caught it ──────────────────────────────────────────────────
 * Every existing gate walks with readdirSync and reads with readFileSync, so
 * none of them was ever the tool that skipped the files. The blind spot was in
 * the tooling humans and agents reach for first, which no gate models. This one
 * walks the same way and looks at the bytes.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * No byte below 0x20 and no 0x7F, except tab, LF and CR. CR is exempt on
 * purpose: .gitattributes gives *.ps1 / *.bat / *.cmd `eol=crlf`, so a CRLF
 * working tree is legitimate on Windows and must not fail this gate on a
 * developer's machine while passing in CI.
 *
 * A control character is still perfectly usable — as an escape. '\x00' compiles
 * to the same string a raw NUL does, and leaves the file readable to git, to
 * ripgrep, and to a reviewer.
 */
import { readFileSync } from 'node:fs';

import { defineGate } from './lib/gate.mjs';
import { toRepoPath, walkRepoFiles } from './lib/repo-scan.mjs';

const root = process.cwd();

/**
 * What counts as source text here — matched with `endsWith`, so whole filenames
 * sit in the same list as extensions and need no special case.
 *
 * ── Why an allowlist and not a list of binary types ─────────────────────────
 * walkRepoFiles returns roughly 2,800 files, of which about 120 are UNTRACKED
 * local artefacts: tool caches, agent session notes, spreadsheets a developer
 * happened to drop in the tree. Three of those hold control bytes today. A gate
 * that scanned everything except a known-binary list would be red on a
 * developer's machine and green in CI — the exact failure REPO_IGNORED_DIRS
 * exists to prevent, arrived at from the other direction.
 *
 * The cost of an allowlist is that a NEW source type could go unscanned in
 * silence. check-source-bytes.test.mjs closes that: it enumerates tracked files
 * and fails on any suffix classified by neither this list nor BINARY_SUFFIXES.
 * Loud where it is free, quiet where it would only be noise.
 */
export const SOURCE_SUFFIXES = [
  // Extensions, in the order the repo has most of them.
  '.ts',
  '.tsx',
  '.sql',
  '.mjs',
  '.md',
  '.json',
  '.sh',
  '.astro',
  '.yml',
  '.yaml',
  '.css',
  '.js',
  '.cjs',
  '.csv',
  '.txt',
  '.py',
  '.example',

  // Whole filenames. These carry no extension and are edited by hand like any
  // other source, so they are held to the same rule.
  'Dockerfile',
  'Caddyfile',
  'LICENSE',
  'VERSION',
  '.gitkeep',
  '.gitignore',
  '.gitattributes',
  '.dockerignore',
  '.editorconfig',
  '.nvmrc',
  '.prettierrc',
  '.prettierignore',
  '.shellcheckrc',
];

/**
 * Types whose bytes are not source. Taken from the `binary` block of
 * .gitattributes, so the two cannot disagree about what is an image.
 *
 * This list is not used to skip anything — absence from SOURCE_SUFFIXES already
 * does that. It exists so the classification test can tell "known binary" from
 * "nobody has decided yet", and only the second is a finding.
 */
export const BINARY_SUFFIXES = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.pdf',
  '.woff',
  '.woff2',
];

/** Tab, line feed, carriage return — the three that belong in a text file. */
const PERMITTED = new Set([0x09, 0x0a, 0x0d]);

export function isControlByte(byte) {
  return (byte < 0x20 && !PERMITTED.has(byte)) || byte === 0x7f;
}

/**
 * Every control byte in `buffer`, with where it sits.
 *
 * `column` counts BYTES from the start of the line, not characters: a line with
 * an accented word ahead of the offender reports a column past its visual
 * position. That is honest for the thing being located, which is a byte.
 */
export function findControlBytes(buffer) {
  const found = [];
  let line = 1;
  let column = 1;
  for (const byte of buffer) {
    if (byte === 0x0a) {
      line += 1;
      column = 1;
      continue;
    }
    if (isControlByte(byte)) found.push({ byte, line, column });
    column += 1;
  }
  return found;
}

const hex = (byte) => `0x${byte.toString(16).padStart(2, '0')}`;

/**
 * The rule over a list of paths, with the reader injected so the test can run
 * it without a filesystem.
 */
export function scanSources(paths, read = readFileSync, label = toRepoPath) {
  const violations = [];
  for (const path of paths) {
    for (const { byte, line, column } of findControlBytes(read(path))) {
      violations.push(
        `${label(path)}:${line}:${column}: ${hex(byte)} is written as a raw byte — write it as an escape sequence (\\x${byte.toString(16).padStart(2, '0')}) instead`,
      );
    }
  }
  return violations;
}

export const gate = defineGate({
  name: 'Raw control bytes in source',
  entry: import.meta.url,
  run: () => {
    const paths = walkRepoFiles(root, { extensions: SOURCE_SUFFIXES });
    return {
      findings: scanSources(paths),
      // "A scan over nothing passes, say which of the two it is" was written by
      // hand here first. The harness now requires it of every gate.
      scanned: paths.length,
      summary: `No raw control bytes in ${paths.length} source file(s).`,
      remedy:
        'A raw NUL makes git treat the file as BINARY: it produces no diff, so every\n' +
        'change to it passes review unseen. Ripgrep skips such a file silently while\n' +
        'walking a directory, and git grep reports only "Binary file ... matches".\n' +
        'The escape sequence compiles to exactly the same string.',
    };
  },
});
