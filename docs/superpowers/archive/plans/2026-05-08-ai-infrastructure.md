# AI Infrastructure Layer Implementation Plan

> **Status (2026-07-01 doc review):** Superseded — this plan shipped verbatim (mig `0029_ai_infrastructure.sql`, plus the `ai-providers` and `ai-usage` modules) and was then extended past its original two-module, adapter-owned-pricing shape. All task boxes below are done despite the unchecked `- [ ]` markers. Follow-on work NOT in this plan: `ai-providers/model-registry.ts` (`MODEL_REGISTRY` is now the single source of truth for models + pricing — adapters no longer own the per-provider `PRICING` maps shown below) and `ai-models.controller.ts` (`GET /ai/models`); `ai-usage/ai-dashboard.controller.ts` and a second `budget-exceeded.exception.ts` alongside `spend-cap.exception.ts`; sibling modules `organizer-ai-assistant/` (streaming chatbot) and `generated-content/` (incl. `me-ai.controller.ts`); migrations 0115–0120. Audited against code.

**Goal:** Build the shared AI infrastructure layer (encrypted BYOK key storage, provider abstraction for Anthropic/OpenAI/Mistral, per-event spend caps) that all future AI features depend on.

**Architecture:** Two NestJS modules — `ai-providers` (encrypts/stores org API keys, wraps three provider SDKs behind a neutral interface) and `ai-usage` (enforces per-event spend caps, logs each LLM call). A new org settings page and an event hub spend card complete the feature.

**Tech Stack:** NestJS + Vitest + Supabase service client + Node.js `crypto` (AES-256-GCM) + `@anthropic-ai/sdk` / `openai` / `@mistralai/mistralai`

---

## File Map

| File                                                                       | Action |
| -------------------------------------------------------------------------- | ------ |
| `packages/db/migrations/0029_ai_infrastructure.sql`                        | Create |
| `apps/api/src/modules/ai-providers/adapters/provider-adapter.interface.ts` | Create |
| `apps/api/src/modules/ai-providers/adapters/anthropic.adapter.ts`          | Create |
| `apps/api/src/modules/ai-providers/adapters/openai.adapter.ts`             | Create |
| `apps/api/src/modules/ai-providers/adapters/mistral.adapter.ts`            | Create |
| `apps/api/src/modules/ai-providers/adapters/adapters.test.ts`              | Create |
| `apps/api/src/modules/ai-providers/dto/ai-settings.dto.ts`                 | Create |
| `apps/api/src/modules/ai-providers/ai-providers.service.ts`                | Create |
| `apps/api/src/modules/ai-providers/ai-providers.service.test.ts`           | Create |
| `apps/api/src/modules/ai-providers/ai-providers.controller.ts`             | Create |
| `apps/api/src/modules/ai-providers/ai-providers.module.ts`                 | Create |
| `apps/api/src/modules/ai-usage/spend-cap.exception.ts`                     | Create |
| `apps/api/src/modules/ai-usage/ai-usage.service.ts`                        | Create |
| `apps/api/src/modules/ai-usage/ai-usage.service.test.ts`                   | Create |
| `apps/api/src/modules/ai-usage/ai-usage.controller.ts`                     | Create |
| `apps/api/src/modules/ai-usage/ai-usage.module.ts`                         | Create |
| `apps/api/src/app.module.ts`                                               | Modify |
| `apps/api/src/modules/events/dto/events.dto.ts`                            | Modify |
| `apps/api/src/modules/events/events.service.ts`                            | Modify |
| `apps/api/src/modules/organizations/organizations.service.ts`              | Modify |
| `apps/api/src/modules/organizations/organizations.controller.ts`           | Modify |
| `apps/web-admin/app/org/[slug]/settings/ai/page.tsx`                       | Create |
| `apps/web-admin/app/org/[slug]/events/[eventId]/page.tsx`                  | Modify |
| `.env.example`                                                             | Modify |
| `docs/ARCHITECTURE.md`                                                     | Modify |

---

## Task 1: DB Migration

**Files:**

- Create: `packages/db/migrations/0029_ai_infrastructure.sql`

- [ ] **Step 1: Create the migration**

```sql
-- packages/db/migrations/0029_ai_infrastructure.sql

-- AI key storage: one row per org, provider can change
CREATE TABLE organization_ai_settings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  provider         TEXT        NOT NULL CHECK (provider IN ('anthropic','openai','mistral')),
  api_key_enc      TEXT        NOT NULL,
  api_key_iv       TEXT        NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE organization_ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_settings_read" ON organization_ai_settings FOR SELECT USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = (SELECT auth.uid()) AND role IN ('owner','admin')
  )
);
CREATE POLICY "ai_settings_write" ON organization_ai_settings FOR ALL USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = (SELECT auth.uid()) AND role IN ('owner','admin')
  )
);

-- Usage log: one row per LLM call
CREATE TABLE ai_usage_log (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID          NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  organization_id  UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature          TEXT          NOT NULL,
  input_tokens     INTEGER       NOT NULL DEFAULT 0,
  output_tokens    INTEGER       NOT NULL DEFAULT 0,
  cost_eur         NUMERIC(10,6) NOT NULL DEFAULT 0,
  called_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_usage_event ON ai_usage_log(event_id);
CREATE INDEX idx_ai_usage_org   ON ai_usage_log(organization_id);
ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_usage_read" ON ai_usage_log FOR SELECT USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = (SELECT auth.uid()) AND role IN ('owner','admin')
  )
);

-- Spend cap on events
ALTER TABLE events ADD COLUMN ai_spend_cap_eur NUMERIC(10,4) DEFAULT NULL;
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/migrations/0029_ai_infrastructure.sql
git commit -m "feat: add AI infrastructure DB migration (T-1212)"
```

---

## Task 2: Install SDK packages

**Files:**

- Modify: `apps/api/package.json` (via pnpm)

- [ ] **Step 1: Add SDK dependencies**

Run from repo root:

```bash
pnpm --filter @myclash/api add @anthropic-ai/sdk openai @mistralai/mistralai
```

Expected output: three packages added to `apps/api/package.json` dependencies.

- [ ] **Step 2: Verify package.json**

Open `apps/api/package.json` and confirm these three entries appear in `dependencies`:

- `"@anthropic-ai/sdk": "..."`
- `"openai": "..."`
- `"@mistralai/mistralai": "..."`

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "feat: add AI provider SDK dependencies (T-1212)"
```

---

## Task 3: Provider Adapter Interface + All Three Adapters

**Files:**

- Create: `apps/api/src/modules/ai-providers/adapters/provider-adapter.interface.ts`
- Create: `apps/api/src/modules/ai-providers/adapters/anthropic.adapter.ts`
- Create: `apps/api/src/modules/ai-providers/adapters/openai.adapter.ts`
- Create: `apps/api/src/modules/ai-providers/adapters/mistral.adapter.ts`
- Create: `apps/api/src/modules/ai-providers/adapters/adapters.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/ai-providers/adapters/adapters.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Anthropic mock ─────────────────────────────────────────────────────────
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// ── OpenAI mock ────────────────────────────────────────────────────────────
const mockOpenAICreate = vi.fn();
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockOpenAICreate } },
  })),
}));

// ── Mistral mock ───────────────────────────────────────────────────────────
const mockMistralComplete = vi.fn();
vi.mock('@mistralai/mistralai', () => ({
  Mistral: vi.fn().mockImplementation(() => ({
    chat: { complete: mockMistralComplete },
  })),
}));

