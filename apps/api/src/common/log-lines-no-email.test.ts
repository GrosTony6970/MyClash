import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No log line writes a person's email address (ruling 867): the ops agent reads the API's and the
 * worker's logs, and the design says a logger that writes a person's field is fixed at the root.
 * A line names the address only through `maskEmail(…)` (`common/audit-log.ts`).
 *
 * This guard reads every logger call and refuses a `${…}` whose expression names an email without
 * masking it. It cannot see an address under another name (`to`, `normalized`): the unit tests
 * of those lines hold them (`mail.service.test.ts`, `auth.service` tests).
 */

const SRC = path.resolve(__dirname, '..');
const CALL = /\.(?:log|warn|error|debug|verbose|fatal)\(/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** The text from `open` (an opening bracket) to its matching close, both included. */
function balanced(source: string, open: number, left: string, right: string): string {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === left) depth += 1;
    else if (source[i] === right && --depth === 0) return source.slice(open, i + 1);
  }
  return source.slice(open);
}

/** Every logger call's argument text, with the line it starts on. */
export function loggerCalls(source: string): Array<{ line: number; text: string }> {
  const calls: Array<{ line: number; text: string }> = [];
  for (const match of source.matchAll(CALL)) {
    const open = match.index + match[0].length - 1;
    calls.push({
      line: source.slice(0, match.index).split('\n').length,
      text: balanced(source, open, '(', ')'),
    });
  }
  return calls;
}

/** Each `${…}` expression of a call that names an email and is not `maskEmail(…)`. */
export function unmaskedEmails(text: string): string[] {
  const found: string[] = [];
  let at = text.indexOf('${');
  while (at !== -1) {
    const expr = balanced(text, at + 1, '{', '}')
      .slice(1, -1)
      .trim();
    if (/email/i.test(expr) && !expr.startsWith('maskEmail(')) found.push(expr);
    at = text.indexOf('${', at + 2);
  }
  return found;
}

describe('log lines and email addresses', () => {
  it('finds an unmasked address in a sample call, and passes a masked one', () => {
    const sample = [
      'this.logger.warn(`deleted ${user.id} (${user.email})`);',
      'this.logger.log(`sent to ${maskEmail(ownerEmail)}`);',
    ].join('\n');
    const calls = loggerCalls(sample);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => unmaskedEmails(c.text))).toEqual([['user.email'], []]);
  });

  it('no logger call in the API writes an email unmasked', () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(500);
    const offenders = files.flatMap((file) =>
      loggerCalls(readFileSync(file, 'utf8')).flatMap(({ line, text }) =>
        unmaskedEmails(text).map(
          (expr) => `${path.relative(SRC, file).replace(/\\/g, '/')}:${line} ${expr}`,
        ),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
