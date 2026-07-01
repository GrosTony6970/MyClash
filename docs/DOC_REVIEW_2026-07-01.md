# Documentation Review — 2026-07-01

> Consolidated findings from a full audit of every project-owned markdown doc against the current code on `main`. Each finding was produced by a per-cluster reviewer agent and then independently **adversarially verified** (an agent tasked to refute it against the live tree) before being recorded here.

**Provenance:** automated multi-agent audit (38 agents across 19 doc clusters) → adversarial verification. **73 findings CONFIRMED**, 1 refuted. Ground truth: NestJS 11 / Fastify API, Next.js 16.2.6 / React 19 apps, 9 shared packages, ~120 Drizzle migrations (latest `0120`), 14-service Docker/Traefik/Supabase stack.

## Summary

| Severity  | Count  |
| --------- | ------ |
| High      | 20     |
| Medium    | 32     |
| Low       | 21     |
| **Total** | **73** |

| Type          | Count |
| ------------- | ----- |
| staleness     | 47    |
| inconsistency | 17    |
| contradiction | 7     |
| minor         | 2     |

**Root cause:** the docs lagged five feature waves shipped in June 2026 — People Hub / directory groups, org-owner Leagues (Classement), AI model registry + consumption dashboard, streaming organizer chatbot + generated-content subsystem, and lossless archive export — plus stack version bumps (NestJS 10→11, Next 15→16, Postgres 16→17, Redis 7→8, Node/pnpm engines).

### Files by finding count

| File                                                                         | Findings |
| ---------------------------------------------------------------------------- | -------- |
| `docs/ARCHITECTURE.md`                                                       | 24       |
| `myclash.md`                                                                 | 6        |
| `CONTRIBUTING.md`                                                            | 5        |
| `docs/BUILD_ORDER.md`                                                        | 4        |
| `docs/superpowers/plans/2026-05-20-pools-overhaul.md`                        | 4        |
| `docs/GOLDEN_PATHS.md`                                                       | 3        |
| `docs/superpowers/plans/2026-05-20-tournament-config-wizard-and-settings.md` | 3        |
| `memory/MEMORY.md`                                                           | 3        |
| `docs/PRE_DEPLOY_CHECKLIST.md`                                               | 2        |
| `docs/INFRASTRUCTURE_REVIEW.md`                                              | 2        |
| `docs/superpowers/plans/2026-05-08-ai-infrastructure.md`                     | 2        |
| `docs/superpowers/specs/2026-05-28-configure-tab-horizontal-pools-design.md` | 2        |
| `README.md`                                                                  | 1        |
| `AGENTS.md`                                                                  | 1        |
| `docs/OWNER_TASKS.md`                                                        | 1        |
| `docs/decisions/ADR-004-domain.md`                                           | 1        |
| `docs/superpowers/plans/2026-05-28-inline-club-create-on-add-participant.md` | 1        |
| `docs/superpowers/plans/2026-05-28-configure-tab-horizontal-pools.md`        | 1        |
| `docs/superpowers/plans/2026-05-28-bracket-card-thickness.md`                | 1        |
| `docs/superpowers/specs/2026-05-19-consistent-backups-design.md`             | 1        |
| `docs/superpowers/specs/2026-05-17-league-management-design.md`              | 1        |
| `docs/superpowers/specs/2026-05-28-bracket-card-thickness-design.md`         | 1        |
| `docs/superpowers/specs/2026-05-20-pools-overhaul-design.md`                 | 1        |
| `apps/web-marketing/README.md`                                               | 1        |
| `tests/e2e/README.md`                                                        | 1        |

## Findings by file

### `docs/ARCHITECTURE.md` (24)

**1. [HIGH · staleness] §3.1 Decisions — Frontend row**

- **Doc says:** Frontend (all PWAs) | **Next.js 15** (App Router) + TypeScript + Tailwind + shadcn/ui
- **Reality:** All three Next apps run Next.js 16.2.6, not 15. apps/web-admin/package.json line 26: "next": "16.2.6" (same in web-public/web-scoring package.json).
- **Fix:** Change "Next.js 15" to "Next.js 16" (16.2.6) in the §3.1 Frontend row.

**2. [HIGH · staleness] §3.1 Decisions — Backend row**

- **Doc says:** Backend | **NestJS 10** + TypeScript
- **Reality:** API runs NestJS 11. apps/api/package.json lines 27-29: @nestjs/core / @nestjs/common / @nestjs/platform-fastify are all ^11.1.19.
- **Fix:** Change "NestJS 10" to "NestJS 11" in the §3.1 Backend row.

**3. [HIGH · staleness] §5 Data Model / §5.2 Key tables**

- **Doc says:** §5's ER overview and §5.2 table sketch enumerate the schema but include no leagues, directory_groups, generated_content, or fighter_ai_settings tables.
- **Reality:** These tables all exist as shipped migrations: leagues (packages/db/migrations/0015_leagues.sql), league_organization_roles/league_user_roles (0015 + 0069), directory_groups + directory_group_members (0114_directory_groups.sql), generated_content (0119_generated_content.sql), fighter_ai_settings (0120_fighter_ai_settings.sql).
- **Fix:** Add the leagues/classement, directory-groups, generated_content, and fighter_ai_settings tables to the §5 data model (or add a note that §5.2 is a non-exhaustive sketch and point to the June 2026 feature-wave tables).

**4. [HIGH · inconsistency] §7.2 Built-in rulesets shipped at v1.0**

- **Doc says:** **TF_v1_no_afterblow** — variant without afterblow concept (pure first-hit).
- **Reality:** No such ruleset is implemented or registered. packages/rulesets/src only ships tf_v1 (code: 'TF_v1') and generic_points_cap (code: 'Generic_PointsCap'); grep for 'no_afterblow'/'TF_v1_no' in packages/rulesets/src returns nothing, and src/index.ts exports only TF_v1 and Generic_PointsCap.
- **Fix:** Remove the TF_v1_no_afterblow bullet from §7.2 (or mark it as planned/not-yet-shipped) so the list matches the two rulesets actually registered.

**5. [HIGH · contradiction] §14.2 Endpoint inventory — # Following**

- **Doc says:** DELETE /api/v1/follows/:followId and PATCH /api/v1/follows/:followId (both [guest|claimed], PATCH body { notify_match_start, ... }) — unfollow/update a follow addressed by a global followId.
- **Reality:** apps/api/src/modules/follows/follows.controller.ts registers event-scoped routes keyed by personId, not a flat followId: DELETE events/:eventId/follows/:personId and PATCH events/:eventId/follows/:personId. The PATCH body schema is { notifyMatchStart, notifyWorkshopStart } (camelCase), not notify_match_start. No /follows/:followId route exists anywhere.
- **Fix:** Replace the two lines with `DELETE /api/v1/events/:eventId/follows/:personId` and `PATCH /api/v1/events/:eventId/follows/:personId` (body: { notifyMatchStart, notifyWorkshopStart }) to match follows.controller.ts.

**6. [HIGH · staleness] §14.2 Endpoint inventory — # Following**

- **Doc says:** The Following section lists only event-scoped GET/POST/DELETE/PATCH follows endpoints; no cross-event /me/follows routes are documented.
- **Reality:** follows.controller.ts also exposes GET me/follows, POST me/follows/by-global-person (body { globalPersonId }), and DELETE me/follows/by-global-person/:globalPersonId — the People Hub cross-event follow-by-global-person feature. None appear in §14.
- **Fix:** Add the /me/follows and /me/follows/by-global-person[/:globalPersonId] routes to the Following block of §14.2.

**7. [HIGH · staleness] §14.2 Endpoint inventory (whole block)**

- **Doc says:** The endpoint inventory has no section for directory groups (People Hub), no leagues/Classement routes, and no AI model/usage routes.
- **Reality:** Live controllers add: directory-groups.controller.ts (GET/POST me/groups, PATCH/DELETE me/groups/:groupId, POST me/groups/:groupId/members, DELETE me/groups/:groupId/members/:globalPersonId); leagues.controller.ts + league-membership-requests.controller.ts (GET organizations/:orgId/leagues, GET leagues, GET leagues/:slug, and a large admin/leagues/\* surface); ai-models.controller.ts (GET ai/models); ai-providers.controller.ts (GET/PUT/DELETE organizations/:orgId/ai-settings); ai-dashboard.controller.ts (GET organizations/:orgId/ai-usage/summary, PATCH organizations/:orgId/ai-settings/{budget,flags}); ai-usage.controller.ts (GET events/:eventId/ai-usage).
- **Fix:** Add # Directory groups (/me/groups/_), # Leagues (/organizations/:orgId/leagues, /leagues/_, /admin/leagues/\*), and # AI (GET /ai/models, /organizations/:orgId/ai-settings, /organizations/:orgId/ai-usage/summary, /events/:eventId/ai-usage) blocks to §14.2.

**8. [HIGH · inconsistency] §16 Internationalization — Library**