import { AnthropicAdapter } from './anthropic.adapter';
import { OpenAIAdapter } from './openai.adapter';
import { MistralAdapter } from './mistral.adapter';
import type { GenerationRequest } from './provider-adapter.interface';

const baseRequest: GenerationRequest = {
  system: 'You are helpful.',
  user: 'Hello',
  model: 'test-model',
  maxTokens: 100,
  temperature: 0.5,
};

// ── AnthropicAdapter ───────────────────────────────────────────────────────
describe('AnthropicAdapter', () => {
  let adapter: AnthropicAdapter;
  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new AnthropicAdapter();
  });

  it('returns text and token counts from a text response', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Hello back' }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'end_turn',
    });
    const result = await adapter.generate('key-123', baseRequest);
    expect(result.text).toBe('Hello back');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
    expect(result.toolCall).toBeUndefined();
    expect(result.costEur).toBeGreaterThan(0);
  });

  it('extracts tool_use block as toolCall', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'text', text: '' },
        { type: 'tool_use', name: 'search', input: { q: 'hello' } },
      ],
      usage: { input_tokens: 20, output_tokens: 8 },
      stop_reason: 'tool_use',
    });
    const result = await adapter.generate('key-123', {
      ...baseRequest,
      tools: [
        {
          name: 'search',
          description: 'Search',
          parameters: { type: 'object', properties: { q: { type: 'string' } } },
        },
      ],
      toolChoice: 'required',
    });
    expect(result.toolCall).toEqual({ name: 'search', arguments: { q: 'hello' } });
  });
});

// ── OpenAIAdapter ──────────────────────────────────────────────────────────
describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;
  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIAdapter();
  });

  it('returns text and token counts from a text response', async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: 'OpenAI reply', tool_calls: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 15, completion_tokens: 7 },
    });
    const result = await adapter.generate('key-oai', baseRequest);
    expect(result.text).toBe('OpenAI reply');
    expect(result.inputTokens).toBe(15);
    expect(result.outputTokens).toBe(7);
    expect(result.costEur).toBeGreaterThan(0);
  });

  it('extracts tool_calls as toolCall', async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ function: { name: 'lookup', arguments: '{"id":"42"}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 6 },
    });
    const result = await adapter.generate('key-oai', {
      ...baseRequest,
      tools: [{ name: 'lookup', description: 'Look up', parameters: {} }],
      toolChoice: 'required',
    });
    expect(result.toolCall).toEqual({ name: 'lookup', arguments: { id: '42' } });
  });
});

