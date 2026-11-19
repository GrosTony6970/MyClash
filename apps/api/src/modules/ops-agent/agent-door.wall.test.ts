/**
 * The wall around the ops agent's key (the ops agent's design, section 1).
 *
 * The key opens the agent-door routes and nothing else. That is held by structure, not by
 * calling 755 routes: one guard turns a key into a caller, one decorator puts that guard on a
 * route, and every other reader of the bearer sends it to the login check, which refuses a key.
 * Each test below fails if a second way in appears.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSources } from '../../common/testing/route-authz-scan';
import { verifyAccessTokenLocally } from '../supabase/supabase.service';

const SRC = join(__dirname, '..', '..').replace(/\\/g, '/');
const SOURCES = readSources(SRC);
const KEY = `mca_${'k'.repeat(43)}`;

/** Repo-relative paths (under `src/`) of the non-test files whose text matches `pattern`. */
function filesMatching(pattern: RegExp): string[] {
  return SOURCES.filter((s) => pattern.test(s.text))
    .map((s) => s.path.slice(SRC.length + 1))
    .sort();
}

describe('the wall around the ops agent key', () => {
  it('names AgentKeyGuard only in the guard, the door decorator and the module that provides it', () => {
    const allowed = [
      'modules/ops-agent/agent-door.decorator.ts',
      'modules/ops-agent/agent-key.guard.ts',
      'modules/ops-agent/ops-agent.module.ts',
    ];
    const found = filesMatching(/\bAgentKeyGuard\b/);
    expect(found.filter((f) => !allowed.includes(f))).toEqual([]);
    expect(found).toContain('modules/ops-agent/agent-door.decorator.ts');
  });

  it('hashes a key only in the guard', () => {
    expect(filesMatching(/\bhashAgentKey\(/)).toEqual([
      'modules/ops-agent/agent-key.guard.ts',
      'modules/ops-agent/agent-key.ts',
    ]);
  });

  it('reads the key table only in the guard and the console service', () => {
    const allowed = [
      'modules/ops-agent/agent-key.guard.ts',
      'modules/ops-agent/agent-keys.service.ts',
    ];
    const found = filesMatching(/from\(\s*['"]agent_keys['"]\s*\)/);
    expect(found.filter((f) => !allowed.includes(f))).toEqual([]);
    expect(found).toContain('modules/ops-agent/agent-key.guard.ts');
  });

  it('builds the door from @Public() and the guard, in one decorator', () => {
    const door = SOURCES.find((s) => s.path.endsWith('modules/ops-agent/agent-door.decorator.ts'));
    expect(door?.text).toMatch(/\bPublic\(\)/);
    expect(door?.text).toMatch(/UseGuards\(\s*AgentKeyGuard\s*\)/);
  });

  it('a key is no login: the local login check refuses it', () => {
    expect(verifyAccessTokenLocally(KEY, 'any-shared-secret-at-least-32-chars')).toBeNull();
  });
});
