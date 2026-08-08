# MyClash — Project Owner Tasks

> Operational checklist for **you** as project owner. These are tasks the AI coder cannot do.
>
> Organized by **when** they need to happen relative to the dev phases in `BUILD_ORDER.md`.
> Task IDs use `O-NNN` and are referenced from BUILD_ORDER tasks where there's a hard dependency.

---

## Quickstart — First 7 days (to unblock dev)

Minimum to get the AI started on T-001:

1. **O-001 Domain** — buy `myclash.fr` or `myclash.io` (or accept the placeholder for local dev only).
2. **O-004 GitHub repo** — create the repo, push the two doc files (`ARCHITECTURE.md`, `BUILD_ORDER.md`), commit `AGENTS.md` at root.
3. **O-005 Repo hygiene** — branch protection on `main`, required CI checks, default reviewers (you).
4. **O-007 VAPID keys** — generate and store as repo secrets (only blocks P12).
5. **O-008 Google OAuth** — **deferred to v1.1**. Magic-link auth (via O-006) is sufficient at launch.

Everything else can wait until the relevant dev phase approaches.

---

## Phase O0 — Before Development Starts

### O-001 · Domain registration

- **When**: Day 1.
- **Action**: Buy a domain. Suggested: `myclash.fr`, `myclash.io`, `myclash.org`. Recommended registrar in EU: OVH, Gandi (FR), or Porkbun (cheap, no upsells).
- **DNS plan**: Wildcard subdomain support is required (`*.myclash.fr` for per-event subdomains is a _future_ option — v1 uses path-based `app.myclash.fr/e/[eventSlug]`, so a basic A record is enough).
- **Subdomains needed at v1**:
  - `myclash.fr` → `web-public`
  - `admin.myclash.fr` → `web-admin`
  - `staff.myclash.fr` → `web-staff`
  - `api.myclash.fr` → API (NestJS)
- **Cost**: ~€10–15/year.

### O-002 · Hosting decision

- **When**: Before T-006.
- **Recommended for an EU-based free OSS project**:
  - **Hetzner Cloud (DE)** — best price/performance in EU. CX31 (4 vCPU, 8 GB RAM, 80 GB NVMe) is enough for v1.
  - **Scaleway (FR)** — alternative if you prefer keeping it French.
  - **OVH (FR)** — fine, slightly worse DX.
- **Avoid for v1**: AWS/Azure/GCP (cost overhead not justified at this scale).
- **Specs**: Start with 4 vCPU / 8 GB RAM / 80 GB SSD. Postgres + Redis + 4 Node services + Traefik fits comfortably.
- **Cost**: ~€15–20/month.

### O-003 · Provision the VPS