- **Doc says:** Lists packages/i18n/src/en.ts (English source), packages/i18n/src/fr.ts (`fr = en` alias pattern), packages/i18n/src/index.ts (t + DeepString), and packages/i18n/src/I18nProvider.tsx (React provider).
- **Reality:** packages/i18n/src contains only index.ts (plus test files). There are no en.ts or fr.ts files — `en` and `fr` are defined inline as full literal objects in index.ts (en at line 10, fr at line 5471, a complete separate object, not an `fr = en` alias). I18nProvider.tsx does not live in the package; it is duplicated per app at apps/{web-public,web-admin,web-scoring}/src/i18n/I18nProvider.tsx.
- **Fix:** Rewrite the Library bullet list: en/fr are inline `export const en`/`export const fr` objects in packages/i18n/src/index.ts (fr is a full translation, not an alias); DeepString<T> and t live in index.ts; I18nProvider.tsx is per-app under apps/\*/src/i18n/.

**9. [HIGH · contradiction] §16 Internationalization — Locale routing**

- **Doc says:** "Locale is currently hardcoded to `fr` for the French-first audience" and each app wraps its root layout with `<I18nProvider locale={defaultLocale}>`.
- **Reality:** packages/i18n/src/index.ts sets `export const defaultLocale: Locale = 'en'`. apps/web-public/app/layout.tsx renders `<html lang={defaultLocale}>` (= en) and `<I18nProvider>` with NO locale prop. Locale is en, not fr, and the provider is not passed a locale prop.
- **Fix:** Change to state defaultLocale is 'en' (EN is the source/default), and that I18nProvider is used without an explicit locale prop; drop the 'hardcoded to fr' claim.

**10. [MEDIUM · staleness] §3.1 Decisions — Database row**

- **Doc says:** Database | **PostgreSQL 16** (via Supabase)
- **Reality:** Prod DB image is Postgres 17. infra/docker-compose.prod.yml line 80: image: supabase/postgres:17.6.1.121-mg-1. §4.1 of the same doc already says "Postgres 17", contradicting §3.1.
- **Fix:** Change "PostgreSQL 16" to "PostgreSQL 17" in the §3.1 Database row to match §4.1 and prod compose.

**11. [MEDIUM · staleness] §3.1 Decisions — Cache + pub/sub row**

- **Doc says:** Cache + pub/sub | **Redis 7**
- **Reality:** Prod uses Redis 8. infra/docker-compose.prod.yml line 111: image: redis:8-alpine3.23. §4.1 already says "Redis 8", contradicting §3.1.
- **Fix:** Change "Redis 7" to "Redis 8" in the §3.1 Cache row to match §4.1 and prod compose.

**12. [MEDIUM · inconsistency] §5.2 Key tables (sketch — full DDL in `packages/db/schema.ts`)**

- **Doc says:** Key tables (sketch — full DDL in `packages/db/schema.ts`)
- **Reality:** There is no packages/db/schema.ts. The Drizzle schema lives in the directory packages/db/src/schema/ (packages/db/src/ contains client.ts, index.ts, schema/).
- **Fix:** Update the pointer from `packages/db/schema.ts` to `packages/db/src/schema/`.

**13. [MEDIUM · inconsistency] §8.2 Computation strategy — Materializes**

- **Doc says:** Materializes: `mv_fighter_exchange_stats` (per-fighter, per-event); `mv_event_stats_summary` (event-level aggregates); `mv_event_stats_summary` (event-level).
- **Reality:** No materialized view named mv_event_stats_summary exists in any migration (grep across packages/db/migrations finds only mv_fighter_exchange_stats). Event-level stats come from a plain view vw_event_stats (referenced by 0080_missing_fk_indexes.sql, created in 0010_stats_views.sql). The bullet is also duplicated verbatim.
- **Fix:** Replace the duplicated `mv_event_stats_summary` bullets with the actual object name (view `vw_event_stats`) and drop the duplicate line.

**14. [MEDIUM · staleness] §16 Internationalization — ESLint enforcement**

- **Doc says:** Custom no-literal-string rule in eslint-rules/no-literal-string.js.
- **Reality:** The file is eslint-rules/no-literal-string.mjs (ESM), not .js. eslint-rules/ contains no-literal-string.mjs and i18n-baseline.json.
- **Fix:** Update the path to eslint-rules/no-literal-string.mjs.

**15. [MEDIUM · staleness] §15.1 web-public routes**

- **Doc says:** §15.1 lists only /fighters, /clubs and /e/[eventSlug]/_ routes for web-public; no personal-space /me/_ route tree is documented.
- **Reality:** apps/web-public/app/me/ contains a full personal-space tree: /me, /me/profile, /me/security, /me/settings, /me/notifications, /me/fighter, /me/referee, /me/follows, /me/leagues, /me/leagues/[slug], /me/events, /me/events/[eventSlug]/{overview,schedule,workshops,t/[tournamentSlug]}, /me/claim-confirm. None are listed.
- **Fix:** Add a # Personal space (/me/_) block to §15.1 enumerating the shipped /me routes (profile, security, settings, notifications, follows, leagues, events/[eventSlug]/_, etc.).

**16. [MEDIUM · staleness] §15.3 web-admin routes**

- **Doc says:** The Organizer route block lists no leagues routes, and the Super Admin block lists /admin/rulesets etc. but no /admin/leagues.
- **Reality:** apps/web-admin/app has org-owner leagues routes /org/[slug]/leagues and /org/[slug]/leagues/[leagueId] (plus /org/[slug]/events/[eventId]/leagues), and a super-admin /admin/leagues tree (/admin/leagues, /admin/leagues/new, /admin/leagues/[id]/{edit,ranking,requests}, /admin/leagues/scoring-systems/\*).
- **Fix:** Add /org/[slug]/leagues[/**] to the Organizer block and /admin/leagues[/**] to the Super Admin block of §15.3.

**17. [MEDIUM · staleness] §18 Repository Structure — packages/ tree**

- **Doc says:** The packages/ tree lists 8 workspaces: ui, design-tokens, db, rulesets, feature-flags, types, api-client, i18n.
- **Reality:** There are 9 shared packages. `packages/time/` exists (packages/time/package.json present via Glob of packages/\*/package.json) but is entirely absent from the §18 tree.
- **Fix:** Add `│   └── time/                    # @myclash/time — shared time/date helpers` to the packages/ block in §18 (making i18n non-last).

**18. [MEDIUM · inconsistency] §17.1 Service inventory — web-marketing row**

- **Doc says:** web-marketing | myclash-web-marketing | Built from apps/web-marketing/Dockerfile | 'Static HTML on nginx, port 80.'
- **Reality:** apps/web-marketing/Dockerfile is `FROM caddy:2-alpine` and serves via a generated Caddyfile — not nginx. (The Dockerfile header comment: 'Minimal static site served by Caddy.')
- **Fix:** Change 'Static HTML on nginx, port 80' to 'Static HTML on Caddy, port 80' in the §17.1 web-marketing row (and align §2.5 which also says nginx).

**19. [MEDIUM · staleness] §18 Repository Structure — scripts/ tree**

- **Doc says:** The scripts/ (cross-platform Node) block lists rollback.ts (`pnpm rollback:prod` wrapper), seed.ts (seed dev data), and import-fal2026.ts (FAL 2026 golden-test fixture import).
- **Reality:** None of these exist. `ls scripts/rollback.ts scripts/seed.ts scripts/import-fal2026.ts` all return 'No such file or directory'. The scripts/ dir instead contains deploy.ts, gen-api-client.ts, gen-ffamhe-penalty-seed.ts, seed-min.ts, and many \*.mjs check scripts.
- **Fix:** Remove/replace the stale rollback.ts, seed.ts, and import-fal2026.ts entries; list the actual scripts (deploy.ts, seed-min.ts, gen-api-client.ts, gen-ffamhe-penalty-seed.ts, etc.).

**20. [MEDIUM · staleness] §21 AGENTS — Hard rules #2**

- **Doc says:** 'The TF_v1 implementation must reproduce the FAL 2026 reference data byte-for-byte. A failing snapshot test against scripts/import-fal2026.ts data is a red flag...'
- **Reality:** scripts/import-fal2026.ts does not exist (verified via ls). The FAL golden-test fixture importer named here is gone.
- **Fix:** Point hard-rule #2 at the actual golden-test fixture path (e.g. the current seed/fixture importer) or drop the specific filename.

**21. [MEDIUM · staleness] §21 AGENTS — Workflow step 1**

- **Doc says:** Workflow step 1: 'Pick a task from the milestone in docs/ROADMAP.md.'
- **Reality:** docs/ROADMAP.md does not exist (ls returns 'No such file or directory'). The roadmap lives in §19 of this file and the task list is docs/BUILD_ORDER.md, which does exist.
- **Fix:** Change the reference from docs/ROADMAP.md to docs/BUILD_ORDER.md (or §19 of ARCHITECTURE.md).

**22. [LOW · inconsistency] §13.2 URL shape**

