#!/usr/bin/env node
/**
 * Refuses a deploy whose account passwords GoTrue would refuse, before the build starts.
 *
 * The rule is GoTrue's own: `GOTRUE_PASSWORD_MIN_LENGTH` and `GOTRUE_PASSWORD_REQUIRED_CHARACTERS`
 * as the compose file gives them to GoTrue (check-infra-review pins that file to
 * `packages/types/src/password.ts`). GoTrue 2.198 applies it when an admin CREATES a user too
 * (2.195 did not), so a password that passed for months failed `422 weak_password` minutes into
 * the deploy, at the demo organisation.
 *
 * Usage: node scripts/check-deploy-passwords.mjs <compose file> NAME [NAME ...]
 * Each value is read from the environment by NAME, never from the arguments, which every user of
 * the host can read (ruling 425), and is never printed. An unset or empty NAME is skipped: the
 * step that uses it owns "missing".
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** GoTrue's password rule, read from a compose file's text. */
export function readGoTruePolicy(composeText) {
  const length = /GOTRUE_PASSWORD_MIN_LENGTH: (\d+)/u.exec(composeText);
  const required = /GOTRUE_PASSWORD_REQUIRED_CHARACTERS: '([^\n]*)'/u.exec(composeText);
  if (!length || !required) {
    throw new Error('The compose file sets no GOTRUE_PASSWORD_MIN_LENGTH or REQUIRED_CHARACTERS.');
  }
  // Compose turns `$$` into `$`, and a single-quoted YAML value doubles an inner `'`.
  const groups = required[1].replaceAll('$$', '$').replaceAll("''", "'").split(':');
  return { minLength: Number(length[1]), groups };
}

function groupName(group) {
  if (/^[a-z]+$/u.test(group)) return 'a lowercase letter (a-z)';
  if (/^[A-Z]+$/u.test(group)) return 'an uppercase letter (A-Z)';
  if (/^[0-9]+$/u.test(group)) return 'a digit (0-9)';
  return `a symbol, one of ${group}`;
}

/** What GoTrue would refuse in this password, in words; empty when it passes. */
export function passwordProblems(password, policy) {
  const problems = [];
  // GoTrue 2.198 counts the length in code points, as `validatePassword` does.
  const length = [...password].length;
  if (length < policy.minLength) {
    problems.push(`${length} characters, at least ${policy.minLength} needed`);
  }
  for (const group of policy.groups) {
    if (![...password].some((c) => group.includes(c))) problems.push(`missing ${groupName(group)}`);
  }
  return problems;
}

/** The lines to print, one per refused variable; empty when every set password passes. */
export function checkDeployPasswords(names, env, policy) {
  const lines = [];
  for (const name of names) {
    const value = env[name];
    if (!value) continue;
    const problems = passwordProblems(value, policy);
    if (problems.length > 0) lines.push(`${name}: ${problems.join('; ')}`);
  }
  return lines;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [composePath, ...names] = process.argv.slice(2);
  const policy = readGoTruePolicy(readFileSync(composePath, 'utf8'));
  const lines = checkDeployPasswords(names, process.env, policy);
  for (const line of lines) process.stderr.write(`${line}\n`);
  process.exit(lines.length > 0 ? 1 : 0);
}