// ── MistralAdapter ─────────────────────────────────────────────────────────
describe('MistralAdapter', () => {
  let adapter: MistralAdapter;
  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new MistralAdapter();
  });

  it('returns text and token counts from a text response', async () => {
    mockMistralComplete.mockResolvedValue({
      choices: [{ message: { content: 'Mistral reply', toolCalls: null }, finishReason: 'stop' }],
      usage: { promptTokens: 11, completionTokens: 4 },
    });
    const result = await adapter.generate('key-mist', baseRequest);
    expect(result.text).toBe('Mistral reply');
    expect(result.inputTokens).toBe(11);
    expect(result.outputTokens).toBe(4);
    expect(result.costEur).toBeGreaterThan(0);
  });

  it('extracts toolCalls as toolCall', async () => {
    mockMistralComplete.mockResolvedValue({
      choices: [
        {
          message: {
            content: '',
            toolCalls: [{ function: { name: 'rank', arguments: '{"n":3}' } }],
          },
          finishReason: 'tool_calls',
        },
      ],
      usage: { promptTokens: 9, completionTokens: 5 },
    });
    const result = await adapter.generate('key-mist', {
      ...baseRequest,
      tools: [{ name: 'rank', description: 'Rank', parameters: {} }],
      toolChoice: 'auto',
    });
    expect(result.toolCall).toEqual({ name: 'rank', arguments: { n: 3 } });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && npx vitest run src/modules/ai-providers/adapters/adapters.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Create the shared interface**

```ts
// apps/api/src/modules/ai-providers/adapters/provider-adapter.interface.ts

export type AIProvider = 'anthropic' | 'openai' | 'mistral';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GenerationRequest {
  system: string;
  user: string;
  model: string;
  maxTokens: number;
  temperature: number;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'required';
}

export interface GenerationResult {
  text: string;
  toolCall?: { name: string; arguments: Record<string, unknown> };
  inputTokens: number;
  outputTokens: number;
  costEur: number;
}

export interface ProviderAdapter {
  generate(apiKey: string, request: GenerationRequest): Promise<GenerationResult>;
}
```

- [ ] **Step 4: Create the Anthropic adapter**

```ts
// apps/api/src/modules/ai-providers/adapters/anthropic.adapter.ts
import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import type {
  GenerationRequest,
  GenerationResult,
  ProviderAdapter,
  ToolDefinition,
} from './provider-adapter.interface';

// EUR prices per token (approximate). Update when Anthropic updates pricing.
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-3-5-sonnet-20241022': { input: (3 / 1_000_000) * 0.92, output: (15 / 1_000_000) * 0.92 },
  'claude-3-5-haiku-20241022': { input: (0.8 / 1_000_000) * 0.92, output: (4 / 1_000_000) * 0.92 },
  'claude-3-opus-20240229': { input: (15 / 1_000_000) * 0.92, output: (75 / 1_000_000) * 0.92 },
};
const DEFAULT_PRICING = { input: (3 / 1_000_000) * 0.92, output: (15 / 1_000_000) * 0.92 };

function mapTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool['input_schema'],
  }));
}

@Injectable()
export class AnthropicAdapter implements ProviderAdapter {
  async generate(apiKey: string, request: GenerationRequest): Promise<GenerationResult> {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
      ...(request.tools?.length
        ? {
            tools: mapTools(request.tools),
            tool_choice:
              request.toolChoice === 'required'
                ? { type: 'any' as const }
                : { type: 'auto' as const },
          }
        : {}),
    });

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
    const text = textBlocks.map((b) => b.text).join('');

    const toolBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    const toolCall = toolBlock
      ? { name: toolBlock.name, arguments: toolBlock.input as Record<string, unknown> }
      : undefined;

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const pricing = PRICING[request.model] ?? DEFAULT_PRICING;
    const costEur = inputTokens * pricing.input + outputTokens * pricing.output;

    return { text, toolCall, inputTokens, outputTokens, costEur };
  }
}
```

- [ ] **Step 5: Create the OpenAI adapter**

```ts
// apps/api/src/modules/ai-providers/adapters/openai.adapter.ts
import OpenAI from 'openai';
import { Injectable } from '@nestjs/common';
import type {
  GenerationRequest,
  GenerationResult,
  ProviderAdapter,
  ToolDefinition,
} from './provider-adapter.interface';

const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: (2.5 / 1_000_000) * 0.92, output: (10 / 1_000_000) * 0.92 },
  'gpt-4o-mini': { input: (0.15 / 1_000_000) * 0.92, output: (0.6 / 1_000_000) * 0.92 },
  'gpt-4-turbo': { input: (10 / 1_000_000) * 0.92, output: (30 / 1_000_000) * 0.92 },
};
const DEFAULT_PRICING = { input: (2.5 / 1_000_000) * 0.92, output: (10 / 1_000_000) * 0.92 };

function mapTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

@Injectable()
export class OpenAIAdapter implements ProviderAdapter {
  async generate(apiKey: string, request: GenerationRequest): Promise<GenerationResult> {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: request.model,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      ...(request.tools?.length
        ? {
            tools: mapTools(request.tools),
            tool_choice: request.toolChoice === 'required' ? 'required' : 'auto',
          }
        : {}),
    });

    const choice = response.choices[0];
    const text = choice?.message?.content ?? '';

    const rawToolCall = choice?.message?.tool_calls?.[0];
    const toolCall = rawToolCall
      ? {
          name: rawToolCall.function.name,
          arguments: JSON.parse(rawToolCall.function.arguments) as Record<string, unknown>,
        }
      : undefined;

    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const pricing = PRICING[request.model] ?? DEFAULT_PRICING;
    const costEur = inputTokens * pricing.input + outputTokens * pricing.output;

    return { text, toolCall, inputTokens, outputTokens, costEur };
  }
}
```

- [ ] **Step 6: Create the Mistral adapter**

```ts
// apps/api/src/modules/ai-providers/adapters/mistral.adapter.ts
import { Mistral } from '@mistralai/mistralai';
import { Injectable } from '@nestjs/common';
import type {
  GenerationRequest,
  GenerationResult,
  ProviderAdapter,
  ToolDefinition,
} from './provider-adapter.interface';

const PRICING: Record<string, { input: number; output: number }> = {
  'mistral-large-latest': { input: (2 / 1_000_000) * 0.92, output: (6 / 1_000_000) * 0.92 },
  'mistral-small-latest': { input: (0.1 / 1_000_000) * 0.92, output: (0.3 / 1_000_000) * 0.92 },
  'open-mistral-7b': { input: (0.025 / 1_000_000) * 0.92, output: (0.025 / 1_000_000) * 0.92 },
};
const DEFAULT_PRICING = { input: (2 / 1_000_000) * 0.92, output: (6 / 1_000_000) * 0.92 };

function mapTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

@Injectable()
export class MistralAdapter implements ProviderAdapter {
  async generate(apiKey: string, request: GenerationRequest): Promise<GenerationResult> {
    const client = new Mistral({ apiKey });
    const response = await client.chat.complete({
      model: request.model,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      ...(request.tools?.length
        ? {
            tools: mapTools(request.tools),
            toolChoice: request.toolChoice === 'required' ? 'required' : 'auto',
          }
        : {}),
    });

    const choice = response?.choices?.[0];
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';

    const rawToolCall = choice?.message?.toolCalls?.[0];
    const toolCall = rawToolCall
      ? {
          name: rawToolCall.function.name,
          arguments:
            typeof rawToolCall.function.arguments === 'string'
              ? (JSON.parse(rawToolCall.function.arguments) as Record<string, unknown>)
              : (rawToolCall.function.arguments as Record<string, unknown>),
        }
      : undefined;

    const inputTokens = response?.usage?.promptTokens ?? 0;
    const outputTokens = response?.usage?.completionTokens ?? 0;
    const pricing = PRICING[request.model] ?? DEFAULT_PRICING;
    const costEur = inputTokens * pricing.input + outputTokens * pricing.output;

    return { text, toolCall, inputTokens, outputTokens, costEur };
  }
}
```

- [ ] **Step 7: Run tests — expect pass**

```bash
cd apps/api && npx vitest run src/modules/ai-providers/adapters/adapters.test.ts
```

Expected: 8 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/ai-providers/
git commit -m "feat: add AI provider adapters for Anthropic, OpenAI, Mistral (T-1212)"
```

---

## Task 4: AIProvidersService

**Files:**

- Create: `apps/api/src/modules/ai-providers/ai-providers.service.ts`
- Create: `apps/api/src/modules/ai-providers/ai-providers.service.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/ai-providers/ai-providers.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIProvidersService } from './ai-providers.service';

// ── Adapter mocks ──────────────────────────────────────────────────────────
const mockGenerate = vi.fn();
vi.mock('./adapters/anthropic.adapter', () => ({
  AnthropicAdapter: vi.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));
vi.mock('./adapters/openai.adapter', () => ({
  OpenAIAdapter: vi.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));
vi.mock('./adapters/mistral.adapter', () => ({
  MistralAdapter: vi.fn().mockImplementation(() => ({ generate: mockGenerate })),
}));

// ── Supabase mock ──────────────────────────────────────────────────────────
const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.upsert.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  return chain;
}

const AI_KEY_SECRET = 'a'.repeat(64); // 32-byte hex (64 hex chars)

describe('AIProvidersService', () => {
  let service: AIProvidersService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['AI_KEY_SECRET'] = AI_KEY_SECRET;
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new AIProvidersService(mockSupabase as never);
    service.onModuleInit();
  });

  it('throws if AI_KEY_SECRET is not set', () => {
    delete process.env['AI_KEY_SECRET'];
    const s = new AIProvidersService(mockSupabase as never);
    expect(() => s.onModuleInit()).toThrow('AI_KEY_SECRET env var is required');
  });

  it('throws if AI_KEY_SECRET is wrong length', () => {
    process.env['AI_KEY_SECRET'] = 'tooshort';
    const s = new AIProvidersService(mockSupabase as never);
    expect(() => s.onModuleInit()).toThrow();
  });

  it('saveKey encrypts and upserts', async () => {
    const chain = makeChain({ data: { id: 'row-1' }, error: null });
    fromMock.mockReturnValue(chain);
    await service.saveKey('org-1', 'anthropic', 'sk-test-key');
    expect(chain.upsert).toHaveBeenCalledOnce();
    const upsertArg = (chain.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(upsertArg['organization_id']).toBe('org-1');
    expect(upsertArg['provider']).toBe('anthropic');
    // Ciphertext must not contain the raw key
    expect(upsertArg['api_key_enc']).not.toContain('sk-test-key');
    // IV must be present
    expect(typeof upsertArg['api_key_iv']).toBe('string');
    expect((upsertArg['api_key_iv'] as string).length).toBeGreaterThan(0);
  });

  it('encrypt-decrypt round-trip preserves key value', async () => {
    // saveKey then getConfig+generate to verify decryption works
    const originalKey = 'sk-anthropic-secret-key';
    let savedRow: Record<string, unknown> = {};

    fromMock.mockImplementation((table: string) => {
      if (table === 'organization_ai_settings') {
        const chain = makeChain({ data: null, error: null });
        chain.upsert.mockImplementation((row: unknown) => {
          savedRow = row as Record<string, unknown>;
          return { ...chain, select: vi.fn().mockReturnValue(chain) };
        });
        chain.maybeSingle.mockResolvedValue({
          data: {
            provider: 'anthropic',
            api_key_enc: savedRow['api_key_enc'],
            api_key_iv: savedRow['api_key_iv'],
            updated_at: new Date().toISOString(),
          },
          error: null,
        });
        return chain;
      }
      return makeChain({ data: null, error: null });
    });

    await service.saveKey('org-1', 'anthropic', originalKey);

    // Patch maybeSingle to return the saved row
    const chain2 = makeChain({
      data: {
        provider: 'anthropic',
        api_key_enc: savedRow['api_key_enc'],
        api_key_iv: savedRow['api_key_iv'],
        updated_at: new Date().toISOString(),
      },
      error: null,
    });
    fromMock.mockReturnValue(chain2);

    mockGenerate.mockResolvedValue({ text: 'ok', inputTokens: 1, outputTokens: 1, costEur: 0.001 });

    const result = await service.generate('org-1', {
      system: 's',
      user: 'u',
      model: 'claude-3-5-sonnet-20241022',
      maxTokens: 10,
      temperature: 0,
    });
    expect(result.text).toBe('ok');
    // Verify generate was called with the original raw key
    expect(mockGenerate).toHaveBeenCalledWith(originalKey, expect.objectContaining({ user: 'u' }));
  });

  it('getProviderConfig returns null when no row', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    const result = await service.getProviderConfig('org-1');
    expect(result).toBeNull();
  });

  it('getProviderConfig returns { provider, hasKey } when row exists', async () => {
    fromMock.mockReturnValue(
      makeChain({
        data: { provider: 'openai', updated_at: '2026-01-01T00:00:00Z' },
        error: null,
      }),
    );
    const result = await service.getProviderConfig('org-1');
    expect(result).toEqual({ provider: 'openai', hasKey: true, updatedAt: '2026-01-01T00:00:00Z' });
  });

  it('deleteKey deletes the row', async () => {
    const chain = makeChain({ data: null, error: null });
    fromMock.mockReturnValue(chain);
    await service.deleteKey('org-1');
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && npx vitest run src/modules/ai-providers/ai-providers.service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create AIProvidersService**

```ts
// apps/api/src/modules/ai-providers/ai-providers.service.ts
import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { AnthropicAdapter } from './adapters/anthropic.adapter';
import { MistralAdapter } from './adapters/mistral.adapter';
import { OpenAIAdapter } from './adapters/openai.adapter';
import type {
  AIProvider,
  GenerationRequest,
  GenerationResult,
  ProviderAdapter,
} from './adapters/provider-adapter.interface';
import { SupabaseService } from '../supabase/supabase.service';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

@Injectable()
export class AIProvidersService implements OnModuleInit {
  private secretKey!: Buffer;
  private adapters!: Record<AIProvider, ProviderAdapter>;

  constructor(private readonly supabase: SupabaseService) {}

  onModuleInit() {
    const secret = process.env['AI_KEY_SECRET'];
    if (!secret) throw new Error('AI_KEY_SECRET env var is required');
    this.secretKey = Buffer.from(secret, 'hex');
    if (this.secretKey.length !== 32) {
      throw new Error('AI_KEY_SECRET must be a 64-character hex string (32 bytes)');
    }
    this.adapters = {
      anthropic: new AnthropicAdapter(),
      openai: new OpenAIAdapter(),
      mistral: new MistralAdapter(),
    };
  }

  async saveKey(orgId: string, provider: AIProvider, rawKey: string): Promise<void> {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.secretKey, iv);
    const encrypted = Buffer.concat([cipher.update(rawKey, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const ciphertext = Buffer.concat([encrypted, tag]).toString('base64');
    const ivBase64 = iv.toString('base64');

    const { error } = await this.supabase.service
      .from('organization_ai_settings')
      .upsert({
        organization_id: orgId,
        provider,
        api_key_enc: ciphertext,
        api_key_iv: ivBase64,
        updated_at: new Date().toISOString(),
      })
      .select('id');

    if (error) throw new Error(error.message);
  }

  async deleteKey(orgId: string): Promise<void> {
    await this.supabase.service
      .from('organization_ai_settings')
      .delete()
      .eq('organization_id', orgId);
  }

  async getProviderConfig(
    orgId: string,
  ): Promise<{ provider: AIProvider; hasKey: true; updatedAt: string } | null> {
    const { data } = await this.supabase.service
      .from('organization_ai_settings')
      .select('provider, updated_at')
      .eq('organization_id', orgId)
      .maybeSingle();

    if (!data) return null;
    const row = data as { provider: AIProvider; updated_at: string };
    return { provider: row.provider, hasKey: true, updatedAt: row.updated_at };
  }

  async generate(orgId: string, request: GenerationRequest): Promise<GenerationResult> {
    const { data } = await this.supabase.service
      .from('organization_ai_settings')
      .select('provider, api_key_enc, api_key_iv')
      .eq('organization_id', orgId)
      .maybeSingle();

    if (!data) throw new NotFoundException('No AI provider configured for this organization');

    const row = data as { provider: AIProvider; api_key_enc: string; api_key_iv: string };
    const rawKey = this.decrypt(row.api_key_enc, row.api_key_iv);
    const adapter = this.adapters[row.provider];
    return adapter.generate(rawKey, request);
  }

  private decrypt(ciphertext: string, ivBase64: string): string {
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = Buffer.from(ivBase64, 'base64');
    const encrypted = buf.subarray(0, buf.length - TAG_LENGTH);
    const tag = buf.subarray(buf.length - TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.secretKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd apps/api && npx vitest run src/modules/ai-providers/ai-providers.service.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ai-providers/ai-providers.service.ts apps/api/src/modules/ai-providers/ai-providers.service.test.ts
git commit -m "feat: add AIProvidersService with AES-256-GCM key storage (T-1212)"
```

---

## Task 5: AIProvidersController + DTO + Module

**Files:**

- Create: `apps/api/src/modules/ai-providers/dto/ai-settings.dto.ts`
- Create: `apps/api/src/modules/ai-providers/ai-providers.controller.ts`
- Create: `apps/api/src/modules/ai-providers/ai-providers.module.ts`

- [ ] **Step 1: Create the DTO**

```ts
// apps/api/src/modules/ai-providers/dto/ai-settings.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MinLength } from 'class-validator';
import type { AIProvider } from '../adapters/provider-adapter.interface';

export class SaveAISettingsDto {
  @ApiProperty({ enum: ['anthropic', 'openai', 'mistral'] })
  @IsIn(['anthropic', 'openai', 'mistral'])
  provider!: AIProvider;

  @ApiProperty({ example: 'sk-ant-...' })
  @IsString()
  @MinLength(10)
  apiKey!: string;
}
```

- [ ] **Step 2: Create the controller**

```ts
// apps/api/src/modules/ai-providers/ai-providers.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { AIProvidersService } from './ai-providers.service';
import { SaveAISettingsDto } from './dto/ai-settings.dto';

async function getUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) return 'anonymous';
  const {
    data: { user },
  } = await supabase.anon.auth.getUser(token);
  return user?.id ?? 'anonymous';
}

@ApiTags('ai-providers')
@ApiBearerAuth()
@Controller('organizations')
export class AIProvidersController {
  constructor(
    private readonly service: AIProvidersService,
    private readonly supabase: SupabaseService,
  ) {}

  /** GET /api/v1/organizations/:orgId/ai-settings */
  @Get(':orgId/ai-settings')
  @ApiOperation({ summary: 'Get AI provider config for org' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async getSettings(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.getProviderConfig(orgId);
  }

  /** PUT /api/v1/organizations/:orgId/ai-settings */
  @Put(':orgId/ai-settings')
  @ApiOperation({ summary: 'Save encrypted AI API key for org' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async saveSettings(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: SaveAISettingsDto,
    @Req() req: FastifyRequest,
  ) {
    const _userId = await getUserId(req, this.supabase);
    await this.service.saveKey(orgId, dto.provider, dto.apiKey);
    return this.service.getProviderConfig(orgId);
  }

  /** DELETE /api/v1/organizations/:orgId/ai-settings */
  @Delete(':orgId/ai-settings')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove AI API key for org' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async deleteSettings(@Param('orgId', ParseUUIDPipe) orgId: string, @Req() req: FastifyRequest) {
    const _userId = await getUserId(req, this.supabase);
    await this.service.deleteKey(orgId);
  }
}
```

- [ ] **Step 3: Create the module**

```ts
// apps/api/src/modules/ai-providers/ai-providers.module.ts
import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { AnthropicAdapter } from './adapters/anthropic.adapter';
import { MistralAdapter } from './adapters/mistral.adapter';
import { OpenAIAdapter } from './adapters/openai.adapter';
import { AIProvidersController } from './ai-providers.controller';
import { AIProvidersService } from './ai-providers.service';

@Module({
  imports: [SupabaseModule],
  controllers: [AIProvidersController],
  providers: [AIProvidersService, AnthropicAdapter, OpenAIAdapter, MistralAdapter],
  exports: [AIProvidersService],
})
export class AIProvidersModule {}
```

- [ ] **Step 4: Typecheck to confirm no errors**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ai-providers/
git commit -m "feat: add AIProvidersController, DTO, and module (T-1212)"
```

---

## Task 6: SpendCap Exception + AIUsageService

**Files:**

- Create: `apps/api/src/modules/ai-usage/spend-cap.exception.ts`
- Create: `apps/api/src/modules/ai-usage/ai-usage.service.ts`
- Create: `apps/api/src/modules/ai-usage/ai-usage.service.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/ai-usage/ai-usage.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIUsageService } from './ai-usage.service';
import { SpendCapExceededException } from './spend-cap.exception';

const mockProviderGenerate = vi.fn();
const mockAIProviders = { generate: mockProviderGenerate };

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    insert: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  return chain;
}

const fakeResult = { text: 'ok', inputTokens: 10, outputTokens: 5, costEur: 0.001 };
const baseRequest = { system: 's', user: 'u', model: 'm', maxTokens: 100, temperature: 0 };

describe('AIUsageService.generateWithCap', () => {
  let service: AIUsageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AIUsageService(mockAIProviders as never, mockSupabase as never);
  });

  it('passes when no cap is set (NULL)', async () => {
    // Event has null spend cap
    fromMock.mockImplementation((table: string) => {
      if (table === 'events') return makeChain({ data: { ai_spend_cap_eur: null }, error: null });
      if (table === 'ai_usage_log') return makeChain({ data: { sum: null }, error: null });
      return makeChain({ data: null, error: null });
    });
    mockProviderGenerate.mockResolvedValue(fakeResult);

    const result = await service.generateWithCap('org-1', 'event-1', 'nlq', baseRequest);
    expect(result.text).toBe('ok');
    expect(mockProviderGenerate).toHaveBeenCalledOnce();
  });

  it('passes when spend is under cap', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'events') return makeChain({ data: { ai_spend_cap_eur: 5.0 }, error: null });
      if (table === 'ai_usage_log') {
        const chain = makeChain(null);
        chain.select.mockReturnValue({
          ...chain,
          eq: vi.fn().mockReturnValue({
            ...chain,
            single: vi.fn().mockResolvedValue({ data: { sum: '2.50' }, error: null }),
          }),
        });
        return chain;
      }
      return makeChain({ data: null, error: null });
    });
    mockProviderGenerate.mockResolvedValue(fakeResult);

    const result = await service.generateWithCap('org-1', 'event-1', 'nlq', baseRequest);
    expect(result.text).toBe('ok');
  });

  it('throws SpendCapExceededException when at or over cap', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'events') return makeChain({ data: { ai_spend_cap_eur: 5.0 }, error: null });
      if (table === 'ai_usage_log') {
        const chain = makeChain(null);
        chain.select.mockReturnValue({
          ...chain,
          eq: vi.fn().mockReturnValue({
            ...chain,
            single: vi.fn().mockResolvedValue({ data: { sum: '5.00' }, error: null }),
          }),
        });
        return chain;
      }
      return makeChain({ data: null, error: null });
    });

    await expect(service.generateWithCap('org-1', 'event-1', 'nlq', baseRequest)).rejects.toThrow(
      SpendCapExceededException,
    );
    expect(mockProviderGenerate).not.toHaveBeenCalled();
  });

  it('inserts usage log row after successful generation', async () => {
    const insertChain = makeChain({ data: null, error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === 'events') return makeChain({ data: { ai_spend_cap_eur: null }, error: null });
      if (table === 'ai_usage_log') return insertChain;
      return makeChain({ data: null, error: null });
    });
    mockProviderGenerate.mockResolvedValue(fakeResult);

    await service.generateWithCap('org-1', 'event-1', 'nlq', baseRequest);
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: 'event-1',
        organization_id: 'org-1',
        feature: 'nlq',
        input_tokens: 10,
        output_tokens: 5,
        cost_eur: 0.001,
      }),
    );
  });
});

