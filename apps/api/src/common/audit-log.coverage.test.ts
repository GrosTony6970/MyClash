import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Anti-rot guard for audit-log masking.
 *
 * `insertAuditLog` masks personal values on the way into `audit_log`. That only
 * holds while it is the ONLY writer — a service that goes back to
 * `.from('audit_log').insert(...)` silently reintroduces raw PII into a
 * governance record that outlives the account it describes, which is exactly
 * how three raw emails ended up in admin-users.service.
 *
 * Reads are fine and plentiful (the admin log viewer, merge audits, the erasure
 * scrubber): this only forbids INSERT.
 */

const SRC = path.resolve(__dirname, '..');

/** The helper itself is the one legitimate writer. */
const ALLOWED = new Set(['common/audit-log.ts']);

/**
 * Strip comments before matching. audit-payload-refs.ts documents this very
 * pattern in a maintenance note, and allowlisting that file would let a real
 * insert hide behind the exemption later.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('audit_log write coverage', () => {
  const files = walk(SRC);

  it('finds a meaningful number of source files (sanity check on the walker)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('every audit_log INSERT goes through insertAuditLog', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const rel = path.relative(SRC, file).replace(/\\/g, '/');
      if (ALLOWED.has(rel)) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      // `.from('audit_log')` followed by `.insert(` before the statement ends.
      // Matches across a line break, which is how archive.service spelled it.
      if (/from\(\s*'audit_log'\s*\)\s*(?:\r?\n\s*)?\.insert\(/.test(source)) {
        offenders.push(rel);
      }
    }

    expect(
      offenders.sort(),
      `These write to audit_log directly, bypassing the masking in ` +
        `common/audit-log#insertAuditLog. Personal values in the payload would ` +
        `be stored raw. Route them through insertAuditLog instead:\n` +
        offenders.map((f) => `  - ${f}`).join('\n'),
    ).toEqual([]);
  });
});
