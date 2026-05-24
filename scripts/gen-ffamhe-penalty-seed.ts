#!/usr/bin/env tsx
/**
 * scripts/gen-ffamhe-penalty-seed.ts
 *
 * One-shot generator for the inlined SQL seed of the FFAMHE built-in
 * penalty ruleset (migration 0054). Reads the canonical CSV at
 *
 *   packages/rulesets/src/penalties/data/ffamhe_tf_2026.csv
 *
 * and emits:
 *   1. The SHA-256 of the CSV — pasted into the parent INSERT row.
 *   2. The VALUES block for `penalty_ruleset_entries` — pasted under the
 *      "SELECT id, …, sort_order FROM penalty_rulesets …" block.
 *
 * Usage (from repo root):
 *   pnpm tsx scripts/gen-ffamhe-penalty-seed.ts
 *
 * The script is committed for reproducibility but is not part of the
 * runtime build — re-run it only if the CSV changes.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePenaltyRulesetCsv } from '../packages/rulesets/src/penalties';

const csvPath = join(__dirname, '..', 'packages/rulesets/src/penalties/data/ffamhe_tf_2026.csv');
const csv = readFileSync(csvPath, 'utf8');
const hash = createHash('sha256').update(csv).digest('hex');

const parsed = parsePenaltyRulesetCsv(csv, {
  code: 'ffamhe_tf_2026',
  version: '2026',
  name: 'Penalty - Tournois fédéraux FFAMHE',
  accumulationScope: 'match',
  builtIn: true,
});

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlSanctions(cards: readonly string[]): string {
  const json = JSON.stringify(cards);
  return `${sqlString(json)}::jsonb`;
}

const entriesBlock = parsed.entries
  .map(
    (e, idx) =>
      `  (r.id, ${e.groupNumber}, ${e.refNumber}, ${sqlString(e.shortName)}, ${sqlString(e.description)}, ${sqlSanctions(e.sanctions)}, ${idx + 1})`,
  )
  .join(',\n');

console.log(`-- CSV SHA-256: ${hash}`);
console.log(`-- Entries: ${parsed.entries.length}`);
console.log('');
console.log(`csv_source_sha256: ${hash}`);
console.log('');
console.log('-- VALUES block for penalty_ruleset_entries insert:');
console.log(entriesBlock);
