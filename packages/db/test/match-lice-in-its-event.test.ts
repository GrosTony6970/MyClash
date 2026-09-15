/**
 * A Match is placed only on a Lice of its own Event (migration 0197).
 *
 * `matches` has no `event_id`, so the rule lives in a trigger that walks the
 * Match's phase to its Tournament and compares that Event with the Lice's. This
 * reads the migrations in order and asserts what the trigger compares, when it
 * fires, and that no later migration drops it. It cannot see the running
 * database; `pnpm db:migrations:replay` and a probe insert cover that.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');

const FUNCTION = 'match_lice_in_its_event';
const TRIGGER = 'matches_lice_in_its_event';

function allSql(): string {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8').replace(/--[^\n]*/g, ''))
    .join('\n');
}

/** The body of the last CREATE OR REPLACE of the function, between its dollar quotes. */
function functionBody(sql: string): string | null {
  const pattern = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${FUNCTION}\\s*\\(\\)[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$`,
    'gi',
  );
  const bodies = [...sql.matchAll(pattern)].map((hit) => hit[1] ?? '');
  return bodies.at(-1) ?? null;
}

describe('the trigger that keeps a Match on its own Event', () => {
  const sql = allSql();

  it("compares the Lice's Event with the Event of the Match's phase", () => {
    const body = functionBody(sql);
    expect(body, `no migration defines ${FUNCTION}()`).not.toBeNull();
    // The Lice, joined to the Tournament of the SAME Event, joined to the
    // Match's own phase. Drop either equality and another Event's Lice passes.
    expect(body).toMatch(/join\s+public\.tournaments\s+t\s+on\s+t\.event_id\s*=\s*l\.event_id/i);
    expect(body).toMatch(/join\s+public\.phases\s+p\s+on\s+p\.tournament_id\s*=\s*t\.id/i);
    expect(body).toMatch(/l\.id\s*=\s*new\.lice_id/i);
    expect(body).toMatch(/p\.id\s*=\s*new\.phase_id/i);
    expect(body).toMatch(/if\s+not\s+exists[\s\S]*raise\s+exception/i);
  });

  it('fires before every insert and every change of the Lice or the phase', () => {
    expect(sql).toMatch(
      new RegExp(
        `create\\s+trigger\\s+${TRIGGER}\\s+before\\s+insert\\s+or\\s+update\\s+of\\s+lice_id\\s*,\\s*phase_id\\s+on\\s+public\\.matches\\s+for\\s+each\\s+row\\s+when\\s*\\(\\s*new\\.lice_id\\s+is\\s+not\\s+null\\s*\\)\\s+execute\\s+function\\s+public\\.${FUNCTION}\\(\\)`,
        'i',
      ),
    );
  });

  it('is not dropped by a later migration', () => {
    // Each migration drops the trigger before re-creating it, so the last word
    // about it must be a CREATE.
    const create = new RegExp(`create\\s+trigger\\s+${TRIGGER}\\b`, 'gi');
    // `DROP FUNCTION … CASCADE` takes the trigger with it.
    const drop = new RegExp(
      `drop\\s+trigger\\s+(?:if\\s+exists\\s+)?${TRIGGER}\\b|drop\\s+function\\s+(?:if\\s+exists\\s+)?(?:public\\.)?${FUNCTION}\\s*\\(\\s*\\)\\s*cascade`,
      'gi',
    );
    const lastCreate = Math.max(-1, ...[...sql.matchAll(create)].map((hit) => hit.index));
    const lastDrop = Math.max(-1, ...[...sql.matchAll(drop)].map((hit) => hit.index));
    expect(lastCreate).toBeGreaterThan(lastDrop);
  });
});
