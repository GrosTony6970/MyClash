import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// The build-time check of the scanner's dist (packages/ui/scripts/check-scan-subpath.mjs),
// run on a fake dist so each promise is seen going red on its own.
const SCRIPT = resolve(__dirname, '../../scripts/check-scan-subpath.mjs');
const made: string[] = [];

function run(decoder: string, index: string) {
  const cwd = mkdtempSync(join(tmpdir(), 'ui-dist-'));
  made.push(cwd);
  mkdirSync(join(cwd, 'dist', 'scan'), { recursive: true });
  writeFileSync(join(cwd, 'dist', 'scan', 'decoder.js'), decoder);
  writeFileSync(join(cwd, 'dist', 'index.js'), index);
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' });
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('check-scan-subpath', () => {
  it('passes a lazy decoder and a scanner-free barrel', () => {
    expect(run("cached ??= import('jsqr').then(f);", 'exports.Button = 1;').status).toBe(0);
  });

  it('names a decoder compiled to require as no longer lazy', () => {
    const result = run("const j = require('jsqr');", 'exports.Button = 1;');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no longer lazy');
  });

  it('names a root barrel that mentions the scanner', () => {
    const result = run("import('jsqr')", "require('./scan');");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('mentions the scanner');
  });
});
