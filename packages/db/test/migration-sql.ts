/**
 * Read the migrations as one text and find a statement in it, for the db tests that pin a function,
 * a trigger or a grant WHOLE (0224's, 0229's). Extracted from ruleset-pair-in-its-club.test.ts when
 * the second such test came.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(__dirname, '..', 'migrations');

/** Every migration in order, comments out and identifier quotes dropped. */
export function allSql(): string {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8').replace(/--[^\n]*/g, ''))
    .join('\n')
    .replaceAll('"', '');
}

export const flat = (text: string | null | undefined) =>
  (text ?? '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim().toLowerCase();

/** `create [or replace] function [public.]name(`, whatever the argument list. */
export const createOf = (name: string) =>
  `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${name}\\s*\\(`;

/** A function or procedure named `name`, in an ALTER, GRANT or DROP. */
export const routine = (name: string) =>
  `(?:function|routine|procedure)\\s+(?:public\\.)?${name}\\b`;

/** The last CREATE [OR REPLACE] of `name`, from its name to the closing dollar quotes. */
export function functionStatement(sql: string, name: string): string {
  const pattern = new RegExp(`${createOf(name)}[\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$`, 'gi');
  return flat([...sql.matchAll(pattern)].map((hit) => hit[0]).at(-1));
}

/** The last CREATE [OR REPLACE] TRIGGER statement for `name`, up to its semicolon. */
export function triggerStatement(sql: string, name: string): string {
  const pattern = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?trigger\\s+${name}\\b[\\s\\S]*?;`,
    'gi',
  );
  return flat([...sql.matchAll(pattern)].map((hit) => hit[0]).at(-1));
}

/** Every match of `pattern` in `sql`, flattened. */
export const matches = (sql: string, pattern: string) =>
  [...sql.matchAll(new RegExp(pattern, 'gi'))].map((hit) => ({
    at: hit.index,
    text: flat(hit[0]),
  }));

/** Index of the last match of `pattern` in `sql`, or -1. */
export const lastIndex = (sql: string, pattern: string) =>
  Math.max(-1, ...matches(sql, pattern).map((hit) => hit.at));
