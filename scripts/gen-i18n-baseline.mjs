#!/usr/bin/env node
/**
 * Regenerate eslint-rules/i18n-baseline.json from the CURRENT
 * `myclash/no-literal-string` violations across the three web apps.
 *
 * The baseline grandfathers existing hardcoded-string debt (tracked, visible,
 * burn-down-able) while the rule blocks NEW violations. Re-run after
 * extending the rule or after translating a file (entries disappear as debt
 * is paid):
 *
 *   node scripts/gen-i18n-baseline.mjs
 *
 * NOTE: line:col entries drift when files are edited above a baselined
 * literal — lint failures after unrelated edits usually mean "refresh the
 * shifted entries", which this script does wholesale.
 */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APPS = ['apps/web-admin', 'apps/web-public', 'apps/web-scoring'];
const RULE_ID = 'myclash/no-literal-string';

const messageIdFor = (message) => {
  if (message.includes('prop text')) return 'literalProp';
  if (message.includes('toast/confirm')) return 'literalCall';
  return 'literalText';
};

const BASELINE_URL = new URL('../eslint-rules/i18n-baseline.json', import.meta.url);

// Empty the baseline first — otherwise currently-baselined violations are
// suppressed by the rule and would silently vanish from the regenerated file.
writeFileSync(BASELINE_URL, '{}\n');

const baseline = {};

for (const app of APPS) {
  let raw = '';
  try {
    raw = execSync('pnpm exec eslint app src --no-cache --format json', {
      cwd: resolve(app),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // eslint exits 1 when there are errors — the JSON is still on stdout.
    raw = err.stdout?.toString() ?? '';
  }
  const jsonStart = raw.indexOf('[');
  if (jsonStart < 0) {
    console.error(`No eslint JSON output for ${app}`);
    process.exit(1);
  }
  const results = JSON.parse(raw.slice(jsonStart));
  for (const file of results) {
    const rel = file.filePath
      .replace(/\\/g, '/')
      .replace(/^.*\/(apps\/[^/]+\/)/, '$1');
    for (const message of file.messages) {
      if (message.ruleId !== RULE_ID) continue;
      const entry = `${message.line}:${message.column}:${messageIdFor(message.message)}`;
      (baseline[rel] ??= []).push(entry);
    }
  }
}

const sorted = Object.fromEntries(
  Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b)),
);
writeFileSync(BASELINE_URL, `${JSON.stringify(sorted, null, 2)}\n`);
const total = Object.values(sorted).reduce((n, list) => n + list.length, 0);
console.log(`Baseline written: ${Object.keys(sorted).length} files, ${total} entries.`);
