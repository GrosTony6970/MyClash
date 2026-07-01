# Spec: AI Infrastructure Layer — 2026-05-08

## Context

MyClash needs a shared AI infrastructure layer before any AI-powered features (Natural-Language Query, Recap Generator, etc.) can be built. This layer provides: LLM provider abstraction, encrypted BYOK API key storage at org level, per-event spend caps, and settings UI. It is a prerequisite — no AI feature ships without it.

---

## Decisions Made

- **Providers (v1):** Anthropic, OpenAI, Mistral (Ollama deferred)
- **Key scope:** Organisation-level — one API key per provider per org, shared across all events
- **Spend cap scope:** Per-event — each event has its own EUR cap; NULL = no cap
- **Architecture:** Two NestJS modules — `ai-providers` (key storage + generation abstraction) and `ai-usage` (spend tracking + cap enforcement)
- **Settings UI:** Provider + key at `/org/[slug]/settings/ai`; spend cap in the event hub page

---

## Section 1 — Database (migration `0029_ai_infrastructure.sql`)

### New table: `organization_ai_settings`

```sql
CREATE TABLE organization_ai_settings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  provider         TEXT        NOT NULL CHECK (provider IN ('anthropic','openai','mistral')),
  api_key_enc      TEXT        NOT NULL,   -- AES-256-GCM ciphertext (base64)
  api_key_iv       TEXT        NOT NULL,   -- IV (base64)
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
```

### New table: `ai_usage_log`

```sql
CREATE TABLE ai_usage_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature          TEXT        NOT NULL,   -- 'nlq' | 'recap' | etc.
  input_tokens     INTEGER     NOT NULL DEFAULT 0,
  output_tokens    INTEGER     NOT NULL DEFAULT 0,
  cost_eur         NUMERIC(10,6) NOT NULL DEFAULT 0,
  called_at        TIMESTAMPTZ NOT NULL DEFAULT now()
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
```

### Alter `events` table

```sql
ALTER TABLE events ADD COLUMN ai_spend_cap_eur NUMERIC(10,4) DEFAULT NULL;
```

---

## Section 2 — `ai-providers` NestJS Module

**Location:** `apps/api/src/modules/ai-providers/`

### Files

```
ai-providers.module.ts
ai-providers.service.ts       — public API: saveKey, deleteKey, getConfig, generate
ai-providers.controller.ts    — GET/PUT/DELETE /orgs/:orgId/ai-settings
dto/ai-settings.dto.ts
adapters/
  anthropic.adapter.ts
  openai.adapter.ts
  mistral.adapter.ts
  provider-adapter.interface.ts
```

### Types

```ts
export type AIProvider = 'anthropic' | 'openai' | 'mistral';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface GenerationRequest {
  system: string;
  user: string;
  model: string;
  maxTokens: number;
  temperature: number;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'required';
  examples?: { user: string; assistant: string }[];
}

export interface GenerationResult {
  text: string;
  toolCall?: { name: string; arguments: Record<string, unknown> };
  inputTokens: number;
  outputTokens: number;
  costEur: number;
}
```

### `AIProvidersService` public API

```ts
saveKey(orgId: string, provider: AIProvider, rawKey: string): Promise<void>
deleteKey(orgId: string): Promise<void>
getProviderConfig(orgId: string): Promise<{ provider: AIProvider; hasKey: true } | null>
generate(orgId: string, request: GenerationRequest): Promise<GenerationResult>
```

`generate()` resolves the org's provider and key, decrypts the key, selects the correct adapter, calls the provider API, and returns a normalised `GenerationResult`.

### Encryption

AES-256-GCM using Node `crypto`. Secret key derived from env var `AI_KEY_SECRET` (32-byte hex string, required at startup — module init throws if absent). IV is randomly generated per save, stored alongside ciphertext.

### Provider adapters

Each adapter implements:

```ts
interface ProviderAdapter {
  generate(apiKey: string, request: GenerationRequest): Promise<GenerationResult>;
}
```

- **AnthropicAdapter** — `@anthropic-ai/sdk`; maps `tools` to Anthropic `tools[]`; handles `stop_reason: 'tool_use'`
- **OpenAIAdapter** — `openai` SDK; maps `tools` to OpenAI `tools[]`; handles `finish_reason: 'tool_calls'`
- **MistralAdapter** — `@mistralai/mistralai` SDK; same translation pattern

Cost calculation per adapter uses the provider's published token prices (hardcoded per model, updated with model metadata).

### API endpoints

```
GET    /api/v1/organizations/:orgId/ai-settings   → { provider, hasKey, updatedAt } | null
PUT    /api/v1/organizations/:orgId/ai-settings   → { provider, hasKey }             (saves encrypted key)
DELETE /api/v1/organizations/:orgId/ai-settings   → 204                              (removes key + row)
```

Raw API key is **never** returned. Requires org owner/admin role.

---

## Section 3 — `ai-usage` NestJS Module

**Location:** `apps/api/src/modules/ai-usage/`

### Files

```
ai-usage.module.ts
ai-usage.service.ts     — generateWithCap, getUsageSummary
ai-usage.controller.ts  — GET /events/:eventId/ai-usage
```

### `AIUsageService` public API