describe('AIUsageService.getUsageSummary', () => {
  let service: AIUsageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AIUsageService(mockAIProviders as never, mockSupabase as never);
  });

  it('returns totalSpendEur, cap, remainingEur, callCount', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'events') return makeChain({ data: { ai_spend_cap_eur: 10.0 }, error: null });
      if (table === 'ai_usage_log') {
        const chain = makeChain(null);
        chain.select.mockReturnValue({
          ...chain,
          eq: vi.fn().mockReturnValue({
            ...chain,
            single: vi.fn().mockResolvedValue({
              data: { total: '3.50', calls: 7 },
              error: null,
            }),
          }),
        });
        return chain;
      }
      return makeChain({ data: null, error: null });
    });

    const summary = await service.getUsageSummary('event-1');
    expect(summary.totalSpendEur).toBeCloseTo(3.5);
    expect(summary.cap).toBeCloseTo(10);
    expect(summary.remainingEur).toBeCloseTo(6.5);
    expect(summary.callCount).toBe(7);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && npx vitest run src/modules/ai-usage/ai-usage.service.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Create the exception**

```ts
// apps/api/src/modules/ai-usage/spend-cap.exception.ts
import { HttpException, HttpStatus } from '@nestjs/common';

export class SpendCapExceededException extends HttpException {
  constructor(eventId: string, capEur: number, spentEur: number) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'Spend cap exceeded',
        message: `Event ${eventId} has reached its AI spend cap of €${capEur.toFixed(2)} (current: €${spentEur.toFixed(2)})`,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
```

