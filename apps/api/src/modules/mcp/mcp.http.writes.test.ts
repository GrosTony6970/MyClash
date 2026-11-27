/**
 * The tools that write, through the real HTTP stack (`mcp.http.test-helper.ts`). The door passes
 * read-only mode whole (ruling 985), so each tool that writes asks the switch itself: what this
 * file proves is that each one refuses in maintenance having read the switch and nothing else,
 * and that the SDK refuses a bad argument before the tool runs.
 */
import { describe, expect, it } from 'vitest';
import {
  createDraftFromAction,
  door,
  from,
  rpc,
  setRefereeRoleAssignment,
  useMcpDoor,
  type ToolResultBody,
} from './mcp.http.test-helper';

useMcpDoor();

const MAINTENANCE = 'MyClash is in maintenance: nothing can change right now.';

const placements = [{ match: 'LSW-P2-M04', piste: 'Piste 2', start: '2026-12-05 14:30' }];

describe('the MCP tools that write, over HTTP', () => {
  // A new write tool must be named here, and proved below to refuse in maintenance, before it
  // ships.
  it('marks every tool read-only but the named writing tools', async () => {
    const res = await rpc('tools/list');
    const body = (await res.json()) as {
      result: { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] };
    };
    const notReadOnly = body.result.tools.filter((t) => t.annotations?.readOnlyHint !== true);
    expect(notReadOnly.map((t) => t.name).sort()).toEqual([
      'apply_referee_assignment',
      'draft_bracket',
      'draft_match_schedule',
      'draft_pools',
      'draft_tournament',
    ]);
  });

  it('refuses apply_referee_assignment while MyClash is read-only, and writes nothing', async () => {
    door.readOnly = true;
    const res = await rpc('tools/call', {
      name: 'apply_referee_assignment',
      arguments: { confirmation: 'any-confirmation' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ToolResultBody;
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toBe(MAINTENANCE);
    expect(setRefereeRoleAssignment).not.toHaveBeenCalled();
  });

  it.each([
    ['draft_tournament', { event: 'fal-2026', name: 'Sabre Open', slug: 'sabre-open' }],
    ['draft_pools', { event: 'fal-2026', tournament: 'longsword-open', poolCount: 4 }],
    ['draft_bracket', { event: 'fal-2026', tournament: 'longsword-open', qualifyCount: 16 }],
    ['draft_match_schedule', { event: 'fal-2026', tournament: 'longsword-open', placements }],
  ])('refuses %s while MyClash is read-only, before any other read', async (name, args) => {
    door.readOnly = true;
    const res = await rpc('tools/call', { name, arguments: args });
    const body = (await res.json()) as ToolResultBody;
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toBe(MAINTENANCE);
    expect(from.mock.calls.map(([table]) => table)).toEqual(['feature_flags']);
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  // Given both, Generate Pools uses poolCount and ignores the size the draft would show.
  it.each([
    ['neither poolCount nor targetSize', { schoolSeparation: true }],
    ['both poolCount and targetSize', { poolCount: 4, targetSize: 6 }],
  ])('refuses draft_pools with %s, before the tool runs', async (_case, counts) => {
    const res = await rpc('tools/call', {
      name: 'draft_pools',
      arguments: { event: 'fal-2026', tournament: 'longsword-open', ...counts },
    });
    const body = (await res.json()) as ToolResultBody;
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('Give poolCount or targetSize, not both.');
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses a draft_tournament name of spaces, before the tool runs', async () => {
    const res = await rpc('tools/call', {
      name: 'draft_tournament',
      arguments: { event: 'fal-2026', name: '    ', slug: 'sabre-open' },
    });
    const body = (await res.json()) as { result: { isError?: boolean } };
    expect(body.result.isError).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses a draft_match_schedule of 51 placements, before the tool runs', async () => {
    const res = await rpc('tools/call', {
      name: 'draft_match_schedule',
      arguments: {
        event: 'fal-2026',
        tournament: 'longsword-open',
        placements: Array.from({ length: 51 }, () => placements[0]),
      },
    });
    const body = (await res.json()) as ToolResultBody;
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('At most 50 placements in one draft.');
    expect(from).not.toHaveBeenCalled();
  });

  // `draft_pools` hands the SDK a whole refined object, not a shape: should the SDK fall back to
  // an empty schema, Claude would see a tool that takes no arguments.
  it("lists the draft tools' arguments", async () => {
    const res = await rpc('tools/list');
    const body = (await res.json()) as {
      result: {
        tools: {
          name: string;
          inputSchema: { properties?: Record<string, { type?: string }>; required?: string[] };
        }[];
      };
    };
    const schema = (name: string) => body.result.tools.find((t) => t.name === name)!.inputSchema;
    const pools = schema('draft_pools');
    expect(Object.keys(pools.properties ?? {}).sort()).toEqual([
      'event',
      'poolCount',
      'schoolSeparation',
      'skillBalance',
      'targetSize',
      'tournament',
    ]);
    expect([...(pools.required ?? [])].sort()).toEqual(['event', 'tournament']);
    const tournament = schema('draft_tournament');
    expect(Object.keys(tournament.properties ?? {}).sort()).toEqual([
      'event',
      'name',
      'ruleset',
      'slug',
      'weapon',
    ]);
    expect(tournament.properties?.['name']?.type).toBe('string');
    const bracket = schema('draft_bracket');
    expect(Object.keys(bracket.properties ?? {}).sort()).toEqual([
      'bracketSize',
      'event',
      'phaseType',
      'qualifyCount',
      'tournament',
    ]);
    expect([...(bracket.required ?? [])].sort()).toEqual(['event', 'tournament']);
    const times = schema('draft_match_schedule');
    expect([...(times.required ?? [])].sort()).toEqual(['event', 'placements', 'tournament']);
    const items = (times.properties?.['placements'] as { items?: typeof times } | undefined)?.items;
    expect([...(items?.required ?? [])].sort()).toEqual(['match', 'piste', 'start']);
  });
});