- **Doc says:** Event URL shapes: /e/{slug}/t/{tournament-slug}, /e/{slug}/m/{match-id}, /e/{slug}/l/{lice-name}, /e/{slug}/f/{fighter-slug}.
- **Reality:** Actual route dirs under apps/web-public/app/e/[eventSlug]/ are t/, match/, lice/ (and fighter-in-event is fighters/[fighterSlug] per §15, not /f/). The short /m/, /l/, /f/ forms do not exist; §13.2 contradicts §15.1 which correctly uses /match/[matchId] and /lice/[liceName].
- **Fix:** Align §13.2 with the real routes: /e/{slug}/match/{matchId}, /e/{slug}/lice/{liceName}, /e/{slug}/fighters/{fighterSlug} (or delete §13.2's URL list and reference §15.1).

**23. [LOW · staleness] §21 AGENTS — When you don't know**

- **Doc says:** 'For UI ambiguity, refer to the prototype (docs/prototype.html) — the design system is canonical.'
- **Reality:** docs/prototype.html does not exist. There is a `docs/prototype/` directory instead (contains README.md).
- **Fix:** Update the path from docs/prototype.html to the docs/prototype/ directory.

**24. [LOW · staleness] §18 Repository Structure — docs/ tree**

- **Doc says:** The docs/ block lists ARCHITECTURE.md, BUILD_ORDER.md, OWNER_TASKS.md, RULESETS.md, DEPLOYMENT.md, RUNBOOK.md, CONTRIBUTING.md.
- **Reality:** RULESETS.md, DEPLOYMENT.md, RUNBOOK.md, and CONTRIBUTING.md do not exist under docs/ (ls errors on all four). Actual docs/ holds HIERARCHY.md, GOLDEN_PATHS.md, DISASTER_RECOVERY.md, PRE_DEPLOY_CHECKLIST.md, plus several \*\_REVIEW.md files and decisions/, notes/, prototype/, ux/ dirs.
- **Fix:** Replace the non-existent RULESETS.md/DEPLOYMENT.md/RUNBOOK.md/CONTRIBUTING.md entries with the docs that actually exist (HIERARCHY.md, GOLDEN_PATHS.md, DISASTER_RECOVERY.md, PRE_DEPLOY_CHECKLIST.md, etc.).

### `myclash.md` (6)

**1. [HIGH · staleness] Features (v1) → For event organizers (lines 26-41)**

- **Doc says:** The organizer feature list (create themed site, events, Lices, registration/CSV, pool populator, referee assignment, AI setup assistant, natural-language query, brackets, forfeits, scheduling, workshops, notifications, publish results + export to CSV/JSON/PDF/HEMA Ratings) — with no mention of Leagues / Classement.
- **Reality:** A full org-owner Leagues/Classement subsystem is shipped. apps/api/src/modules/leagues/leagues.controller.ts exposes ~40 routes incl. GET organizations/:orgId/leagues, POST/GET/DELETE admin/leagues/:leagueId/organization-roles and .../user-roles, league standings, recompute, and public final-report.csv/print.html. Tables leagues, league_organization_roles, league_user_roles exist (migrations 0015_leagues.sql, plus 0048/0068/0069/0087/0089). Web-admin UI at apps/web-admin/app/org/[slug]/leagues/page.tsx and .../[leagueId]/page.tsx, and personal view apps/web-public/app/me/leagues.
- **Fix:** Add a Leagues/Classement bullet(s) to the organizer feature list: org-owner-managed multi-tournament league standings with per-league organization/user roles, tournament/event linking + membership requests, recompute, and public final-report (CSV + printable) export, surfaced in web-admin /org/[slug]/leagues.

**2. [HIGH · staleness] Features (v1) / Key components (lines 34-35, 147-163)**

- **Doc says:** AI surface is described as three things only: an 'AI setup assistant' (BYOK draft-and-review), a 'natural-language tournament query', and (Key components table) an 'AI data-quality assistant'. No AI model registry, no consumption/spend dashboard.
- **Reality:** A multi-provider AI model registry and a consumption/budget dashboard are shipped. apps/api/src/modules/ai-providers/model-registry.ts + adapters/{anthropic,openai,mistral}.adapter.ts + ai-models.controller.ts provide provider/model selection; apps/api/src/modules/ai-usage/ai-dashboard.controller.ts exposes GET :orgId/ai-usage/summary and PATCH :orgId/ai-settings/{budget,flags} (spend-cap.exception.ts, budget-exceeded.exception.ts). Migrations 0115_ai_settings_model.sql, 0117_ai_usage_dashboard.sql, 0118_org_ai_flags.sql.
- **Fix:** Add features/components for the AI model registry (per-org provider + model selection across Anthropic/OpenAI/Mistral adapters) and the AI consumption/budget dashboard (per-org usage summary, budget caps + spend-cap enforcement, feature flags).

**3. [MEDIUM · staleness] Features (v1) → For spectators / accompanists (lines 72-81)**

- **Doc says:** "Follow people to build a personal watchlist ... Watchlist view shows next-match / live-now / just-finished state for everyone you follow" — describing only a flat per-event follow/watchlist.
- **Reality:** A cross-event People Hub with named directory groups is shipped. apps/api/src/modules/directory-groups/directory-groups.controller.ts exposes GET/POST/PATCH/DELETE me/groups and me/groups/:groupId/members (organize followed global persons into named, reorderable groups with per-group stats); apps/api/src/modules/follows/follows.controller.ts adds POST me/follows/by-global-person (cross-event follow by global person). Tables directory_groups + directory_group_members (migration 0114_directory_groups.sql). Web-public surfaces at /me/follows and /me groups.
- **Fix:** Update the spectator/personal section to describe the People Hub: a persistent, cross-event personal directory where users follow people by global identity and organize them into named groups (e.g. a coach's students), with per-group next-match/live status — not just a per-event watchlist.

**4. [MEDIUM · staleness] Features (v1) / Key components (AI assistant rows, lines 34, 161)**

- **Doc says:** Organizer AI is described only as a 'draft-and-review' setup assistant and a read-only NL query panel; no conversational chatbot and no streaming.
- **Reality:** A streaming organizer chatbot is shipped: apps/api/src/modules/organizer-chat/organizer-chat.controller.ts exposes POST conversations/:conversationId/messages/stream with SSE (Content-Type text/event-stream, X-Accel-Buffering: no) and a tools service (organizer-chat.tools.service.ts). Migration 0116_organizer_chat.sql.
- **Fix:** Add an 'Organizer chatbot' item: a conversational, tool-using organizer assistant that streams assistant progress over SSE, distinct from the one-shot setup-draft assistant and the NL query panel.

**5. [MEDIUM · staleness] Features (v1) (organizer + competitor sections)**

- **Doc says:** No mention of AI-generated publishable content (tournament recaps, fighter performance insights) or fighter self-service AI.
- **Reality:** A generated-content subsystem is shipped. apps/api/src/modules/generated-content/generated-content.controller.ts exposes POST :type/:entityId/generate and publish/unpublish; types/{tournament-recap,organizer-content,fighter-insight}.type.ts. me-ai.controller.ts lets a fighter save their own BYOK AI key and generate/publish a personal performance 'insight' (GET/POST me insight[/generate|/publish|/unpublish], GET/PUT me ai-settings). Migrations 0119_generated_content.sql and 0120_fighter_ai_settings.sql.
- **Fix:** Add a generated-content feature: AI-generated, publishable tournament recaps / organizer content / fighter performance insights, plus fighter-level BYOK AI keys so competitors can generate and publish their own performance insight.

**6. [MEDIUM · staleness] Features (v1) → For event organizers, publish/export bullet (line 41)**

- **Doc says:** "Publish results, rich statistics, and export to CSV/JSON/PDF/HEMA Ratings format."
- **Reality:** Beyond flat exports there is a lossless archive export + restore round-trip. apps/api/src/modules/exports/exports.controller.ts exposes GET events/:eventId/archive and tournaments/:tournamentId/archive (ArchiveService), round-trippable full.json, plus POST archive/restore-preview and restore endpoints (backed by ArchiveService/archive.types). This backup/migrate capability is absent from the doc.
- **Fix:** Extend the export bullet to mention the lossless event/tournament archive export + restore round-trip (round-trippable JSON archive with restore-preview) as a distinct backup/migration feature, alongside the CSV/JSON/PDF/HEMA-Ratings exports.

### `CONTRIBUTING.md` (5)

**1. [HIGH · staleness] Development setup — code block, line 32**

- **Doc says:** # Prerequisites: Node 20+, pnpm 9+, Docker Desktop
- **Reality:** Root package.json engines requires node >=26.0.0 and pnpm >=10.27.0 (lines 13-16), packageManager pnpm@10.27.0 (line 12). CI (.github/workflows/ci.yml lines 14-15) pins NODE_VERSION '26', PNPM_VERSION '10.27.0'.
- **Fix:** Change the prerequisites comment to `Node 26+, pnpm 10.27+, Docker Desktop` to match package.json engines and CI.

**2. [HIGH · inconsistency] Required status checks — table, lines 9-18**

- **Doc says:** The table lists only 6 checks (Install, Build shared packages, Typecheck, Lint, Test, CodeQL) as 'all of the following GitHub Actions jobs [that] must pass before merging'.
- **Reality:** .github/workflows/ci.yml also defines jobs on pull_request branches [main]: audit (line 235), coverage (line 263), e2e/Playwright and Axe (line 307), secret-scan (line 352), trivy-images (line 365). None are in the table despite the doc claiming it lists all required jobs.
- **Fix:** Add rows for Dependency audit, Coverage, Playwright/Axe e2e, Secret scan (Gitleaks), and Trivy image scan, or reword the sentence to say the table is a non-exhaustive subset.

**3. [MEDIUM · staleness] Required status checks — Lint row, line 16**

- **Doc says:** Lint | `CI / Lint` | `pnpm turbo run lint` + `pnpm format:check`
- **Reality:** The Lint job (ci.yml lines 132-188) also runs pnpm security:routes, security:client-secrets, quality:todos/api-docs/complexity/shared-types, db:review, db:perf:fixture, infra:review, observability:review, perf:review.
- **Fix:** Expand the Lint row description to note it also runs the security, code-quality, db, infra, observability, and performance review gates, or split them into their own rows.

**4. [LOW · minor] Required status checks — CodeQL row, line 18**

- **Doc says:** CodeQL | `CodeQL Security Scan / Analyze`
- **Reality:** .github/workflows/codeql.yml line 21 names the job `Analyze (${{ matrix.language }})` with matrix language javascript-typescript (line 31), rendering the check as `CodeQL Security Scan / Analyze (javascript-typescript)`, not `Analyze`.
- **Fix:** Update the workflow/job reference to `CodeQL Security Scan / Analyze (javascript-typescript)` so it matches the actual GitHub check name used for branch protection.

**5. [LOW · minor] Required status checks — Build shared packages row, line 14**

- **Doc says:** Build shared packages | `pnpm turbo run build` for all `packages/*`
- **Reality:** The build-packages job (ci.yml line 81) builds an explicit filtered list of 7 packages (@myclash/types, rulesets, db, ui, design-tokens, i18n, api-client), not an unfiltered turbo run build over all packages/\* (feature-flags, time are excluded).
- **Fix:** Note the build is a filtered turbo run over the 7 shared packages, or reword to avoid implying an unfiltered all-packages build.

### `docs/BUILD_ORDER.md` (4)

**1. [HIGH · contradiction] Phase P12.5 — Organizer AI (T-1213 · Dep, T-1214 · Dep) + Appendix A P13 graph line**

- **Doc says:** T-1213 ("- **Dep**: T-1212, T-704, T-706, T-908"), T-1214 ("- **Dep**: T-1212, T-1213, ..."), T-1305 ("- **Dep**: T-1212, T-1301, T-1302"), and Appendix A ("T-1212 + T-1301 + T-1302 → T-1305") all list T-1212 as a required predecessor.
- **Reality:** T-1212 (and T-1206..T-1211) are never defined in the document; Phase P12.5 jumps directly from T-1205 to T-1213 (grep for '### T-12(0[6-9]|1[0-2])' returns nothing). The foundation these tasks depend on — the AI model registry + org/platform AI settings — was in fact shipped: migrations packages/db/migrations/0115_ai_settings_model.sql, 0117_ai_usage_dashboard.sql, 0118_org_ai_flags.sql and modules apps/api/src/modules/ai-providers, ai-usage, organizer-chat. So the dependency exists in code but has no task entry.
- **Fix:** Add the missing T-1212 task (AI model registry + organization_ai_settings/platform_ai_settings + consumption dashboard, migs 0115-0118, modules ai-providers/ai-usage) — or renumber the deps to point at the actual foundation task — so the four T-1212 references resolve. Mark it shipped.

**2. [MEDIUM · staleness] T-105 · Organizations & Tournaments API (Files)**

- **Doc says:** Files: `apps/api/src/modules/organizations/**`, `apps/api/src/modules/tournaments/**`.
- **Reality:** There is no apps/api/src/modules/tournaments directory (ls returns 'No such file or directory'). Tournament/event CRUD lives in apps/api/src/modules/events/\*\* (events.service.ts references tournaments internally). The 42 modules under apps/api/src/modules/ include events, organizations, phases, etc., but not tournaments.
- **Fix:** Change the T-105 Files path from `apps/api/src/modules/tournaments/**` to `apps/api/src/modules/events/**` to match the shipped module layout.

**3. [MEDIUM · staleness] Whole task list (no People Hub / Leagues / generated-content tasks)**

- **Doc says:** The task list ends its feature phases at P12/P12.5/P13 with no tasks for the People Hub (directory groups), org-owner Leagues/Classement, or the streaming/generated-content subsystem (grep for 'directory.group|People Hub|leagues|generated.content|organizer.chat|model registry' across BUILD_ORDER.md returns 0 hits).
- **Reality:** All three subsystems are shipped: packages/db/migrations/0114_directory_groups.sql (directory_groups), 0015_leagues.sql (leagues), 0119_generated_content.sql (generated_content); modules apps/api/src/modules/directory-groups, leagues, generated-content, organizer-chat. The build order predates the June 2026 waves and never records these as tasks.
- **Fix:** Add task entries (e.g. a new phase or T-6xx/T-14xx block) for People Hub / directory groups, org-owner Leagues (leagues + league_organization_roles + league_user_roles, web-admin /org/[slug]/leagues), and the streaming/generated-content subsystem, marking them shipped, so the build order reflects the current module/schema set.

**4. [LOW · staleness] T-004 · Scaffold the NestJS API / T-003 · Scaffold the three frontend apps (Goal)**

- **Doc says:** T-004 Goal: "NestJS 10 app at `apps/api`"; T-003 Goal: "Three Next.js 15 apps (App Router, TS strict)".
- **Reality:** apps/api/package.json pins @nestjs/core and @nestjs/platform-fastify at ^11.1.19 (NestJS 11, not 10); the three web apps are on Next.js 16.2.6 / React 19 (per package.json), not Next 15.
- **Fix:** Update the T-003/T-004 goal text to NestJS 11 and Next.js 16 (or add a note that the bootstrap targets were later upgraded), since these are the shipped versions.

### `docs/superpowers/plans/2026-05-20-pools-overhaul.md` (4)

**1. [HIGH · staleness] Top of file (title "# Pools Page Overhaul Implementation Plan") — no status/completion header**

- **Doc says:** The plan opens with implementation instructions and every one of its ~90 task steps is still an unchecked `- [ ]` checkbox (grep for `[x]` returns 0 matches), with no status line indicating whether it was executed.
- **Reality:** The plan is substantially SHIPPED. matches.referee_id exists (packages/db/src/schema/matches.ts:30 `refereeId: uuid('referee_id').references(() => persons.id, { onDelete: 'set null' })`); the pool-standings module exists (apps/api/src/modules/pool-standings/{module,controller,service,service.test}.ts); packages/ui/src/components/HelpTooltip.tsx exists and is wired into the pools page (3 HelpTooltip references in page.tsx). Reader sees an unstarted plan; code says it is done.
- **Fix:** Add a status header near the title (e.g. `> Status: SHIPPED (main) — 2026-06`) and either check the `- [ ]` boxes or note the plan is retained as historical design.

**2. [MEDIUM · inconsistency] Goal (line 5) and Architecture (line 7) — "3-tab page (Configure / Matches / Standings)"**

- **Doc says:** "Convert `/pools` into a 3-tab page (Configure / Matches / Standings)" and "renders a 3-tab shell with URL-hash routing (`#configure`/`#matches`/`#standings`)".
- **Reality:** The shipped page is a 4-tab shell. page.tsx:79 declares `type TabKey = 'configure' | 'matches' | 'standings' | 'referees';`, page.tsx:85 registers `{ key: 'referees', labelKey: 'organizer.pools.tabs.referees' }`, and page.tsx:1067-1068 renders `<RefereesTab .../>` (imported at :29) — a tab absent from the plan.
- **Fix:** Update Goal/Architecture to describe the 4-tab layout (add the Referees tab) or add a note that a Referees tab was added after this plan; reconcile the `#referees` hash route with the documented set.

**3. [LOW · staleness] File map (lines 47-48) and Task 8 — `_tabs/color-token.ts` / `accentClassFor()`**

- **Doc says:** Lists `apps/.../pools/_tabs/color-token.ts` (with an `accentClassFor()` util) and `color-token.test.ts` as created files, and Task 12's MatchesTab imports `accentClassFor` from `./color-token`.
- **Reality:** No `_tabs/color-token.ts` implementation exists (Glob returns nothing). The shipped color-token util was moved into `@myclash/ui` (packages/ui/src/utils/color-token.ts, re-exported from packages/ui/src/index.ts); the surviving `_tabs/color-token.test.ts` imports `accentClassFor`/`ColorToken` from `@myclash/ui`, not `./color-token`. Side-color parsing lives in `_tabs/parse-side-colors.ts`.
- **Fix:** Update the File map and Task 8/12 references to point at the `@myclash/ui` `accentClassFor` util (packages/ui/src/utils/color-token.ts) and `_tabs/parse-side-colors.ts`, and note `color-token.test.ts` now imports from `@myclash/ui`.

**4. [LOW · inconsistency] Tech Stack (line 9) and Task 1 (lines 72-101) — DTO validation via class-validator**

- **Doc says:** Tech Stack says "NestJS + class-validator" and Task 1 adds the 5 referee-constraint fields to GeneratePoolsDto using class-validator decorators (`@IsOptional() @IsBoolean() @IsInt() @Min/@Max`).
- **Reality:** The shipped GeneratePoolsDto is Zod-based via nestjs-zod: apps/api/src/modules/phases/dto/phases.dto.ts:1-2 imports `createZodDto` from 'nestjs-zod' and `z` from 'zod'; :25-33 declares `enforceRefereeNoBackToBack: z.boolean().optional()`, `refereeRestMinSlots: z.number().int().min(0).max(10).optional()`, `enforceDedicatedRefereeRest`, `enforceFighterRefereeNoOverlap`, `preferHighRatedReferees` (all Zod); :36 `export class GeneratePoolsDto extends createZodDto(generatePoolsSchema)`. The constraints shipped but via Zod, not class-validator decorators.
- **Fix:** Correct the Tech Stack/Task 1 snippet to reflect Zod (nestjs-zod / createZodDto) instead of class-validator decorators, matching the module's actual validation style.

### `docs/superpowers/plans/2026-05-20-tournament-config-wizard-and-settings.md` (3)

**1. [HIGH · staleness] Top of file / lines 1-12 (title, callout, Goal, Architecture)**

- **Doc says:** Presents as an un-started forward implementation plan: `> **For agentic workers:** ... Use superpowers:subagent-driven-development ... to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.` and every one of the 22 tasks / ~100 steps is an unchecked `- [ ]`. No status header states whether the plan is done.
- **Reality:** The entire plan is already implemented and merged on main. All promised artifacts exist: apps/api/src/common/deep-merge.ts, apps/api/src/modules/rulesets/{rulesets.controller.ts,rulesets.module.ts,rulesets.controller.test.ts}, apps/api/src/modules/events/ruleset-defaults.ts, the settings/ page + \_components/, the new/\_wizard/ dir with WizardShell + Step1-4, compute-wizard-step.ts, and the scoring-config/ page is deleted. `grep scoring-config apps/web-admin/next.config.ts` shows the permanent redirect (line 62) landed. git log shows dozens of follow-on commits (e.g. b1e1c3c4, 3a88d8e5, 5784d05c). The plan has not only shipped but been superseded.
- **Fix:** Add a status header at the top of the doc (e.g. `> **Status: SHIPPED (2026-06) — see follow-on commits; kept for historical reference.**`) and drop or annotate the "implement this plan task-by-task" callout so agents don't re-execute already-merged work.

**2. [MEDIUM · inconsistency] Architecture (line 7) & Task 9 (lines 883-914) — "4-tab left-rail" Settings page**

- **Doc says:** "restructured as a 4-tab left-rail page" and `type TabKey = 'basics' | 'match-format' | 'display' | 'advanced'` with a 4-entry TABS array (basics, match-format, display, advanced).
- **Reality:** apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/settings/page.tsx now defines `type TabKey = 'basics' | 'match-format' | 'venues' | 'display' | 'advanced' | 'locks' | 'recap'` — 7 tabs, with LocksTab and RecapTab (and a venues tab) added beyond the plan's four. \_components/ contains AdvancedTab, BasicsTab, DisplayTab, LocksTab, MatchFormatTab, RecapTab.
- **Fix:** Update the tab list to the shipped 7 tabs (basics, match-format, venues, display, advanced, locks, recap) or, since the doc is historical, mark this section superseded.

**3. [MEDIUM · contradiction] Architecture (line 7) & Tasks 1/4 — deep-merge semantics for per-step PATCH**

- **Doc says:** "adding deep-merge semantics to the PATCH path so per-step wizard PATCHes don't wipe each other" (Task 1/4 build deepMergeJson and wire it into updateTournament so a step saving one nested key preserves the rest).
- **Reality:** git log commit 40ee6424 "fix(tournaments/wizard): rename forfeitPolicy → tournamentPolicy; pluck-not-spread on every step" and 5784d05c "unblock tournament wizard step 2 — add GET tournaments/:id + backfill defaults on partial PATCH" show the persistence approach was reworked away from the plan's whole-blob deep-merge to explicit per-field plucking with default backfill, indicating the deep-merge-only contract described here no longer reflects how the wizard saves.
- **Fix:** Note that the persistence strategy evolved (pluck-not-spread + default backfill) after this plan, or mark the deep-merge tasks as superseded so the described PATCH contract isn't treated as current.

### `docs/superpowers/plans/2026-05-08-ai-infrastructure.md` (2)

**1. [HIGH · staleness] Top of file (lines 1-11, header block)**

- **Doc says:** The plan opens with only Goal / Architecture / Tech Stack and no Status header, and every one of its ~50 task steps is still marked as an unchecked TODO (`- [ ]`), e.g. line 51 `- [ ] **Step 1: Create the migration**`. A reader takes this as un-started / in-progress work.
- **Reality:** The entire plan has shipped verbatim. Migration `packages/db/migrations/0029_ai_infrastructure.sql` exists and matches the doc's SQL exactly (`organization_ai_settings`, `ai_usage_log`, `events.ai_spend_cap_eur`). Modules `apps/api/src/modules/ai-providers/` (with `adapters/anthropic.adapter.ts`, `openai.adapter.ts`, `mistral.adapter.ts`, `provider-adapter.interface.ts`, `ai-providers.service.ts`, `ai-providers.controller.ts`, `ai-providers.module.ts`) and `apps/api/src/modules/ai-usage/` (with `spend-cap.exception.ts`, `ai-usage.service.ts`, `ai-usage.controller.ts`, `ai-usage.module.ts`) all exist. Frontend page `apps/web-admin/app/org/[slug]/settings/ai/page.tsx` exists. Grep found 0 `- [x]` checked boxes in the file.
- **Fix:** Add a `**Status:** Superseded (shipped 2026-05, then extended)` line to the header block and either bulk-check the task boxes or add a note that all tasks are complete. See related finding for why 'Superseded' rather than plain 'Shipped'.

**2. [MEDIUM · staleness] Whole plan scope vs. shipped subsystem**

- **Doc says:** The plan's Goal (line 5) scopes the work to 'encrypted BYOK key storage, provider abstraction for Anthropic/OpenAI/Mistral, per-event spend caps' and the Architecture (line 7) to 'Two NestJS modules — ai-providers and ai-usage'. It describes a fixed pricing map hardcoded inside each adapter (lines 388-393, 457-462, 529-534) and a `SpendCapExceededException` as the only budget guard.
- **Reality:** The shipped AI subsystem is far larger than the plan and has restructured its pieces: `apps/api/src/modules/ai-providers/model-registry.ts` now holds a `MODEL_REGISTRY` that is the single source of truth for models+pricing (adapters no longer own the pricing maps the plan shows), plus `ai-models.controller.ts` (`GET /ai/models`). `apps/api/src/modules/ai-usage/` gained `ai-dashboard.controller.ts` and a second `budget-exceeded.exception.ts` alongside the plan's `spend-cap.exception.ts`. Whole new sibling modules exist that this plan never mentions: `apps/api/src/modules/organizer-ai-assistant/` (chatbot), `apps/api/src/modules/generated-content/` (with `me-ai.controller.ts`). Later migrations 0115_ai_settings_model, 0117_ai_usage_dashboard, 0118_org_ai_flags, 0119_generated_content, 0120_fighter_ai_settings all post-date and extend this plan.
- **Fix:** Mark the plan Status as 'Superseded' and add a short 'Follow-on work (not in this plan)' pointer listing model-registry / ai-models endpoint, ai-dashboard, organizer-ai-assistant, and generated-content (migs 0115-0120), so a reader knows the adapter-owned pricing and two-module scope described here is no longer the current shape.

### `docs/superpowers/specs/2026-05-28-configure-tab-horizontal-pools-design.md` (2)

**1. [HIGH · contradiction] ## Layout change (Before/After code block, lines 45-71)**

- **Doc says:** Prescribes swapping the pool-grid wrapper to `<div className="flex flex-wrap gap-4">` with each pool card as a fixed-width `w-72` card so 'the browser packs as many as fit on each row; the rest wrap below'. Whole spec is built on fixed-width wrapping cards vs. the old responsive grid.
- **Reality:** The Configure-tab pool grid in apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx now renders `<div className="flex flex-col gap-4">` (line 698) with each pool card as `w-full border-2 rounded-xl` (lines 700-705) — one pool per row, full-width, vertically stacked. `grep flex-wrap|w-72` finds flex-wrap only on toolbar/filter rows (lines 580, 611, 767) and no `w-72` anywhere. The final layout is the opposite of what the Approved spec prescribes.
- **Fix:** Update the spec (or add a Status/superseded note) to reflect that pools ended up as a single-column vertical stack of full-width cards (`flex flex-col gap-4` + `w-full`), not `flex flex-wrap` + `w-72` wrapping cards.

**2. [LOW · staleness] ## References — 'The Matches tab uses a different responsive grid ... at MatchesTab.tsx:204'**

- **Doc says:** 'The Matches tab uses a different responsive grid (`grid-cols-1 md:grid-cols-2`) at apps/web-admin/app/org/[slug]/events/[eventId]/pools/\_tabs/MatchesTab.tsx:204 — intentionally capped at 2 because match tables are wider.'
- **Reality:** apps/web-admin/app/org/[slug]/events/[eventId]/pools/\_tabs/MatchesTab.tsx contains no `grid-cols` classes at all (Grep returns no matches). The referenced `grid-cols-1 md:grid-cols-2` at line 204 no longer exists.
- **Fix:** Remove or update the stale MatchesTab.tsx:204 grid reference; the Matches tab no longer uses that responsive grid.

### `README.md` (1)

**1. [HIGH · staleness] ## Quick start (developers) — prereqs comment line 43**

- **Doc says:** `# Prereqs: Node 20+, pnpm 9+, Docker Desktop`
- **Reality:** Root package.json (lines 12-15) declares `"packageManager": "pnpm@10.27.0"` and `"engines": { "node": ">=26.0.0", "pnpm": ">=10.27.0" }`; `.nvmrc` pins `26`. README line 43 still reads `# Prereqs: Node 20+, pnpm 9+, Docker Desktop`.
- **Fix:** Update the prereqs line to `# Prereqs: Node 26+, pnpm 10.27+, Docker Desktop` to match package.json engines and .nvmrc.

### `docs/superpowers/specs/2026-05-19-consistent-backups-design.md` (1)

**1. [HIGH · contradiction] Recommended Approach / Quiesce State / API Behavior / Backup Manifest**

- **Doc says:** Backups use a platform-level backup-quiesce lock: ops-runner enables a `backup_quiesce` state persisted to `data/backup-quiesce.json`; the API rejects mutating requests with 503 `{ "code": "BACKUP_IN_PROGRESS", ..., "retryAfterSeconds": 300 }`; workers/storage are paused; and each backup set includes a machine-readable manifest.json with `consistent: true`, quiesce timestamps, gitCommit and per-artifact sha256.
- **Reality:** None of the quiesce mechanism exists. `infra/scripts/backup.sh` runs `pg_dump` relying on its default MVCC snapshot (line 106 comment: 'pg_dump takes a consistent MVCC snapshot by default') and tars the storage volume with no write pause. There is no `backup_quiesce.json`, no `BACKUP_IN_PROGRESS` code and no `retryAfterSeconds` anywhere in apps/api (grep returns nothing). The only 503 write-blocker is `apps/api/src/common/interceptors/read-only.interceptor.ts`, a MANUAL `read_only_mode` feature flag ('Platform is in read-only mode') not tied to backups. `infra/ops-runner/server.mjs` uses a single-operation `.ops.lock` file mutex only (line 274), not a platform quiesce. `infra/ops-runner/backup-core.mjs` never emits a manifest (no 'manifest'/'consistent'/'gitCommit'/'s3Uploaded' strings).
- **Fix:** Add a Status header marking this as an unimplemented proposal (e.g. 'Status: Proposed — not implemented'), or rewrite it to describe the shipped behavior: pg_dump MVCC snapshot + storage tar with no quiesce, manual `read_only_mode` flag (read-only.interceptor.ts) as the only write-block, ops-runner `.ops.lock` single-operation mutex, and no consistency manifest.

### `docs/GOLDEN_PATHS.md` (3)

**1. [MEDIUM · inconsistency] GP-4 — Super-admin: Approve an organiser (Entry point + step 2)**

- **Doc says:** Entry point: `app.myclash.fr/admin`; step 2 'Navigate to `/admin/organizations`'.
- **Reality:** web-public (app.myclash.fr) has NO app/admin/\*\* route (apps/web-public/app has only api, auth, clubs, e, fighters, leagues, login, me, notifications, profile, reset-password). The admin console lives in apps/web-admin (app/admin/organizations exists) served by Traefik at Host(`admin.${DOMAIN}`) i.e. admin.myclash.fr (infra/docker-compose.prod.yml:813). HIERARCHY.md:55 documents admin at admin.myclash.fr.
- **Fix:** Change GP-4 entry point to `admin.myclash.fr` and step 2 to `admin.myclash.fr/admin/organizations` (or note the admin app is a distinct host, not app.myclash.fr).

**2. [MEDIUM · inconsistency] GP-5 — Super-admin: Toggle a feature flag (Entry point)**

- **Doc says:** Entry point: `app.myclash.fr/admin/feature-flags`.
- **Reality:** Feature-flags admin page is in web-admin (apps/web-admin/app/admin/feature-flags exists), served on Host(`admin.${DOMAIN}`) = admin.myclash.fr; web-public has no /admin route at all.
- **Fix:** Change the entry point to `admin.myclash.fr/admin/feature-flags`.

**3. [LOW · staleness] GP-4 — step 6 Expected result**

- **Doc says:** Expected result: 'Organisation status changes to `approved`'.
- **Reality:** OrganizationsService.approve() (organizations.service.ts:243-252) sets status to 'active' (line 246 `.update({ status: 'active', ... })`); orgs are created with status 'pending_approval' (line 144). There is no 'approved' status.
- **Fix:** Change the expected status from `approved` to `active`.

### `memory/MEMORY.md` (3)

**1. [MEDIUM · staleness] ## Architecture quick reference (line 158)**

- **Doc says:** **Stack**: Next.js 15 (3 apps) + NestJS + Postgres (via Supabase) + Redis + Drizzle ORM + Supabase Realtime + Auth + Storage.
- **Reality:** All three web apps declare "next": "16.2.6" and "react": "^19.2.6" (apps/web-public, apps/web-admin, apps/web-scoring package.json). The line-158 'Architecture quick reference' is a current-state stack description, so 'Next.js 15' is stale.
- **Fix:** Change 'Next.js 15 (3 apps)' to 'Next.js 16 (3 apps)'. Leave the historical Phase-P0 row 'T-003 · Scaffold three Next.js 15 apps' (line 227) as-is.

**2. [LOW · staleness] ## Deployment patterns (inherited from MyFAL) — Compose conventions (line 72)**

- **Doc says:** Traefik 3.6.x, label-based routing, cert resolver named `letsencrypt`.
- **Reality:** infra/docker-compose.prod.yml:22 and infra/docker-compose.staging-certs.yml:15 both pin image: traefik:v3.7.1; only infra/docker-compose.dev.yml:41 still uses traefik:v3.6.6. The section (line 62) uses docker-compose.prod.yml, so the current-state prod pin is 3.7.x, not 3.6.x.
- **Fix:** Update to 'Traefik 3.7.x' (prod/staging pin v3.7.1; dev is v3.6.6), or note the dev/prod split. 'letsencrypt' cert resolver and label-based routing remain accurate.

**3. [LOW · staleness] ## Repo layout (line 49)**

- **Doc says:** `packages/` — shared workspaces (rulesets, db, ui, types, design-tokens, i18n, api-client).
- **Reality:** ls packages/ shows 9 workspaces: api-client, db, design-tokens, feature-flags, i18n, rulesets, time, types, ui. The enumerated list omits feature-flags and time. @myclash/time is a real workspace dep (apps/web-public/package.json: "@myclash/time": "workspace:^").
- **Fix:** Add feature-flags and time to the enumerated packages list so it reflects all 9 shared workspaces.

### `docs/PRE_DEPLOY_CHECKLIST.md` (2)

**1. [MEDIUM · staleness] Step 28 — Verify backup-then-restore drill on a throwaway VM**

- **Doc says:** "Document any friction in `docs/RUNBOOK.md`."
- **Reality:** Confirmed: docs/RUNBOOK.md does not exist (Glob docs/RUNBOOK.md returns no files; ls docs/ has no runbook). docs/DISASTER_RECOVERY.md exists and is referenced by the same checklist at line 292. Line 334 of PRE_DEPLOY_CHECKLIST.md reads 'Document any friction in `docs/RUNBOOK.md`.' pointing at a non-existent file. `infra/scripts/restore.sh` exists (line 332 invokes it).
- **Fix:** Change the reference in step 28 from `docs/RUNBOOK.md` to `docs/DISASTER_RECOVERY.md` (or create RUNBOOK.md if a distinct operational runbook is intended). The DR doc is the existing canonical target.

**2. [LOW · inconsistency] Step 4 — Order an OVH VPS ("Why this size")**

- **Doc says:** "Postgres + Redis + 5 Node services + Traefik + Supabase services."
- **Reality:** Confirmed: infra/docker-compose.prod.yml defines 7 Node app services — api (l.301), ops-runner (l.473), worker (l.514), web-public (l.561), web-marketing (l.637), web-scoring (l.671), web-admin (l.764). `db` (l.79) is Postgres and `myclash` (l.829) is a network, not services. PRE_DEPLOY_CHECKLIST.md line 49 says '5 Node services', undercounting the actual 7.
- **Fix:** Update the sizing rationale to reflect ~7 Node services (api + worker + ops-runner + 4 web apps), or reword to "several Node services"; the undercount understates RAM headroom during an event.

### `docs/INFRASTRUCTURE_REVIEW.md` (2)

**1. [MEDIUM · inconsistency] ## Container Inventory (line 22-23)**

- **Doc says:** "Production compose defines the expected v1 services: Traefik, Postgres, Redis, Supabase Auth, Supabase Realtime, Supabase Storage, API, ops-runner, worker, web-public, web-marketing, web-scoring, and web-admin." — 13 services listed.
- **Reality:** infra/docker-compose.prod.yml defines 14 services; the inventory omits the supabase-rest (PostgREST) service (infra/docker-compose.prod.yml:266 `supabase-rest: image: postgrest/postgrest:v12.2.3`), which is edge-exposed via router myclash-rest (line 296) at app.${DOMAIN}/rest/v1 (rest-strip prefix /rest/v1 in middlewares.yml:13-16). PostgREST is a real production service, so its absence is an omission not a removal.
- **Fix:** Add "Supabase REST (PostgREST)" to the Container Inventory list so it enumerates all 14 compose services.

**2. [LOW · staleness] ## Edge / TLS — "Public routers use the myclash-security-headers@docker middleware" (line 45)**

- **Doc says:** "Public routers use the `myclash-security-headers@docker` middleware."
- **Reality:** The security-headers middleware is defined in the Traefik file provider (infra/config/traefik/middlewares.yml:5 `myclash-security-headers:` with stsSeconds/contentTypeNosniff/frameDeny/referrerPolicy). All 16 router references use the `@file` suffix (e.g. infra/docker-compose.prod.yml:373, 380, 391, 296); no `@docker` security-headers middleware exists anywhere.
- **Fix:** Change `myclash-security-headers@docker` to `myclash-security-headers@file` and note the HSTS/nosniff/frame-deny values live in infra/config/traefik/middlewares.yml (file provider).

### `AGENTS.md` (1)

**1. [MEDIUM · staleness] Hard rules — rule 2, line 45**

- **Doc says:** The TF_v1 implementation must reproduce the FAL 2026 reference data byte-for-byte. A failing snapshot test against `scripts/import-fal2026.ts` data is a red flag.
- **Reality:** scripts/import-fal2026.ts does not exist (glob scripts/_fal_ → no files). The FAL 2026 reference data is packages/rulesets/test/fixtures/fal2026.json, exercised by the golden test packages/rulesets/test/tf_v1.fal2026.test.ts.
- **Fix:** Replace the `scripts/import-fal2026.ts` reference with `packages/rulesets/test/fixtures/fal2026.json` (and cite the golden test `packages/rulesets/test/tf_v1.fal2026.test.ts`).

### `docs/superpowers/plans/2026-05-28-inline-club-create-on-add-participant.md` (1)

**1. [MEDIUM · inconsistency] Task 2: DTO `newClubName` field + xor invariant (Step 2.3)**

- **Doc says:** Prescribes a class-validator DTO: 'Add imports for Validate, ValidatorConstraint, ValidatorConstraintInterface... from class-validator' and defines `@ValidatorConstraint({ name: 'ClubIdOrNewClubNameConstraint' })` with a class-level constraint plus `@IsOptional() @IsString() @MaxLength(200) @Validate(...)` decorators on `newClubName`.
- **Reality:** The feature shipped, but `apps/api/src/modules/persons/dto/persons.dto.ts` is a nestjs-zod DTO, not class-validator. It uses `createZodDto(createPersonSchema)` with `z.object({... newClubName: z.string().max(200).nullable().optional() ...}).strict().refine((d) => !(d.clubId && d.newClubName != null), ...).refine((d) => d.newClubName == null || d.newClubName.trim().length > 0, ...)` (lines 1-38). There is no class-validator / `@ValidatorConstraint` in the file.
- **Fix:** Rewrite Task 2 to reflect the shipped Zod (nestjs-zod) implementation (add `newClubName: z.string().max(200).nullable().optional()` to `createPersonSchema` plus two `.refine()` rules), and drop the class-validator `@ValidatorConstraint` guidance/imports. Or add a status header noting the DTO shipped via Zod, differing from the plan.

### `docs/superpowers/plans/2026-05-28-configure-tab-horizontal-pools.md` (1)

**1. [MEDIUM · contradiction] Goal / Task 1 Step 1.1 (wrapping flex row of fixed-width w-72 cards)**

- **Doc says:** Goal: replace the responsive grid with 'a wrapping flex row of fixed-width (`w-72`) pool cards'; Step 1.1 changes the wrapper to `flex flex-wrap gap-4` and prepends `w-72` to each card, citing the current wrapper as `grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` at line 734.
- **Reality:** The current Configure-tab pool grid in `apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx` (lines 697-708) is `<div className="flex flex-col gap-4">` with each card `'w-full border-2 rounded-xl p-4 transition-colors'` — one pool per row, full-width, vertically stacked. Neither the plan's cited grid baseline nor its target `flex flex-wrap` + `w-72` is present; grep for `flex flex-wrap gap-4`, `grid-cols-1 gap-4 md:grid-cols-2`, and `w-72 border-2` in the file all return zero matches.
- **Fix:** Add a status header marking this plan superseded/not-landed (the layout later became a vertical `flex flex-col` stack of `w-full` cards), or archive it, so it no longer reads as an actionable plan whose baseline and target both mismatch current code.

### `docs/superpowers/specs/2026-05-28-bracket-card-thickness-design.md` (1)

**1. [MEDIUM · staleness] ### 1) MatchCard.tsx — Width bump (line 84) 'after'**

- **Doc says:** The 'after' min-width floor is `min-w-[220px] max-w-[360px]` for MatchCard.tsx (spec line 62) and BracketView.tsx (spec line 118), described as bumping the narrow floor from 180px to 220px.
- **Reality:** packages/ui/src/components/bracket/MatchCard.tsx line 92 uses `min-w-[256px] max-w-[360px]` (line 116 also `min-w-[256px]`); packages/ui/src/components/BracketView.tsx lines 245 and 483 use `min-w-[256px] max-w-[360px]`. The min-width floor is 256px, not the spec's stated 220px (max-w-[360px] matches).
- **Fix:** Update the spec's 'after' snippets and the 'Behavior after change' math (which assumes a 220px floor) to the actual 256px min-width, or note the value was subsequently raised from 220px to 256px.

### `docs/OWNER_TASKS.md` (1)

**1. [LOW · staleness] O-051 · Share MyFAL deployment patterns with the agent**

- **Doc says:** "Traefik 3.6.x, label-based routing, per-service `compress` middleware shared."
- **Reality:** Confirmed: infra/docker-compose.prod.yml line 22 pins `image: traefik:v3.7.1`. OWNER_TASKS.md line 93 (O-051) still states 'Traefik 3.6.x'. The compose file's own header comment (line 11) is likewise stale ('Traefik 3.6.x'). The bullet sits in a 'reference patterns aligned with MyFAL conventions' block, so it partly describes MyFAL heritage, but as written it misstates the pinned Traefik version now shipped.
- **Fix:** Update the O-051 reference-pattern bullet to "Traefik 3.7.x" to match the pinned `traefik:v3.7.1` image.

### `docs/decisions/ADR-004-domain.md` (1)

**1. [LOW · inconsistency] ## Consequences — "Easy:" bullet (line 29)**

- **Doc says:** "All subdomains share a single Let's Encrypt wildcard cert via Traefik; adding new surfaces is a Traefik label change."
- **Reality:** infra/docker-compose.prod.yml line 38 sets `--certificatesresolvers.letsencrypt.acme.tlschallenge=true` (TLS-ALPN-01 challenge) with no `dnschallenge`/`dnsChallenge`/wildcard/dns-01 anywhere in any infra compose file (grep across infra/\*_/_.yml returns none). Each host router carries its own `tls.certresolver=letsencrypt` label (traefik dashboard L73, rest L295, api L372, admin-api L379, public-api L390, scoring-api L403, auth L426, realtime L436/L444, storage L452/L467, public L628, marketing L662, scoring L728/L742/L758, admin L816), so certs are per-host. TLS-ALPN-01 cannot issue wildcard certs (only DNS-01 can), so the 'single wildcard cert' claim is false.
- **Fix:** Reword the bullet, e.g. "Each subdomain gets its own Let's Encrypt cert (TLS-ALPN-01 challenge) via Traefik; adding a new surface is a Traefik label change." Drop the word 'wildcard' (or switch the resolver to a DNS-01 challenge if a wildcard is genuinely desired).

### `docs/superpowers/plans/2026-05-28-bracket-card-thickness.md` (1)

**1. [LOW · staleness] Task 1 Step 1.1 (bump card width) / File structure table**

- **Doc says:** Cites the current `cardClasses` as `... min-w-[180px] max-w-[320px] ...` at line 84 and prescribes changing it to `min-w-[220px] max-w-[360px]`; likewise BracketView round-column at line 215 from `min-w-[180px] max-w-[320px]` to `min-w-[220px] max-w-[360px]`.
- **Reality:** `packages/ui/src/components/bracket/MatchCard.tsx` line 92 now reads `... w-full min-w-[256px] max-w-[360px] ...` (and an outer wrapper at line 116 also uses `min-w-[256px] max-w-[360px]`). Grep for `min-w-[180px]` and `min-w-[220px]` in MatchCard.tsx and BracketView.tsx returns zero matches — the width evolved past this plan's target to 256px, so both the cited `min-w-[180px]` baseline and the `min-w-[220px]` target are stale.
- **Fix:** Add a status header noting this plan was implemented and later superseded (cards are now `min-w-[256px] max-w-[360px]`); the `min-w-[180px]`→`min-w-[220px]` instructions no longer apply.

### `docs/superpowers/specs/2026-05-17-league-management-design.md` (1)

**1. [LOW · staleness] Scope / Files Modified**

- **Doc says:** Six capabilities are added to 'the existing single-page admin UI at `apps/web-admin/app/admin/leagues/page.tsx`', and the Files Modified table lists that single page.tsx as the only frontend file (slug auto-gen, edit panel, delete, scoring editor, remove links, fuzzy add all inline on it).
- **Reality:** The league admin UI is no longer single-page. `apps/web-admin/app/admin/leagues/` now contains separate route files: `new/page.tsx` (create + slug auto-gen), `[id]/edit/page.tsx` (edit + scoring), `[id]/requests/page.tsx`, `[id]/ranking/page.tsx`, and `scoring-systems/**`. `slugTouched`/`toSlug`/`scoringSystem` logic lives in new/page.tsx and [id]/edit/page.tsx, not solely in page.tsx. (The four backend endpoints in the spec DO all exist in leagues.controller.ts, so only the frontend layout claim is stale.)
- **Fix:** Update the Scope sentence and Files Modified table to reflect the multi-route structure (new/, [id]/edit/, [id]/requests/, scoring-systems/) instead of a single page.tsx.

### `docs/superpowers/specs/2026-05-20-pools-overhaul-design.md` (1)

**1. [LOW · staleness] ## Matches tab → Tournament-color binding (line 101)**

- **Doc says:** 'Map color tokens → Tailwind classes via a new util `apps/web-admin/.../matches-tab/color-token.ts` exporting `accentClassFor(token: ColorToken): string`. 8 supported tokens: red, blue, green, yellow, purple, orange, black, white.'
- **Reality:** No `color-token.ts` exists under any matches-tab dir (Glob for \*_/matches-tab/color-token_ returns none; only pools/\_tabs/color-token.test.ts). The util lives at packages/ui/src/utils/color-token.ts and is imported from `@myclash/ui`. It defines 15 ColorToken values (red, blue, green, yellow, purple, orange, black, white, amber, violet, teal, gold, silver, bronze, slate), not 8.
- **Fix:** Correct the util location to `@myclash/ui` (packages/ui/src/utils/color-token.ts, `accentClassFor`), drop the matches-tab/color-token.ts path, and broaden the '8 supported tokens' claim to the 15 tokens actually supported.

### `apps/web-marketing/README.md` (1)

**1. [LOW · inconsistency] ## Build**

- **Doc says:** "The production `Dockerfile` is two lines: `FROM caddy:2-alpine` + `COPY public/ /usr/share/caddy/`. No build step at runtime."
- **Reality:** apps/web-marketing/Dockerfile has 8 non-comment directives, not two: FROM caddy:2-alpine, COPY public/ /usr/share/caddy/, a RUN printf that writes /etc/caddy/Caddyfile (root \*/usr/share/caddy, file_server, encode gzip, try_files {path} /index.html), EXPOSE 80, and a multi-line HEALTHCHECK (wget -qO- http://localhost:80/). The 'two lines' claim understates it.
- **Fix:** Reword to describe the Dockerfile accurately: based on caddy:2-alpine, COPYs public/ into the web root, writes a minimal Caddyfile (gzip + SPA fallback via try_files), exposes port 80, and defines a wget healthcheck. Drop the literal 'two lines' phrasing.

### `tests/e2e/README.md` (1)

**1. [LOW · staleness] ## Status (spec table)**

- **Doc says:** The Status table lists only 4 specs: participants-import.spec.ts, create-tournament.spec.ts, create-event.spec.ts, schedule.spec.ts.
- **Reality:** tests/e2e/ contains 7 spec files. The Status table's 4 plus populate-event.spec.ts (which IS documented in its own 'Populate a rich demo event' section, so legitimately absent from the table), offline-sync.spec.ts, and referee-board.spec.ts. The latter two appear nowhere in the README, so the table no longer reflects the full active E2E spec set.
- **Fix:** Add rows for offline-sync.spec.ts and referee-board.spec.ts (with their current state) to the Status table, or note that the table lists only the wizard/import flows.

## Archive / removal candidates (need your call)

These describe content that appears removed, superseded, or never shipped — the fix pass will annotate them, but outright deletion/relocation is left to you:

- `myclash.md` — Features (v1) → For event organizers, publish/export bullet (line 41): Extend the export bullet to mention the lossless event/tournament archive export + restore round-trip (round-trippable JSON archive with restore-preview) as a distinct backup/migration feature, alongside the CSV/JSON/PDF/HEMA-Ratings exports.
- `docs/ARCHITECTURE.md` — §7.2 Built-in rulesets shipped at v1.0: Remove the TF_v1_no_afterblow bullet from §7.2 (or mark it as planned/not-yet-shipped) so the list matches the two rulesets actually registered.
- `docs/superpowers/plans/2026-05-08-ai-infrastructure.md` — Top of file (lines 1-11, header block): Add a `**Status:** Superseded (shipped 2026-05, then extended)` line to the header block and either bulk-check the task boxes or add a note that all tasks are complete. See related finding for why 'Superseded' rather than plain 'Shipped'.
- `docs/superpowers/plans/2026-05-08-ai-infrastructure.md` — Whole plan scope vs. shipped subsystem: Mark the plan Status as 'Superseded' and add a short 'Follow-on work (not in this plan)' pointer listing model-registry / ai-models endpoint, ai-dashboard, organizer-ai-assistant, and generated-content (migs 0115-0120), so a reader knows the adapter-owned pricing and two-module scope described here is no longer the current shape.
- `docs/superpowers/plans/2026-05-20-tournament-config-wizard-and-settings.md` — Top of file / lines 1-12 (title, callout, Goal, Architecture): Add a status header at the top of the doc (e.g. `> **Status: SHIPPED (2026-06) — see follow-on commits; kept for historical reference.**`) and drop or annotate the "implement this plan task-by-task" callout so agents don't re-execute already-merged work.
- `docs/superpowers/plans/2026-05-20-tournament-config-wizard-and-settings.md` — Architecture (line 7) & Task 9 (lines 883-914) — "4-tab left-rail" Settings page: Update the tab list to the shipped 7 tabs (basics, match-format, venues, display, advanced, locks, recap) or, since the doc is historical, mark this section superseded.
- `docs/superpowers/plans/2026-05-20-tournament-config-wizard-and-settings.md` — Architecture (line 7) & Tasks 1/4 — deep-merge semantics for per-step PATCH: Note that the persistence strategy evolved (pluck-not-spread + default backfill) after this plan, or mark the deep-merge tasks as superseded so the described PATCH contract isn't treated as current.
- `docs/superpowers/plans/2026-05-28-configure-tab-horizontal-pools.md` — Goal / Task 1 Step 1.1 (wrapping flex row of fixed-width w-72 cards): Add a status header marking this plan superseded/not-landed (the layout later became a vertical `flex flex-col` stack of `w-full` cards), or archive it, so it no longer reads as an actionable plan whose baseline and target both mismatch current code.
- `docs/superpowers/plans/2026-05-28-bracket-card-thickness.md` — Task 1 Step 1.1 (bump card width) / File structure table: Add a status header noting this plan was implemented and later superseded (cards are now `min-w-[256px] max-w-[360px]`); the `min-w-[180px]`→`min-w-[220px]` instructions no longer apply.
- `docs/superpowers/specs/2026-05-17-league-management-design.md` — Scope / Files Modified: Update the Scope sentence and Files Modified table to reflect the multi-route structure (new/, [id]/edit/, [id]/requests/, scoring-systems/) instead of a single page.tsx.
- `docs/superpowers/specs/2026-05-28-configure-tab-horizontal-pools-design.md` — ## Layout change (Before/After code block, lines 45-71): Update the spec (or add a Status/superseded note) to reflect that pools ended up as a single-column vertical stack of full-width cards (`flex flex-col gap-4` + `w-full`), not `flex flex-wrap` + `w-72` wrapping cards.
- `docs/superpowers/specs/2026-05-28-configure-tab-horizontal-pools-design.md` — ## References — 'The Matches tab uses a different responsive grid ... at MatchesTab.tsx:204': Remove or update the stale MatchesTab.tsx:204 grid reference; the Matches tab no longer uses that responsive grid.
- `tests/e2e/README.md` — ## Status (spec table): Add rows for offline-sync.spec.ts and referee-board.spec.ts (with their current state) to the Status table, or note that the table lists only the wizard/import flows.