- [ ] **Step 4: Create AIUsageService**

```ts
// apps/api/src/modules/ai-usage/ai-usage.service.ts
import { Injectable } from '@nestjs/common';
import { AIProvidersService } from '../ai-providers/ai-providers.service';
import { SupabaseService } from '../supabase/supabase.service';
import type {
  GenerationRequest,
  GenerationResult,
} from '../ai-providers/adapters/provider-adapter.interface';
import { SpendCapExceededException } from './spend-cap.exception';

@Injectable()
export class AIUsageService {
  constructor(
    private readonly providers: AIProvidersService,
    private readonly supabase: SupabaseService,
  ) {}

  async generateWithCap(
    orgId: string,
    eventId: string,
    feature: string,
    request: GenerationRequest,
  ): Promise<GenerationResult> {
    // 1. Load spend cap
    const { data: eventData } = await this.supabase.service
      .from('events')
      .select('ai_spend_cap_eur')
      .eq('id', eventId)
      .maybeSingle();

    const cap = (eventData as { ai_spend_cap_eur: number | null } | null)?.ai_spend_cap_eur ?? null;

    // 2. Check cap
    if (cap !== null) {
      const { data: sumData } = await this.supabase.service
        .from('ai_usage_log')
        .select('sum:cost_eur.sum()')
        .eq('event_id', eventId)
        .single();

      const spent = parseFloat((sumData as { sum: string | null } | null)?.sum ?? '0');
      if (spent >= cap) {
        throw new SpendCapExceededException(eventId, cap, spent);
      }
    }

    // 3. Generate
    const result = await this.providers.generate(orgId, request);

    // 4. Log usage
    await this.supabase.service.from('ai_usage_log').insert({
      event_id: eventId,
      organization_id: orgId,
      feature,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_eur: result.costEur,
    });

    return result;
  }

  async getUsageSummary(eventId: string): Promise<{
    totalSpendEur: number;
    cap: number | null;
    remainingEur: number | null;
    callCount: number;
  }> {
    const [eventRes, usageRes] = await Promise.all([
      this.supabase.service
        .from('events')
        .select('ai_spend_cap_eur')
        .eq('id', eventId)
        .maybeSingle(),
      this.supabase.service
        .from('ai_usage_log')
        .select('total:cost_eur.sum(), calls:id.count()')
        .eq('event_id', eventId)
        .single(),
    ]);

    const cap =
      (eventRes.data as { ai_spend_cap_eur: number | null } | null)?.ai_spend_cap_eur ?? null;
    const usageRow = usageRes.data as { total: string | null; calls: number } | null;
    const totalSpendEur = parseFloat(usageRow?.total ?? '0');
    const callCount = usageRow?.calls ?? 0;
    const remainingEur = cap !== null ? Math.max(0, cap - totalSpendEur) : null;

    return { totalSpendEur, cap, remainingEur, callCount };
  }
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd apps/api && npx vitest run src/modules/ai-usage/ai-usage.service.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/ai-usage/
git commit -m "feat: add AIUsageService with spend cap enforcement (T-1212)"
```

