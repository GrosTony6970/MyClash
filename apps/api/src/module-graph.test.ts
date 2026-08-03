import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard against NestJS module import CYCLES.
 *
 * A cycle between @Module()s is invisible to `tsc` (the type graph is fine) and
 * invisible to this test suite's DI — vitest runs through esbuild, which emits
 * no decorator metadata, so we cannot boot the real container here (see
 * modules/matches/di-wiring.regression.test.ts for the same constraint). A cycle
 * therefore only surfaces when the API boots, i.e. in production.
 *
 * Concrete near-miss this exists to prevent: PoolStandingsService needs
 * RulesetResolver so org-authored rulesets stop 400-ing on standings. The
 * obvious move — have PoolStandingsModule import MatchesModule — closes
 *
 *   PoolStandingsModule → MatchesModule → PhasesModule → PoolStandingsModule
 *
 * The fix was to extract RulesetResolverModule (a leaf) instead. This test locks
 * that in: reintroducing the shortcut fails here rather than at boot.
 *
 * Parsing is deliberately source-level and regex-based, mirroring the existing
 * di-wiring guard. Edges wrapped in forwardRef() are treated as intentional and
 * skipped — that is Nest's sanctioned escape hatch for a genuine cycle.
 */

function moduleFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      moduleFiles(full, found);
    } else if (entry.name.endsWith('.module.ts')) {
      found.push(full);
    }
  }
  return found;
}

/** Extract the balanced `[...]` that follows `imports:` inside the decorator. */
function importsBlock(src: string): string {
  const at = src.indexOf('imports:');
  if (at === -1) return '';
  const open = src.indexOf('[', at);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return '';
}

/** Strip comments so prose like "A → B → A" is never read as an edge. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Remove `forwardRef(...)` spans, counting parens so the `()` in `() => X`
 * doesn't terminate the match early. Those edges are deliberate cycles.
 */
function stripForwardRefs(src: string): string {
  let out = src;
  for (;;) {
    const at = out.indexOf('forwardRef');
    if (at === -1) return out;
    const open = out.indexOf('(', at);
    if (open === -1) return out;
    let depth = 0;
    let end = -1;
    for (let i = open; i < out.length; i++) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) return out;
    out = out.slice(0, at) + out.slice(end + 1);
  }
}

function buildGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const file of moduleFiles(__dirname)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const name = /export class (\w*Module)\b/.exec(src)?.[1];
    if (!name) continue;

    const scanned = stripForwardRefs(importsBlock(src));
    const edges = [...scanned.matchAll(/\b([A-Z]\w*Module)\b/g)]
      .map((m) => m[1] as string)
      .filter((edge) => edge !== name);
    graph.set(name, [...new Set(edges)]);
  }
  return graph;
}