```ts
// Called by NLQ, Recap, etc. — wraps AIProvidersService.generate() with guards
generateWithCap(
  orgId: string,
  eventId: string,
  feature: string,
  request: GenerationRequest,
): Promise<GenerationResult>

getUsageSummary(eventId: string): Promise<{
  totalSpendEur: number;
  cap: number | null;
  remainingEur: number | null;
  callCount: number;
}>
```

`generateWithCap()` logic:

1. Load `events.ai_spend_cap_eur` for the event.
2. If cap is set: `SELECT SUM(cost_eur) FROM ai_usage_log WHERE event_id = ?`. If `sum >= cap`, throw `SpendCapExceededException` (HTTP 402).
3. Call `AIProvidersService.generate()`.
4. Insert one row into `ai_usage_log`.
5. Return result.

### API endpoint

```
GET /api/v1/events/:eventId/ai-usage   → { totalSpendEur, cap, remainingEur, callCount }
```

Requires org admin role.

### Spend cap field on events

`aiSpendCapEur?: number | null` added to the existing `UpdateEventDto`. The existing `PATCH /api/v1/events/:id` endpoint persists it — no new endpoint.

---

## Section 4 — Frontend

### Org AI settings — new page

**Route:** `apps/web-admin/app/org/[slug]/settings/ai/page.tsx`

Layout mirrors `/settings/compensation/page.tsx` pattern.

Content:

- Provider selector (radio: Anthropic / OpenAI / Mistral) with brief model hint per option
- API key input (password field) — shows masked placeholder "Key saved (updated Jan 1)" if key exists
- "Remove key" button (only shown when key exists)
- Save button → `PUT /api/v1/orgs/:orgId/ai-settings`
- If no key saved: info banner "AI features are disabled for your organisation until an API key is configured"

**Navigation:** add "AI" link to the org settings navigation alongside the existing "Compensation" link. The settings nav lives in whatever shared layout wraps `/settings/**` — identify at implementation time.

### Event hub — AI budget section

**File:** `apps/web-admin/app/org/[slug]/events/[eventId]/page.tsx`

Add a collapsible "AI budget" card to the existing event hub, shown only when the org has an AI key configured:

- "Spend cap (€)" number input (empty = no cap) → saved via `PATCH /events/:eventId`
- Read-only spend meter: "€2.40 used of €5.00 cap" with a progress bar, or "No cap set — €2.40 spent"
- Reads from `GET /api/v1/events/:eventId/ai-usage`

---

## Section 5 — Environment Variables

Add to `.env.example`:

```
# AI infrastructure — 32-byte hex secret for encrypting provider API keys
AI_KEY_SECRET=
```

Module init in `AIProvidersService` throws `Error('AI_KEY_SECRET env var is required')` if absent.

---

## Section 6 — Files to Create / Modify

| File                                                                       | Action                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------- |
| `packages/db/migrations/0029_ai_infrastructure.sql`                        | Create                                             |
| `apps/api/src/modules/ai-providers/ai-providers.module.ts`                 | Create                                             |
| `apps/api/src/modules/ai-providers/ai-providers.service.ts`                | Create                                             |
| `apps/api/src/modules/ai-providers/ai-providers.controller.ts`             | Create                                             |
| `apps/api/src/modules/ai-providers/dto/ai-settings.dto.ts`                 | Create                                             |
| `apps/api/src/modules/ai-providers/adapters/provider-adapter.interface.ts` | Create                                             |
| `apps/api/src/modules/ai-providers/adapters/anthropic.adapter.ts`          | Create                                             |
| `apps/api/src/modules/ai-providers/adapters/openai.adapter.ts`             | Create                                             |
| `apps/api/src/modules/ai-providers/adapters/mistral.adapter.ts`            | Create                                             |
| `apps/api/src/modules/ai-usage/ai-usage.module.ts`                         | Create                                             |
| `apps/api/src/modules/ai-usage/ai-usage.service.ts`                        | Create                                             |
| `apps/api/src/modules/ai-usage/ai-usage.controller.ts`                     | Create                                             |
| `apps/api/src/modules/ai-usage/spend-cap.exception.ts`                     | Create                                             |
| `apps/api/src/app.module.ts`                                               | Modify — register AIProvidersModule, AIUsageModule |
| `apps/api/src/modules/events/dto/events.dto.ts`                            | Modify — add `aiSpendCapEur` to UpdateEventDto     |
| `apps/api/src/modules/events/events.service.ts`                            | Modify — persist `ai_spend_cap_eur`                |
| `apps/web-admin/app/org/[slug]/settings/ai/page.tsx`                       | Create                                             |
| `apps/web-admin/app/org/[slug]/events/[eventId]/page.tsx`                  | Modify — add AI budget section                     |
| `.env.example`                                                             | Modify — add `AI_KEY_SECRET`                       |
| `docs/ARCHITECTURE.md`                                                     | Modify — add AI infrastructure section             |

---

## Section 7 — Testing Notes

- Unit test `AIProvidersService`: encrypt → store → retrieve → decrypt round-trip
- Unit test each adapter with a mocked SDK client: tool call response parsing, cost calculation
- Unit test `AIUsageService.generateWithCap()`: under cap passes, at-cap throws `SpendCapExceededException`, NULL cap always passes
- Integration test spend log insertion after successful generation