---

## Task 7: AIUsageController + Module

**Files:**

- Create: `apps/api/src/modules/ai-usage/ai-usage.controller.ts`
- Create: `apps/api/src/modules/ai-usage/ai-usage.module.ts`

- [ ] **Step 1: Create the controller**

```ts
// apps/api/src/modules/ai-usage/ai-usage.controller.ts
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AIUsageService } from './ai-usage.service';

@ApiTags('ai-usage')
@ApiBearerAuth()
@Controller('events')
export class AIUsageController {
  constructor(private readonly service: AIUsageService) {}

  /** GET /api/v1/events/:eventId/ai-usage */
  @Get(':eventId/ai-usage')
  @ApiOperation({ summary: 'Get AI spend summary for event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async getUsage(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.service.getUsageSummary(eventId);
  }
}
```

- [ ] **Step 2: Create the module**

```ts
// apps/api/src/modules/ai-usage/ai-usage.module.ts
import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { AIProvidersModule } from '../ai-providers/ai-providers.module';
import { AIUsageController } from './ai-usage.controller';
import { AIUsageService } from './ai-usage.service';

@Module({
  imports: [SupabaseModule, AIProvidersModule],
  controllers: [AIUsageController],
  providers: [AIUsageService],
  exports: [AIUsageService],
})
export class AIUsageModule {}
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/ai-usage/ai-usage.controller.ts apps/api/src/modules/ai-usage/ai-usage.module.ts
git commit -m "feat: add AIUsageController and module (T-1212)"
```

---

## Task 8: Wire Up — App Module + Events DTO/Service + Org Slug Endpoint

**Files:**

- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/modules/events/dto/events.dto.ts`
- Modify: `apps/api/src/modules/events/events.service.ts`
- Modify: `apps/api/src/modules/organizations/organizations.service.ts`
- Modify: `apps/api/src/modules/organizations/organizations.controller.ts`

- [ ] **Step 1: Register modules in app.module.ts**

Add these two imports at the top of `apps/api/src/app.module.ts`:

```ts
import { AIProvidersModule } from './modules/ai-providers/ai-providers.module';
import { AIUsageModule } from './modules/ai-usage/ai-usage.module';
```

Add to the `imports` array after `ProgrammeModule`:

```ts
AIProvidersModule,
AIUsageModule,
```

The full imports array should include (among others):

```ts
ProgrammeModule,
AIProvidersModule,
AIUsageModule,
FollowsModule,
```

- [ ] **Step 2: Add aiSpendCapEur to UpdateEventDto**

In `apps/api/src/modules/events/dto/events.dto.ts`, add to `UpdateEventDto` after the `status` field:

```ts
  @ApiProperty({ required: false, description: 'AI spend cap in EUR for this event (null = no cap)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  aiSpendCapEur?: number | null;
```

Also add `IsNumber, Min` to the imports from `'class-validator'`:

```ts
import {
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
```

- [ ] **Step 3: Persist ai_spend_cap_eur in events.service.ts**

In `apps/api/src/modules/events/events.service.ts`, in the `updateEvent` method after the line `if (dto.status !== undefined) updates['status'] = dto.status;`:

```ts
if (dto.aiSpendCapEur !== undefined) updates['ai_spend_cap_eur'] = dto.aiSpendCapEur;
```

- [ ] **Step 4: Add getBySlug to OrganizationsService**

In `apps/api/src/modules/organizations/organizations.service.ts`, add this method after `getById`:

```ts
  async getBySlug(slug: string) {
    const { data, error } = await this.supabase.service
      .from('organizations')
      .select('id, name, slug, status')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Organization "${slug}" not found`);
    return data;
  }
```

- [ ] **Step 5: Expose GET /organizations/slug/:slug in OrganizationsController**

In `apps/api/src/modules/organizations/organizations.controller.ts`, add this route **before** `@Get(':id')` (order matters — NestJS resolves routes top-to-bottom):

```ts
  /** GET /api/v1/organizations/slug/:slug */
  @Get('slug/:slug')
  @ApiOperation({ summary: 'Get organization by slug' })
  @ApiParam({ name: 'slug', type: 'string' })
  async getBySlug(@Param('slug') slug: string) {
    return this.orgs.getBySlug(slug);
  }
```

- [ ] **Step 6: Run all API tests to confirm nothing broke**

```bash
cd apps/api && npx vitest run
```

Expected: all tests PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/app.module.ts \
        apps/api/src/modules/events/dto/events.dto.ts \
        apps/api/src/modules/events/events.service.ts \
        apps/api/src/modules/organizations/organizations.service.ts \
        apps/api/src/modules/organizations/organizations.controller.ts
git commit -m "feat: register AI modules, events spend cap, org slug endpoint (T-1212)"
```

---

## Task 9: Frontend — Org AI Settings Page

**Files:**

- Create: `apps/web-admin/app/org/[slug]/settings/ai/page.tsx`

The page resolves the org ID via `GET /api/v1/organizations/slug/:slug`, fetches AI settings from `GET /api/v1/organizations/:orgId/ai-settings`, and allows saving/removing keys.

- [ ] **Step 1: Create the page**

```tsx
/* eslint-disable myclash/no-literal-string -- org AI settings, i18n tracked in backlog */
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type AIProvider = 'anthropic' | 'openai' | 'mistral';

interface AIConfig {
  provider: AIProvider;
  hasKey: true;
  updatedAt: string;
}

const PROVIDERS: { id: AIProvider; label: string; hint: string }[] = [
  { id: 'anthropic', label: 'Anthropic', hint: 'Claude 3.5 Sonnet / Haiku' },
  { id: 'openai', label: 'OpenAI', hint: 'GPT-4o / GPT-4o mini' },
  { id: 'mistral', label: 'Mistral', hint: 'Mistral Large / Small' },
];

export default function OrgAISettingsPage() {
  const params = useParams<{ slug: string }>();
  const { slug } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [orgId, setOrgId] = useState<string | null>(null);
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const org = (await res.json()) as { id: string };
        setOrgId(org.id);
        const cfgRes = await fetch(`${apiUrl}/api/v1/organizations/${org.id}/ai-settings`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (cfgRes.ok) {
          const data = (await cfgRes.json()) as AIConfig | null;
          setConfig(data);
          if (data) setSelectedProvider(data.provider);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError('Failed to load AI settings');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [slug, apiUrl]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !apiKey.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/organizations/${orgId}/ai-settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: selectedProvider, apiKey: apiKey.trim() }),
      });
      if (!res.ok) {
        setSaveError('Failed to save API key');
        return;
      }
      const updated = (await res.json()) as AIConfig | null;
      setConfig(updated);
      setApiKey('');
    } catch {
      setSaveError('Failed to save API key');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!orgId) return;
    setRemoving(true);
    try {
      await fetch(`${apiUrl}/api/v1/organizations/${orgId}/ai-settings`, {
        method: 'DELETE',
        credentials: 'include',
      });
      setConfig(null);
    } catch {
      // silent
    } finally {
      setRemoving(false);
    }
  }

  if (loading) {
    return (
      <main className="p-8 max-w-2xl">
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          Loading…
        </div>
      </main>
    );
  }

  return (
    <main className="p-8 max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
        <Link href={`/org/${slug}`} className="hover:text-gray-700">
          {slug}
        </Link>
        <span>/</span>
        <Link href={`/org/${slug}/settings/compensation`} className="hover:text-gray-700">
          Settings
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">AI</span>
      </div>

      <h1 className="text-2xl font-bold mb-1 mt-4">AI Settings</h1>
      <p className="text-gray-500 text-sm mb-6">
        Connect an AI provider API key to enable AI-powered features for your organisation.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">
          {error}
        </div>
      )}

      {!config && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 mb-6 text-sm">
          AI features are disabled for your organisation until an API key is configured.
        </div>
      )}

      {config && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 mb-6 text-sm flex items-center justify-between">
          <span>
            <strong>{PROVIDERS.find((p) => p.id === config.provider)?.label}</strong> key saved —
            updated {new Date(config.updatedAt).toLocaleDateString('fr-FR')}
          </span>
          <button
            onClick={() => void handleRemove()}
            disabled={removing}
            className="text-red-600 hover:text-red-800 font-medium text-sm ml-4 disabled:opacity-50"
          >
            {removing ? 'Removing…' : 'Remove key'}
          </button>
        </div>
      )}

      <form
        onSubmit={(e) => void handleSave(e)}
        className="bg-white border border-gray-200 rounded-xl p-6 space-y-5"
      >
        <div>
          <p className="text-sm font-medium text-gray-700 mb-3">Provider</p>
          <div className="space-y-2">
            {PROVIDERS.map((p) => (
              <label
                key={p.id}
                className={[
                  'flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors',
                  selectedProvider === p.id
                    ? 'border-red-400 bg-red-50'
                    : 'border-gray-200 hover:border-gray-300',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="provider"
                  value={p.id}
                  checked={selectedProvider === p.id}
                  onChange={() => setSelectedProvider(p.id)}
                  className="accent-red-600"
                />
                <div>
                  <p className="text-sm font-medium text-gray-800">{p.label}</p>
                  <p className="text-xs text-gray-500">{p.hint}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="apiKey">
            API Key
          </label>
          <input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config ? '••••••••  (leave blank to keep current key)' : 'sk-ant-…'}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
          />
        </div>

        {saveError && <p className="text-red-600 text-sm">{saveError}</p>}

        <button
          type="submit"
          disabled={saving || !apiKey.trim()}
          className="bg-red-700 hover:bg-red-800 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save API key'}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Add "AI" link to org settings navigation**

The settings nav is currently implicit (only one settings page: compensation). Since we're adding a second, we should add navigation to both pages. Add nav links to the compensation page and the new AI page.

In `apps/web-admin/app/org/[slug]/settings/compensation/page.tsx`, find the `<main>` opening tag and add breadcrumb nav after it:

Add after `<main className="p-8 max-w-4xl">` (adjust the className as appropriate):

```tsx
<div className="flex gap-4 mb-6 border-b border-gray-200">
  <Link
    href={`/org/${slug}/settings/compensation`}
    className="pb-2 text-sm font-medium border-b-2 border-red-600 text-red-700"
  >
    Compensation
  </Link>
  <Link
    href={`/org/${slug}/settings/ai`}
    className="pb-2 text-sm font-medium text-gray-500 hover:text-gray-700"
  >
    AI
  </Link>
</div>
```

Also add `import Link from 'next/link';` at the top of that file if not already present.

Similarly add the same nav block to the new AI settings page — but with the active tab being "AI".

- [ ] **Step 3: Typecheck web-admin**

```bash
cd apps/web-admin && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web-admin/app/org/[slug]/settings/
git commit -m "feat: add org AI settings page (T-1212)"
```

---

## Task 10: Frontend — Event Hub AI Budget Section

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/page.tsx`

- [ ] **Step 1: Add AI budget interfaces and fetch**

Read the current file, then make these additions to `apps/web-admin/app/org/[slug]/events/[eventId]/page.tsx`:

Add interface after existing interfaces:

```ts
interface AIConfig {
  provider: string;
  hasKey: true;
  updatedAt: string;
}

interface AIUsageSummary {
  totalSpendEur: number;
  cap: number | null;
  remainingEur: number | null;
  callCount: number;
}
```

Add state variables in the component (after existing state):

```ts
const [orgId, setOrgId] = useState<string | null>(null);
const [aiConfig, setAiConfig] = useState<AIConfig | null>(null);
const [aiUsage, setAiUsage] = useState<AIUsageSummary | null>(null);
const [spendCapInput, setSpendCapInput] = useState('');
const [savingCap, setSavingCap] = useState(false);
```

In the `useEffect` that fetches event data, extend to also fetch org AI config and AI usage:

```ts
Promise.all([
  fetch(`${apiUrl}/api/v1/events/${eventId}`, {
    credentials: 'include',
    signal: controller.signal,
  }),
  fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
    credentials: 'include',
    signal: controller.signal,
  }),
]).then(async ([evRes, tourRes]) => {
  if (evRes.ok) {
    const ev = (await evRes.json()) as EventInfo;
    setEvent(ev);
    // Fetch org AI config if we have the org data
    const orgRes = await fetch(`${apiUrl}/api/v1/events/${eventId}`, {
      credentials: 'include',
      signal: controller.signal,
    });
    // We need orgId — fetch from event's organization_id
    // The /events/:id endpoint returns organization_id
    const evData = ev as EventInfo & { organizationId?: string };
    if (evData.organizationId) {
      setOrgId(evData.organizationId);
      const [cfgRes, usageRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/organizations/${evData.organizationId}/ai-settings`, {
          credentials: 'include',
          signal: controller.signal,
        }),
        fetch(`${apiUrl}/api/v1/events/${eventId}/ai-usage`, {
          credentials: 'include',
          signal: controller.signal,
        }),
      ]);
      if (cfgRes.ok) setAiConfig((await cfgRes.json()) as AIConfig | null);
      if (usageRes.ok) setAiUsage((await usageRes.json()) as AIUsageSummary);
    }
  }
  if (tourRes.ok) setTournaments((await tourRes.json()) as Tournament[]);
});
```

Wait — looking at the current `EventInfo` interface, it doesn't have `organizationId`. We need to check what the events endpoint returns.

- [ ] **Step 2: Check what /api/v1/events/:id returns**

Open `apps/api/src/modules/events/events.service.ts` and find `getEventById`. The query selects `'*'` from events — so `organization_id` is returned as a snake_case field.

Update `EventInfo` interface to add `organizationId`:

```ts
interface EventInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
  startDate: string;
  endDate: string;
  location: string | null;
  organizationId?: string; // returned as organization_id by API, camelCased by NestJS
}
```

Note: NestJS with `@nestjs/platform-fastify` does NOT automatically camelCase snake_case keys by default. The raw Supabase data is returned as-is. Check if there's a transform interceptor — if not, the field will be `organization_id`. Use:

```ts
const evData = ev as EventInfo & { organization_id?: string };
const orgId = evData.organization_id ?? null;
```

- [ ] **Step 3: Add the AI budget section**

In the component's return JSX, after the existing sections grid and archive section, add:

```tsx
{
  aiConfig && (
    <section className="mt-6">
      <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">AI Budget</h2>
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        {/* Spend meter */}
        {aiUsage && (
          <div>
            {aiUsage.cap !== null ? (
              <>
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="text-gray-600">
                    €{aiUsage.totalSpendEur.toFixed(2)} used of €{aiUsage.cap.toFixed(2)} cap
                  </span>
                  <span className="text-gray-400 text-xs">
                    {aiUsage.callCount} call{aiUsage.callCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500 rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (aiUsage.totalSpendEur / aiUsage.cap) * 100).toFixed(1)}%`,
                    }}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-600">
                No cap set — €{aiUsage.totalSpendEur.toFixed(2)} spent
                {aiUsage.callCount > 0 && (
                  <span className="text-gray-400 ml-2 text-xs">
                    ({aiUsage.callCount} call{aiUsage.callCount !== 1 ? 's' : ''})
                  </span>
                )}
              </p>
            )}
          </div>
        )}

        {/* Spend cap input */}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="spendCap" className="block text-xs font-medium text-gray-600 mb-1">
              Spend cap (€, leave blank for no cap)
            </label>
            <input
              id="spendCap"
              type="number"
              min="0"
              step="0.01"
              value={spendCapInput}
              onChange={(e) => setSpendCapInput(e.target.value)}
              placeholder={aiUsage?.cap != null ? String(aiUsage.cap) : 'No cap'}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <button
            disabled={savingCap}
            onClick={() => {
              if (!eventId) return;
              setSavingCap(true);
              const capValue = spendCapInput.trim() === '' ? null : parseFloat(spendCapInput);
              fetch(`${apiUrl}/api/v1/events/${eventId}`, {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ aiSpendCapEur: capValue }),
              })
                .then(async (res) => {
                  if (res.ok) {
                    const usageRes = await fetch(`${apiUrl}/api/v1/events/${eventId}/ai-usage`, {
                      credentials: 'include',
                    });
                    if (usageRes.ok) setAiUsage((await usageRes.json()) as AIUsageSummary);
                  }
                })
                .catch(() => undefined)
                .finally(() => setSavingCap(false));
            }}
            className="bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {savingCap ? 'Saving…' : 'Save cap'}
          </button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Typecheck web-admin**