/** First cycle found as a readable path, or null. */
function findCycle(graph: Map<string, string[]>): string[] | null {
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  function walk(node: string): string[] | null {
    if (state.get(node) === 'done') return null;
    if (state.get(node) === 'visiting') {
      return [...stack.slice(stack.indexOf(node)), node];
    }
    state.set(node, 'visiting');
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      // Only follow edges to modules defined in this app.
      if (!graph.has(next)) continue;
      const cycle = walk(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(node, 'done');
    return null;
  }

  for (const node of graph.keys()) {
    const cycle = walk(node);
    if (cycle) return cycle;
  }
  return null;
}

describe('NestJS module graph', () => {
  it('has no import cycles', () => {
    const graph = buildGraph();
    // Sanity: the parser actually found the graph.
    expect(graph.size).toBeGreaterThan(20);

    const cycle = findCycle(graph);
    expect(
      cycle,
      cycle
        ? `Module import cycle: ${cycle.join(' → ')}. Extract the shared provider ` +
            `into its own leaf module (see RulesetResolverModule) rather than importing ` +
            `the whole feature module, or use forwardRef() if the cycle is genuinely intended.`
        : undefined,
    ).toBeNull();
  });

  it('PoolStandingsModule reaches RulesetResolver without importing MatchesModule', () => {
    const graph = buildGraph();
    const poolStandings = graph.get('PoolStandingsModule') ?? [];

    expect(poolStandings).toContain('RulesetResolverModule');
    expect(
      poolStandings,
      'Importing MatchesModule here closes the cycle through PhasesModule — ' +
        'inject RulesetResolver via RulesetResolverModule instead.',
    ).not.toContain('MatchesModule');
  });

  /**
   * The generic cycle test above passes as long as SOME edge in a cycle is
   * forwardRef'd — it strips those edges and cannot tell a correct break from a
   * useless one. That blind spot is exactly how the Referees→Workers cycle
   * shipped: a forwardRef sat on the wrong edge (Workers→Leagues), silencing the
   * static graph while the real undefined stayed on the plain Referees→Workers
   * import, crashing the API only at boot. This assertion pins the structural
   * fix — Referees depends on the NotificationSchedulingModule leaf, never the
   * whole WorkersModule — so a regression fails here instead of in production.
   */
  /**
   * Swiss auto-advance forces an edge PhasesModule → Swiss, because
   * MatchCompletionService has to pair the next round when a Swiss round's last
   * bout finishes. That edge is only safe against the LEAF.
   *
   * Every module listed here reaches PhasesModule, so any one of them inside
   * SwissCoreModule closes the cycle:
   *   PhasesModule → SwissCoreModule → X → … → PhasesModule
   *
   * NotificationsModule is the one most likely to be added by accident, since
   * the round-published notification belongs to this module's commit path:
   *   NotificationsModule → WorkersModule → LeaguesModule →
   *   TournamentPlacementModule → PhasesModule
   * The leaf NotificationSchedulingModule exports the same
   * NotificationEventsService with no back-edge — depend on that instead, the
   * way RefereesModule already does.
   */
  it('SwissCoreModule stays a leaf that cannot reach PhasesModule', () => {
    const graph = buildGraph();
    const core = graph.get('SwissCoreModule') ?? [];

    expect(graph.has('SwissCoreModule'), 'SwissCoreModule should exist').toBe(true);
    for (const forbidden of [
      'PhasesModule',
      'MatchesModule',
      'TournamentPlacementModule',
      'LeaguesModule',
      'WorkersModule',
      'NotificationsModule',
      'EventsModule',
      'FollowsModule',
    ]) {
      expect(
        core,
        `SwissCoreModule must not import ${forbidden} — it reaches PhasesModule, which ` +
          `imports SwissCoreModule for auto-advance. Depend on a leaf instead ` +
          `(NotificationSchedulingModule for notifications).`,
      ).not.toContain(forbidden);
    }

    // The positive half: `swiss_round_published` fires from the commit path, so
    // the leaf really does need NotificationEventsService. Asserting the source
    // of it stops a future edit from "fixing" a missing provider by reaching for
    // NotificationsModule, which the loop above would then reject — this line
    // says which import is the right one, not just which are wrong.
    expect(
      core,
      'SwissCoreModule fires swiss_round_published, so it must import the leaf ' +
        'NotificationSchedulingModule that exports NotificationEventsService.',
    ).toContain('NotificationSchedulingModule');
  });

  it('PhasesModule depends on the Swiss leaf, never the whole SwissModule', () => {
    const graph = buildGraph();
    const phases = graph.get('PhasesModule') ?? [];

    expect(phases).toContain('SwissCoreModule');
    expect(
      phases,
      'Importing SwissModule here closes PhasesModule → SwissModule → SwissCoreModule ' +
        'back into PhasesModule. MatchCompletionService only needs the leaf.',
    ).not.toContain('SwissModule');
  });

  it('RefereesModule reaches notification services without importing WorkersModule', () => {
    const graph = buildGraph();
    const referees = graph.get('RefereesModule') ?? [];

    expect(referees).toContain('NotificationSchedulingModule');
    expect(
      referees,
      'Importing WorkersModule here reintroduces the boot-crashing cycle ' +
        'WorkersModule → LeaguesModule → TournamentPlacementModule → PhasesModule → ' +
        'RefereesModule → WorkersModule. Depend on the NotificationSchedulingModule ' +
        'leaf for notification services instead.',
    ).not.toContain('WorkersModule');
  });
});
