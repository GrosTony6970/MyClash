/**
 * The MCP door through the real HTTP stack (`mcp.http.test-helper.ts`): the global filter, the
 * prefix, the real AuthGuard and real signed logins. What it proves: Claude's three first calls
 * answer, the 401 challenge survives the exception filter, a GET is a 405, and the real read-only
 * interceptor lets the door's reads answer (ruling 985). The tools that write, and their own
 * maintenance refusal, are `mcp.http.writes.test.ts`'s.
 */
import { NotFoundException } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { describe, expect, it, vi } from 'vitest';
import { MCP_INTERNAL_ERROR } from './mcp.controller';
import {
  connector,
  door,
  getMyDashboard,
  getUpcoming,
  listMyEvents,
  rpc,
  useMcpDoor,
} from './mcp.http.test-helper';

useMcpDoor();

describe('the MCP door, over HTTP', () => {
  it('answers initialize as myclash', async () => {
    const res = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '0' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { serverInfo: { name: string; version: string } };
    };
    expect(body.result.serverInfo.name).toBe('myclash');
    expect(body.result.serverInfo.version).toBe('1.3.0');
  });

  it('lists every tool, sorted', async () => {
    const res = await rpc('tools/list');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name).sort()).toEqual([
      'apply_referee_assignment',
      'compare_clubs',
      'draft_bracket',
      'draft_match_schedule',
      'draft_pools',
      'draft_tournament',
      'estimate_pool_completion',
      'event_info',
      'event_schedule',
      'find_fighters',
      'find_lagging_pools',
      'find_matches',
      'get_bracket_status',
      'get_fighter_stats',
      'get_judge_stats',
      'get_ring_status',
      'get_schedule_status',
      'get_tournament_summary',
      'my_events',
      'my_fight_history',
      'my_schedule',
      'my_stats',
      'my_upcoming',
      'my_workshops',
      'preview_referee_assignment',
      'rank_fighters',
      'tournament_standings',
      'whoami',
    ]);
  });

  it('refuses a limit past the cap before the tool runs', async () => {
    const res = await rpc('tools/call', { name: 'my_upcoming', arguments: { limit: 51 } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { isError?: boolean; content: [{ text: string }] };
      error?: unknown;
    };
    // The SDK answers a bad argument as a tool error result (or a JSON-RPC error): never a run.
    expect(body.result?.isError === true || body.error !== undefined).toBe(true);
    expect(getUpcoming).not.toHaveBeenCalled();
  });

  it('refuses a fight-history limit past ten before the tool runs', async () => {
    const res = await rpc('tools/call', { name: 'my_fight_history', arguments: { limit: 11 } });
    const body = (await res.json()) as { result?: { isError?: boolean }; error?: unknown };
    expect(body.result?.isError === true || body.error !== undefined).toBe(true);
    expect(getMyDashboard).not.toHaveBeenCalled();
  });

  it('answers a refusal as an error result with its one sentence, not a success', async () => {
    getMyDashboard.mockRejectedValue(new NotFoundException('no profile'));
    const res = await rpc('tools/call', { name: 'my_stats', arguments: {} });
    const body = (await res.json()) as {
      result: { isError?: boolean; content: [{ text: string }] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toBe('You have no fighter profile yet.');
  });

  it('calls whoami for the signed-in account', async () => {
    const res = await rpc('tools/call', { name: 'whoami', arguments: {} });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { content: [{ type: string; text: string }] } };
    expect(listMyEvents).toHaveBeenCalledWith({ userId: 'user-1', staff: null });
    expect(JSON.parse(body.result.content[0].text)).toEqual({
      email: 'a@b.c',
      events: [{ name: 'FAL 2026', slug: 'fal-2026', startDate: '2026-03-14', roles: ['fighter'] }],
    });
  });

  // Ruling 985: a referee asks "when is my next bout?" while MyClash is in maintenance. Every MCP
  // call is a POST, so the read-only switch refused the question with the writes.
  it('answers a read tool while MyClash is read-only', async () => {
    door.readOnly = true;
    const res = await rpc('tools/call', { name: 'whoami', arguments: {} });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { isError?: boolean } };
    expect(body.result.isError).toBeUndefined();
    expect(listMyEvents).toHaveBeenCalledWith({ userId: 'user-1', staff: null });
  });

  it('answers a failed tool with a plain error, never its cause', async () => {
    listMyEvents.mockRejectedValue(new Error('relation "secret_table" does not exist'));
    const res = await rpc('tools/call', { name: 'whoami', arguments: {} });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { isError: boolean; content: [{ text: string }] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toBe('MyClash could not answer this. Try again later.');
  });

  it('answers 500 with a JSON-RPC error when the transport fails, and ends the reply', async () => {
    const spy = vi
      .spyOn(StreamableHTTPServerTransport.prototype, 'handleRequest')
      .mockRejectedValueOnce(new Error('transport broke'));
    try {
      const res = await rpc('tools/list', {});
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toBe('application/json');
      expect(await res.text()).toBe(MCP_INTERNAL_ERROR);
    } finally {
      spy.mockRestore();
    }
  });

  it('ends the reply when the transport fails after it began to answer', async () => {
    const spy = vi
      .spyOn(StreamableHTTPServerTransport.prototype, 'handleRequest')
      .mockImplementationOnce(async (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"jsonrpc":');
        throw new Error('transport broke mid-answer');
      });
    try {
      const res = await rpc('tools/list', {});
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('{"jsonrpc":');
    } finally {
      spy.mockRestore();
    }
  });

  it('answers a call with no login 401, with the challenge past the exception filter', async () => {
    const res = await rpc('tools/list', {}, null);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://api.myclash.fr/.well-known/oauth-protected-resource/api/v1/mcp", scope="email profile offline_access"',
    );
    expect(listMyEvents).not.toHaveBeenCalled();
  });

  it('answers a GET 405, naming POST', async () => {
    const res = await fetch(door.url, {
      headers: { accept: 'text/event-stream', authorization: `Bearer ${connector}` },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});