```bash
cd apps/web-admin && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web-admin/app/org/[slug]/events/[eventId]/page.tsx
git commit -m "feat: add AI budget section to event hub (T-1212)"
```

---

## Task 11: Docs — .env.example + ARCHITECTURE.md

**Files:**

- Modify: `.env.example`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Add AI_KEY_SECRET to .env.example**

Find the `.env.example` file at the repo root. Add this block after the existing env vars:

```env
# AI infrastructure — 32-byte hex secret for encrypting provider API keys
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
AI_KEY_SECRET=
```

- [ ] **Step 2: Add AI infrastructure section to ARCHITECTURE.md**

Open `docs/ARCHITECTURE.md` and add a new section (after the existing schedule section):

```markdown
## 16. AI Infrastructure Layer (T-1212)

Shared layer that all AI-powered features (NLQ, Recap, etc.) build on.

### ai-providers module (`apps/api/src/modules/ai-providers/`)

- **AIProvidersService** — stores/retrieves org API keys encrypted with AES-256-GCM (`AI_KEY_SECRET` env); exposes `generate(orgId, request)` which decrypts the key and delegates to the correct provider adapter.
- **Adapters** — Anthropic, OpenAI, Mistral each implement `ProviderAdapter.generate()`. Each normalises the SDK response into `GenerationResult { text, toolCall?, inputTokens, outputTokens, costEur }`. Tool-calling is supported for all three.
- **API** — `GET/PUT/DELETE /api/v1/organizations/:orgId/ai-settings`. Raw key never returned; only `{ provider, hasKey, updatedAt }`.

### ai-usage module (`apps/api/src/modules/ai-usage/`)

- **AIUsageService.generateWithCap(orgId, eventId, feature, request)** — checks `events.ai_spend_cap_eur`; if set, sums `ai_usage_log.cost_eur` for the event and throws HTTP 402 `SpendCapExceededException` when at/over cap. On success, logs the call to `ai_usage_log`.
- **API** — `GET /api/v1/events/:eventId/ai-usage` returns `{ totalSpendEur, cap, remainingEur, callCount }`.

### Database

- `organization_ai_settings` — one row per org; stores `api_key_enc` + `api_key_iv` (AES-256-GCM). RLS: org admin/owner only.
- `ai_usage_log` — one row per LLM call; indexed by event and org. RLS: org admin/owner read-only.
- `events.ai_spend_cap_eur NUMERIC(10,4)` — per-event soft spend limit; NULL = no cap.

### Frontend

- `/org/[slug]/settings/ai` — org-level provider selector + API key input (never shows raw key after save).
- Event hub — AI budget card (spend meter + cap input) shown when org has a key configured.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/ARCHITECTURE.md
git commit -m "docs: add AI infrastructure to ARCHITECTURE.md and .env.example (T-1212)"
```

---

## Self-Review Checklist

After completing all tasks, verify:

1. **Migration applies cleanly**: `organization_ai_settings`, `ai_usage_log` tables exist; `events.ai_spend_cap_eur` column present.
2. **Encrypt-decrypt round-trip**: `saveKey` then `generate` in tests passes with the original plaintext key.
3. **Spend cap enforcement**: `generateWithCap` throws 402 exactly at cap, passes below, skips check when cap is null.
4. **Usage log insertion**: `ai_usage_log` row inserted after each successful `generateWithCap` call.
5. **API key never returned**: `GET /ai-settings` returns `{ provider, hasKey, updatedAt }` — no `api_key_enc` or plaintext.
6. **All tests pass**: `cd apps/api && npx vitest run` — no failures.
7. **Typechecks pass**: `tsc --noEmit` on both `apps/api` and `apps/web-admin`.
8. **AI settings page loads**: Navigate to `/org/[slug]/settings/ai` — no-key banner shows when unset; provider selector + key input visible.
9. **Event hub AI card**: Only visible when org has an AI key; spend meter shows correct values; saving cap updates display.
