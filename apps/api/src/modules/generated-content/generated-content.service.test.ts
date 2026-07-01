import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeneratedContentService } from './generated-content.service';
import type { ContentTypeDef } from './content-type.interface';

/** Chainable Supabase stub whose terminal single/maybeSingle resolve to `result`. */
function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['upsert', 'update', 'select', 'eq', 'order']) {
    c[m] = vi.fn(() => c);
  }
  c['single'] = vi.fn().mockResolvedValue(result);
  c['maybeSingle'] = vi.fn().mockResolvedValue(result);
  return c;
}

const mockGenerateWithCap = vi.fn();
const aiUsage = { generateWithCap: mockGenerateWithCap };

function makeType(over: Partial<ContentTypeDef> = {}) {
  const assertAccess = vi.fn().mockResolvedValue(undefined);
  const buildContext = vi.fn().mockResolvedValue({ tournament: 'Summer Open', podium: [] });
  const resolveScope = vi.fn().mockResolvedValue({ orgId: 'org-1', eventId: 'ev-1' });
  const def = {
    contentType: 'tournament_recap',
    entityType: 'tournament',
    keySource: 'org' as const,
    canPublish: true,
    assertAccess,
    buildContext,
    resolveScope,
    systemPrompt: () => 'sys',
    ...over,
  } as ContentTypeDef;
  return { def, assertAccess, buildContext, resolveScope };
}

const mockGenerateForFighter = vi.fn();

function svc(
  types: ContentTypeDef[],
  fromImpl: (table: string) => unknown,
  opts: { aiDisabled?: boolean } = {},
) {
  const from = vi.fn(fromImpl);
  const providers = { generateForFighter: mockGenerateForFighter };
  const flags = { isEnabled: vi.fn().mockResolvedValue(opts.aiDisabled ?? false) };
  const service = new GeneratedContentService(
    { service: { from } } as never,
    aiUsage as never,
    providers as never,
    flags as never,
    types,
  );
  return { service, from };
}

describe('GeneratedContentService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('org generate: authorizes, builds facts, calls generateWithCap, stores a draft', async () => {
    mockGenerateWithCap.mockResolvedValue({
      text: 'Recap!',
      model: 'claude-opus-4-8',
      provider: 'anthropic',
      costEur: 0.01,
    });
    const t = makeType();
    const row = {
      content_type: 'tournament_recap',
      entity_id: 't1',
      locale: 'en',
      content: 'Recap!',
      status: 'draft',
      model: 'claude-opus-4-8',
      generated_at: 'now',
      published_at: null,
    };
    const { service } = svc([t.def], () => chain({ data: row, error: null }));

    const out = await service.generate('tournament_recap', 't1', 'en', 'user-1');

    expect(t.assertAccess).toHaveBeenCalledWith('t1', 'user-1');
    expect(t.buildContext).toHaveBeenCalledWith('t1', 'en');
    expect(mockGenerateWithCap).toHaveBeenCalledWith(
      'org-1',
      'ev-1',
      'generated_content:tournament_recap',
      expect.objectContaining({ system: 'sys' }),
    );
    expect(out.content).toBe('Recap!');
    expect(out.status).toBe('draft');
  });

  it('unknown content type → NotFound', async () => {
    const { service } = svc([makeType().def], () => chain({ data: null, error: null }));
    await expect(service.generate('nope', 't1', 'en', 'u')).rejects.toThrow(NotFoundException);
  });

  it('publish on a non-publishable type → BadRequest', async () => {
    const t = makeType({ contentType: 'organizer_content', canPublish: false });
    const { service } = svc([t.def], () => chain({ data: null, error: null }));
    await expect(service.setPublished('organizer_content', 'e1', 'en', 'u', true)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('getPublished returns null for a draft (published-only public read)', async () => {
    const draft = {
      content_type: 'tournament_recap',
      entity_id: 't1',
      locale: 'en',
      content: 'x',
      status: 'draft',
      model: null,
      generated_at: 'now',
      published_at: null,
    };
    const { service } = svc([makeType().def], () => chain({ data: draft, error: null }));
    expect(await service.getPublished('tournament_recap', 't1', 'en')).toBeNull();
  });

  it('fighter generate: uses the fighter BYOK path (generateForFighter), stores a draft', async () => {
    mockGenerateForFighter.mockResolvedValue({
      text: 'You are just getting started!',
      model: 'claude-haiku-4-5',
      provider: 'anthropic',
      costEur: 0.002,
    });
    const t = makeType({ contentType: 'fighter_insight', keySource: 'fighter' });
    const row = {
      content_type: 'fighter_insight',
      entity_id: 'gp1',
      locale: 'en',
      content: 'You are just getting started!',
      status: 'draft',
      model: 'claude-haiku-4-5',
      generated_at: 'now',
      published_at: null,
    };
    const { service } = svc([t.def], () => chain({ data: row, error: null }));

    const out = await service.generate('fighter_insight', 'gp1', 'en', 'user-1');

    expect(t.assertAccess).toHaveBeenCalledWith('gp1', 'user-1');
    expect(mockGenerateForFighter).toHaveBeenCalledWith(
      'gp1',
      expect.objectContaining({ system: 'sys' }),
    );
    expect(mockGenerateWithCap).not.toHaveBeenCalled(); // no org budget path
    expect(out.content).toBe('You are just getting started!');
  });

  it('fighter generate: the global AI kill-switch still wins', async () => {
    const t = makeType({ contentType: 'fighter_insight', keySource: 'fighter' });
    const { service } = svc([t.def], () => chain({ data: null, error: null }), {
      aiDisabled: true,
    });
    await expect(service.generate('fighter_insight', 'gp1', 'en', 'u')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(mockGenerateForFighter).not.toHaveBeenCalled();
  });
});
