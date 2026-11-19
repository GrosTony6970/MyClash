import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationalUnavailableException } from '../../common/operational-exception';
import { hashAgentKey } from './agent-key';
import { AGENT_KEY_STORE_UNAVAILABLE_CODE, AgentKeyGuard } from './agent-key.guard';

const KEY = `mca_${'k'.repeat(43)}`;
const FIVE_MINUTES = 5 * 60_000;

type Row = { id: string; revoked_at: string | null; last_used_at: string | null };

const select = vi.fn();
const eq = vi.fn();
const updateEq = vi.fn();
const update = vi.fn();
const from = vi.fn();
let readResult: { data: Row | null; error: { message: string } | null };

function wireTable() {
  const read = { select, eq, maybeSingle: vi.fn(async () => readResult) };
  select.mockReturnValue(read);
  eq.mockReturnValue(read);
  updateEq.mockResolvedValue({ error: null });
  update.mockReturnValue({ eq: updateEq });
  from.mockImplementation(() => ({ select, update }));
}

function contextFor(request: unknown) {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function requestWith(headers: Record<string, string>, cookies: Record<string, string> = {}) {
  return { headers, cookies, raw: {} };
}

const guard = () => new AgentKeyGuard({ service: { from } } as never);

beforeEach(() => {
  vi.clearAllMocks();
  wireTable();
  readResult = { data: null, error: null };
});

describe('AgentKeyGuard — what never reaches the table', () => {
  it('refuses a request with no Authorization header', async () => {
    await expect(guard().canActivate(contextFor(requestWith({})))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses a key carried in the login cookie: the door reads the header only', async () => {
    const request = requestWith({}, { 'sb-access-token': KEY });
    await expect(guard().canActivate(contextFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses a login token in the header', async () => {
    const request = requestWith({ authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig' });
    await expect(guard().canActivate(contextFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(from).not.toHaveBeenCalled();
  });
});

describe('AgentKeyGuard — the table decides', () => {
  const request = () => requestWith({ authorization: `Bearer ${KEY}` });

  it('reads the key by its hash, with the columns it needs and nothing else', async () => {
    readResult = { data: { id: 'k1', revoked_at: null, last_used_at: null }, error: null };
    await expect(guard().canActivate(contextFor(request()))).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('agent_keys');
    expect(select).toHaveBeenCalledWith('id, revoked_at, last_used_at');
    expect(eq).toHaveBeenCalledWith('token_hash', hashAgentKey(KEY));
  });

  it('refuses a key with no row', async () => {
    await expect(guard().canActivate(contextFor(request()))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses a revoked key', async () => {
    readResult = {
      data: { id: 'k1', revoked_at: '2026-11-18T10:00:00Z', last_used_at: null },
      error: null,
    };
    await expect(guard().canActivate(contextFor(request()))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('fails closed with a 503, not a 401, when the table cannot be read (ruling 876)', async () => {
    readResult = { data: null, error: { message: 'connection reset' } };
    const refusal = await guard()
      .canActivate(contextFor(request()))
      .then(
        () => null,
        (err: unknown) => err,
      );
    // The marker class is the one 5xx whose code and words the exception filter keeps.
    expect(refusal).toBeInstanceOf(OperationalUnavailableException);
    expect((refusal as OperationalUnavailableException).getStatus()).toBe(503);
    expect((refusal as OperationalUnavailableException).getResponse()).toEqual({
      code: AGENT_KEY_STORE_UNAVAILABLE_CODE,
      message: expect.not.stringContaining('connection reset'),
    });
  });
});

describe('AgentKeyGuard — last used', () => {
  const request = () => requestWith({ authorization: `Bearer ${KEY}` });

  it('stamps a key never used before', async () => {
    readResult = { data: { id: 'k1', revoked_at: null, last_used_at: null }, error: null };
    await guard().canActivate(contextFor(request()));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]).toEqual({ last_used_at: expect.any(String) });
    expect(updateEq).toHaveBeenCalledWith('id', 'k1');
  });

  it('stamps a key last used more than five minutes ago', async () => {
    const old = new Date(Date.now() - FIVE_MINUTES - 1_000).toISOString();
    readResult = { data: { id: 'k1', revoked_at: null, last_used_at: old }, error: null };
    await guard().canActivate(contextFor(request()));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('leaves a key used within five minutes alone', async () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    readResult = { data: { id: 'k1', revoked_at: null, last_used_at: recent }, error: null };
    await guard().canActivate(contextFor(request()));
    expect(update).not.toHaveBeenCalled();
  });

  it('catches a stamp that throws instead of answering, so no rejection escapes', async () => {
    const escaped = vi.fn();
    process.on('unhandledRejection', escaped);
    try {
      updateEq.mockRejectedValue(new Error('socket hang up'));
      readResult = { data: { id: 'k1', revoked_at: null, last_used_at: null }, error: null };
      await expect(guard().canActivate(contextFor(request()))).resolves.toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(escaped).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', escaped);
    }
  });

  it('still lets the key in when the stamp fails', async () => {
    updateEq.mockResolvedValue({ error: { message: 'timeout' } });
    readResult = { data: { id: 'k1', revoked_at: null, last_used_at: null }, error: null };
    await expect(guard().canActivate(contextFor(request()))).resolves.toBe(true);
  });
});
