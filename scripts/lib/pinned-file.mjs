import { readFile, readdir } from 'node:fs/promises';

import { toRepoPath } from './repo-scan.mjs';

/**
 * Reading files a gate PINS BY PATH, without dying when one is renamed.
 *
 * ── The failure this closes ─────────────────────────────────────────────────
 * A gate that asserts things about named files has to open them, and the naive
 * spelling is `await readFile(pinnedPath, 'utf8')`. That is fine right up until
 * somebody renames the file — at which point the gate does not report a
 * violation, it throws an unhandled ENOENT from inside node:internal and prints
 * a stack trace. check-infra-review.mjs pins 77 paths this way, 62% of them
 * inside `apps/`, so a rename is the most likely change it will ever see and
 * was the one it handled worst: no finding, no other findings either, just a
 * crash that says nothing about what moved.
 *
 * ── Why a sentinel and not null ─────────────────────────────────────────────
 * A missing file has to keep the REST of the gate running — the whole point of
 * accumulating errors instead of exiting at the first one. Returning `null`
 * would move the crash rather than remove it: every `text.includes(...)` and
 * `/re/.test(text)` call site would throw a TypeError instead, and there are
 * dozens of them.
 *
 * So a missing read yields a sentinel STRING. It is safe to `.includes()`,
 * `.match()`, `.slice()` and `.split()` — every one of which reports "not
 * found", which is the honest answer about a file that is not there. Assertion
 * helpers call `isMissingPinnedFile()` to skip instead, so a renamed file
 * produces ONE finding naming the path rather than one per fact it owned.
 *
 * The sentinel is wrapped in NUL, built with fromCharCode rather than written
 * as a literal: it must not collide with anything a caller might legitimately
 * search for in real source, and a raw NUL in the source would make this module
 * a binary file to git and to the formatter.
 */
const NUL = String.fromCharCode(0);
export const MISSING_PINNED_FILE = `${NUL}myclash:missing-pinned-file${NUL}`;

/** True when `text` came from a pinned path that does not exist. */
export function isMissingPinnedFile(text) {
  return text === MISSING_PINNED_FILE;
}

/**
 * "Absent" in the sense a gate cares about — the path does not resolve to the
 * kind of thing the caller asked for.
 *
 * EISDIR is in the list on purpose. Compose creates a DIRECTORY at a bind
 * source whose file is missing, which is exactly how the deploy manifest mount
 * failed silently for as long as it did; a gate that reads that path should say
 * "not a file", not crash. Anything else (EACCES, EMFILE, a real I/O fault) is
 * rethrown — those are not facts about the repo and must not be swallowed.
 */
function isAbsent(error) {
  return error?.code === 'ENOENT' || error?.code === 'EISDIR' || error?.code === 'ENOTDIR';
}

/**
 * A reader that records the pinned paths it could not open.
 *
 * The caller turns `missing` into its own violations, so the message and the
 * exit behaviour stay the gate's decision — this module only refuses to throw.
 */
export function createPinnedReader(root = process.cwd()) {
  const missing = [];

  return {
    /** Repo-relative paths, in the order they were read. */
    missing,

    /** File text, or MISSING_PINNED_FILE. */
    async readPinnedFile(absolutePath) {
      try {
        return await readFile(absolutePath, 'utf8');
      } catch (error) {
        if (!isAbsent(error)) throw error;
        missing.push(toRepoPath(absolutePath, root));
        return MISSING_PINNED_FILE;
      }
    },

    /** Directory entries, or an empty list. */
    async readPinnedDir(absolutePath) {
      try {
        return await readdir(absolutePath);
      } catch (error) {
        if (!isAbsent(error)) throw error;
        missing.push(toRepoPath(absolutePath, root));
        return [];
      }
    },
  };
}