- **When**: Before T-006 (you'll need the box to run the first deploy).
- **Action**:
  - Install Docker + Compose v2.
  - Set up a non-root sudo user; disable root SSH; SSH key auth only.
  - UFW: allow 22, 80, 443; deny everything else.
  - Install fail2ban.
  - Set up unattended security upgrades.
- Optional: Wireguard or Tailscale for admin access (avoids exposing SSH to the public internet).

### O-004 · GitHub repo

- **When**: Day 1.
- **Action**:
  - Create the repo (`myclash` or org-named).
  - License: AGPL-3.0 (already specified).
  - Add `ARCHITECTURE.md`, `BUILD_ORDER.md`, `OWNER_TASKS.md`, `AGENTS.md` (this file), `README.md`.

### O-005 · Repo hygiene

- **When**: Day 1.
- **Action**:
  - Branch protection on `main`: require PR review (yourself or a co-maintainer), require CI checks green, no force-push.
  - Issue templates: bug, feature, ruleset proposal.
  - PR template: link to BUILD_ORDER task, screenshots, test notes.
  - Enable GitHub Discussions (community Q&A).
  - Enable Dependabot for npm + GitHub Actions.

### O-051 · Share MyFAL deployment patterns with the agent

- **When**: Before T-055 (Phase P0.5 — VPS bootstrap).
- **Status**: ✅ **Complete** — the owner has shared:
  - `deploy.sh`, `start.sh`, `stop.sh`, `status.sh`, `refresh.sh`, `destroy.sh`, `load-test.sh` from MyFAL.
  - `docker-compose.yml` (production).
  - `docker-compose.staging-certs.yml` (staging cert overlay).
  - `.env.example` (canonical env keys).
  - `.gitignore` (canonical exclusion list).
- These have been used to define MyClash's `infra/scripts/*`, `infra/docker-compose.prod.yml`, `infra/docker-compose.staging-certs.yml`, `.env.example`, and `.gitignore` — all aligned with MyFAL conventions:
  - Cert resolver named `letsencrypt`, ACME storage at `/data/acme.json`, TLS challenge via port 443.
  - Variable naming: `DOMAIN`, `LETSENCRYPT_EMAIL`, `TZ`, `COMPOSE_PROJECT_NAME`, `${VAR:-}` defaults.
  - Container names prefixed `myclash-*`.
  - Healthchecks via `node -e` HTTP probe (no curl/wget needed in image).
  - Log paths under `./logs/<service>/`, data under `./data/<service>/`.
  - Traefik 3.7.x, label-based routing, per-service `compress` middleware shared.
- **Nothing remaining for T-055.** Agent has all reference patterns it needs.

### O-006 · Email / SMTP provider

- **When**: Before T-009 (auth magic links).
- **Recommended**:
  - **Resend** — modern, cheap, 3000 emails/month free, EU region available.
  - **Brevo** (FR) — 300/day free; good if you want to stay French.
- **Action**:
  - Sign up.
  - Verify sending domain (DNS records for SPF/DKIM/DMARC — required for deliverability).
  - Generate API key, store in repo secrets as `SMTP_API_KEY`.
- **Volume estimate**: Magic links + notifications for a 100-fighter event = a few thousand emails total. Free tier covers it for years.

### O-007 · VAPID keys for Web Push

- **When**: Before T-1201 (Phase P12, but generate now and stash).
- **Action**: Run once, store both keys.
  ```bash
  npx web-push generate-vapid-keys
  ```
- **Store**: `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in repo secrets and on the server `.env`.
- **Cost**: Free. No third-party push service needed (browsers do the push).

### O-008 · Google OAuth credentials — DEFERRED TO v1.1

- **When**: Not in v1. Magic-link auth (via O-006 SMTP) covers the same use case without the regulatory drag.
- **Why deferred**: Google OAuth verification can take 2–4 weeks (External app, sensitive-scope review). Magic-link auth ships now; Google login is a v1.1 quality-of-life add.
- **When v1.1 actually starts**:
  1. Create a Google Cloud project named "MyClash".
  2. Enable OAuth (modern flow, no Google+ API).
  3. Configure OAuth consent screen (External, "Public" mode).
  4. Create OAuth 2.0 Client ID (type: Web application).
  5. Authorized redirect URIs in Google Cloud:
     - `https://app.myclash.fr/auth/v1/callback`
     - Optional, local dev only: `https://api.myclash.localhost/auth/v1/callback` (Traefik fronts GoTrue in dev too)
  6. Self-hosted GoTrue redirect allow-list is configured in compose, not in a hosted Supabase dashboard:
     - `https://admin.myclash.fr/auth/oauth/callback`
     - `https://app.myclash.fr/auth/oauth/callback`
     - `https://admin.myclash.fr/signup/oauth/callback`
  7. Store `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in secrets.
  8. Set `GOOGLE_OAUTH_ENABLED=true` in `.env` and redeploy.
- **Note**: Submit for verification before opening to the public.

### O-009 · Object storage decision

- **When**: Before fighter photos and event logos start being uploaded (around T-702).
- **Options**:
  - **Supabase Storage** (self-hosted, included in compose) — simplest, no extra account needed.
  - **Cloudflare R2** — cheap, S3-compatible, no egress fees. Good for production scale. Setup: create R2 bucket, generate API token, set bucket public-read for event assets.
  - **Scaleway Object Storage** — French alternative.
- **Recommendation**: Start with Supabase Storage for v1. Switch to R2 if storage grows beyond ~10 GB.

### O-010 · Local dev hosts file

- **When**: Before T-006.
- **Action**: Add to `/etc/hosts` (or equivalent):
  ```
  127.0.0.1  myclash.localhost admin.myclash.localhost staff.myclash.localhost api.myclash.localhost
  ```
- Lets the AI develop locally with the same Traefik routing as production.

---

## Phase O1 — During Development

### O-101 · PR review cadence

- **When**: Continuous.
- **Action**: Review the AI's PRs within 24 h. Merge or send back with specific feedback.
- **Trap to avoid**: Letting PRs pile up. The AI is faster at producing than you are at reviewing — this is the actual bottleneck of the project.

### O-102 · FAL 2026 raw exchange data

- **When**: Required for T-203 (Phase P2).
- **Action**: Source the per-exchange data from FAL 2026 (likely from HemaScorecard's database export, or directly from Lyon AMHE if you have it).
- **What we need**: For each match, the ordered list of exchanges with type (clean/afterblow/double), first striker, first strike value (1pt/2pt), afterblow value when applicable.
- **If not available**: Fallback is to synthesize per-exchange data that produces the published aggregates. Document this in the fixture as `synthesized: true`. The golden test then verifies aggregate-level reproduction only, which is weaker but still meaningful.
- **Critical**: Without this, T-204 (the TF_v1 golden test) is degraded. **This is the single most important data dependency in the project.**

### O-103 · HEMA Ratings outreach

- **When**: Before Phase P11 (~week 8–10).
- **Action**:
  - Reach out to HEMA Ratings maintainers (probably via the HEMA Ratings GitHub or email).
  - Confirm the public dataset URL/format is stable.
  - Ask about their preferred submission format for event results.
  - Mention MyClash as a potential pipeline; offer collaboration.
- **Outcome**: Documented import + export contract in `docs/HEMA_RATINGS.md`.

### O-104 · Beta event partner

- **When**: Identify by Phase P5 end; confirm by P10.
- **Action**: Find a HEMA event willing to run on MyClash for the first time. Strong candidates:
  - Lyon AMHE (you already have a relationship; they ran the beta companion app).
  - A small local event where falling back to spreadsheets isn't catastrophic.
- **Required from them**: Date, expected fighter count, willingness to use new tool, organizer with patience for bugs.
- **Recommend**: Beta event ≤80 fighters, single venue, weekend format.

### O-104b · Referee qualifications data for beta event

- **When**: 2 weeks before beta (Phase P9 / P15 boundary).
- **Action**: Work with the beta organizer to compile the referee pool for the event:
  - List all qualified users (referees + fighter-referees).
  - Per user, mark which of the 3 roles they can do (`arbitre_declarant`, `arbitre_assesseur`, `arbitre_table`).
  - Per user/role, assign a 1–5 confidence rating.
  - Document any role-specific notes ("only morning slots", "first time as déclarant", etc.).
- **Why**: The auto-assignment engine needs this to be useful. Without it, the organizer falls back to fully-manual assignment, which is fine but underuses the tool.
- **Format**: CSV that matches the import template in T-906.

### O-105 · Branding assets

- **When**: Before P6 (when public theming engine starts).
- **Deliverables**:
  - MyClash logo (SVG, multiple sizes).
  - Default event theme assets (placeholder hero image, default shield).
  - Favicon set.
- **Source**: Designer (paid or volunteer). The prototype HTML's design language gives a very clear direction (Cinzel, red/blue, gold, shield motifs). A designer briefed with the prototype can deliver a logo in days.
- **Budget**: €0 (volunteer) to €500 (commissioned).

### O-106 · Translations review (French)

- **When**: Phase P14 (T-1402).
- **Action**: Review the French translations the AI produces. Native speaker required (you).
- **Trap to avoid**: Don't let the AI translate without review. HEMA-specific French terminology (lice, taillade, estoc, demi-épée…) needs human judgment.

### O-107 · French HEMA terminology glossary

- **When**: Before P14.
- **Action**: Compile a glossary of HEMA terms in EN/FR pairs. Provide to the AI as `docs/glossary.md`. Examples:
  ```
  Lice → piste / arena
  Afterblow → riposte tardive
  Clean hit → touche nette
  Double → coup double
  Pool → poule
  Bracket → tableau d'élimination
  Side sword → épée de côté
  ```
- This is a human-only task because terminology is contested and community-specific.

---

## Phase O2 — Pre-Beta (last 2 weeks before beta event)

### O-201 · Privacy policy + Terms of Service

- **When**: Before Phase P15.
- **Action**: Draft (with legal advice if possible) and publish:
  - Privacy policy (GDPR — you're in EU).
  - Terms of Service.
  - Cookie policy.
  - Data retention policy.
  - Data Processing Agreement template for organizers (since they're processing fighters' personal data via your platform).
- **Templates**: iubenda, Termly, or hand-written based on a similar OSS project's docs.
- **Critical for GDPR**:
  - Right to access (Art. 15) — implemented as user data export endpoint.
  - Right to erasure (Art. 17) — implemented as account deletion.
  - Right to portability (Art. 20) — JSON export.
  - The AI can build the _technical_ mechanisms; you write the _legal_ text.

### O-202 · Monitoring & error tracking

- **When**: Before beta.
- **Setup**:
  - **Sentry** (self-hosted or cloud free tier) — error tracking. Add DSN to all 3 frontends + API.
  - **Better Stack** or **UptimeRobot** — uptime monitoring on 4 endpoints (4 health checks).
  - **Grafana + Prometheus** (optional, in compose) — for ops dashboards. Skippable for v1.
- **Deliverable**: Error reports reach you within minutes of occurring in production.

### O-203 · Backup strategy

- **When**: Before beta.
- **Setup**:
  - Cron on the VPS: nightly `pg_dump` to encrypted file.
  - Off-site rsync to **Backblaze B2** or **Cloudflare R2** (~€1–5/month for backups).
  - Retention: 30 days rolling, monthly snapshots kept for 1 year.
  - **Restore drill**: Once before beta, restore to a fresh VM and verify integrity. _If you don't test restore, you don't have backups._

### O-204 · Real-device offline scoring test

- **When**: Before beta.
- **Action**:
  - Borrow / buy 2–4 Android tablets (Lenovo Tab M-series, ~€150 each, are common cheap-and-good tablets for this).
  - Install the scoring PWA.
  - Test fully offline: enter 50 exchanges across 3 matches, kill wifi, finish, reconnect, verify all data synced.
  - Test in the actual venue (or a venue with similar wifi conditions).
- **Hard truth**: This will surface bugs the simulator/CI never finds.

### O-205 · Tablet provisioning plan

- **When**: 1 week before beta.
- **Decision**: Who owns the tablets? Options:
  - Organizer pool (each Lice team gets one).
  - Club-owned (your club provides them).
  - Scorekeeper-owned (BYOD, fragile — not recommended for v1).
- **Per Lice**: 1 tablet, 1 spare battery pack, scorekeeper account pre-logged-in.

### O-206 · Beta event communication

- **When**: 2 weeks before beta.
- **Deliverables**:
  - Announcement to participants ("This event uses MyClash").
  - Quick-start guide for fighters (how to find your pool, your matches, your workshops).
  - Quick-start guide for scorekeepers (how to enter exchanges, what to do if offline).
  - Emergency contact (you, on-site).

### O-207 · Discord / community channel

- **When**: At public launch.
- **Action**: Create a Discord server or use existing HEMA community Discord. Channels:
  - `#announcements`
  - `#help-organizers`
  - `#help-competitors`
  - `#bugs`
  - `#feature-requests`
  - `#dev` (for OSS contributors)

### O-208 · Documentation site

- **When**: Pre-launch.
- **Setup**: Use **Mintlify**, **Docusaurus**, or **VitePress** — pick one that fits your taste. Host on the same VPS or on Vercel.
- **Sections**:
  - Getting started (organizer).
  - Getting started (competitor).
  - Scorekeeper guide (with screenshots).
  - Ruleset reference (TF_v1 explained, how to add custom rulesets).
  - Self-hosting guide.
  - API reference (auto-generated from OpenAPI).

### O-209 · Backup paper scoresheets

- **When**: Beta event day.
- **Critical**: Print blank scoresheets matching the TF_v1 model. If MyClash dies catastrophically mid-event, you can fall back to paper and import results after.
- **Optional**: A printable scoresheet is also a nice export feature (T-1004 extension).

---

## Phase O3 — Beta Event Day

### O-301 · On-site presence

- **When**: Beta event day.
- **Action**: You are physically there. The first event is not the time to be remote.
- **Carry**: Laptop with full access, two phones (one for hotspot fallback), printed scoresheets (O-209), tablet chargers.

### O-302 · Pre-event check (T-minus 2 hours)

- **Action**:
  - SSH to server, verify all services up.
  - Verify Postgres backup ran last night.
  - Run a fake match end-to-end.
  - Walk to each Lice and verify the tablet logs in and goes online.
  - Test wifi at each Lice location (signal strength).

### O-303 · During event

- **Action**: Float between Lices. Watch for stuck states. Read logs in real-time.
- **Decision tree if something breaks**:
  1. Single Lice / single match issue → fall back to paper scoresheet for that match.
  2. Realtime broadcast lagging → not critical, results still record.
  3. Scoring app totally broken on a tablet → swap to spare tablet.
  4. Backend down → all tablets continue offline, sync when back. _(this is exactly what offline-first is for)_
  5. Database corruption → restore from this morning's backup; manually re-enter today's matches.

### O-304 · Post-event (within 1 week)

- **Action**:
  - Triage every reported bug into GitHub issues.
  - Write a public retro blog post.
  - Thank the organizers + scorekeepers (they made it possible).
  - Decide: ready for v1.0 release, or another beta?

---

## Phase O4 — Ongoing (after v1.0)

### O-401 · Approve community-submitted rulesets

- **As needed**.
- **Action**: When the community submits a new ruleset PR (e.g. Swordfish rules, Nordic League), review the implementation, run its tests, approve in DB.

### O-402 · Moderate fighter profile merges

- **As needed**.
- **Action**: Users will create duplicate fighter profiles. Super admin tool (T-1302) lets you merge. Watch the queue.

### O-403 · Backup verification

- **Monthly**.
- **Action**: Restore the latest backup to a throwaway VM. Verify a known query returns expected data. Document in a log.

### O-404 · GDPR data requests

- **As they come in** (rare for a sports app, but legal obligation).
- **Action**: Within 30 days, respond to access/deletion/portability requests. Most are handled by the user-facing self-service flows; the rest you handle manually.

### O-405 · Security updates

- **Continuous**.
- **Action**:
  - Watch GitHub Dependabot alerts and merge promptly.
  - Subscribe to Postgres / Node / Next.js security advisories.
  - Quarterly: rotate VAPID keys, JWT secrets (with grace period for active sessions).

### O-406 · Community management

- **Continuous**.
- **Action**: Discord moderation, GitHub issue triage, code-of-conduct enforcement.

### O-407 · Yearly cost review

- **Annually**.
- **Cost estimate (v1.0 scale)**:
  - VPS (Hetzner CX31): ~€20/month → €240/year
  - Domain: ~€12/year
  - Backup storage (R2): ~€2/month → €24/year
  - Email (Resend free tier): €0
  - Sentry (free tier): €0
  - Monitoring (UptimeRobot free): €0
  - **Total: ~€280/year**
- **Funding**: project author or HEMA community donations (Open Collective / GitHub Sponsors).

---

## Appendix A — Decisions to make (and document)

These are decisions only you can make. Capture each as a `docs/decisions/ADR-NNN.md`:

| #   | Decision                                                                            |
| --- | ----------------------------------------------------------------------------------- |
| 1   | License: **AGPL-3.0** (decided)                                                     |
| 2   | App name: **MyClash** (decided)                                                     |
| 3   | Hosting region: EU (decided), specific provider TBD                                 |
| 4   | Domain: TBD                                                                         |
| 5   | Object storage at v1: Supabase Storage (recommended) or R2                          |
| 6   | Will MyClash accept paid sponsorship/branding on the platform? (probably not at v1) |
| 7   | Funding model long-term: pure donations / optional paid org tier / grants           |
| 8   | Trademarks: register "MyClash"? (not urgent)                                        |
| 9   | Governance: solo maintainer / small team / open governance?                         |
| 10  | Versioning policy: SemVer (recommended)                                             |

---

## Appendix B — What the AI cannot do (full list)

So you know exactly where to step in:

- Make external accounts (registrar, hosting, Google Cloud, email provider, monitoring services).
- Buy or configure physical hardware (tablets, network).
- Hold relationships (HEMA Ratings team, beta organizers, designers, translators).
- Make legal decisions (privacy policy, ToS, GDPR strategy).
- Translate culturally (HEMA-French nuance).
- Test on real devices in a real venue under real wifi conditions.
- Make business / governance / funding decisions.
- Show up on event day.
- Decide what's "good enough" for launch.
- Take responsibility when something goes wrong in production.

The AI is the engineering arm. You are the project. Don't let those roles blur.

---

_End of MyClash Owner Tasks._
