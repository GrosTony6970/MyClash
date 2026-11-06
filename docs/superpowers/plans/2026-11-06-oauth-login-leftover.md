# A Google sign-in leaves no copy of the login in the browser — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the operator builds native) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a Google sign-in on web-public or web-admin, the browser keeps nothing of the login: only the one-time sign-in check (the PKCE code verifier) is stored, in a first-party cookie that lasts one hour and is deleted once used (ruling 477).

**Architecture:** One storage adapter in `@myclash/api-client`, `oauthVerifierStorage()`, that the Supabase client writes through: it keeps keys ending in `-code-verifier` in short cookies and drops every other key (the session, the user). One options builder, `oauthClientOptions()`, used by both apps' `createOAuthSupabaseClient()`, so the two clients cannot drift. web-public moves from `@supabase/ssr` `createBrowserClient` (which always writes the session to a script-readable cookie, 400 days) to `@supabase/supabase-js` `createClient` with this storage, as that library's own warning advises when "you don't need the session to be readable on the server" (`@supabase/ssr/dist/main/createBrowserClient.js:22-24`). `@supabase/ssr` leaves web-public's dependencies.

**Tech Stack:** `@supabase/supabase-js` 2.x / `@supabase/auth-js` 2.118.0 (already a dependency of both apps), vitest (node in api-client; jsdom in the apps).

**Spec:** ruling 477 (`docs/superpowers/plans/2026-11-06-event-photos-slice8-privacy-policy.md`, "Rulings"), from the slice 8 cold review. Policy facts it makes true: §10 "session cookies are inaccessible to JavaScript", and §9's list (slice 8 Task 2 adds the verifier cookie's row).

## In plain words

When someone signs in with Google, our server receives their login and keeps it in its own cookies, which page scripts cannot read. But the sign-in page also left a second copy of the whole login in the browser: on the public site in a cookie that any script on the page could read for 400 days, on the admin site in the browser's local storage, with no end date. If a bad script ever ran on one of our pages, it could take that copy and act as the person. Nothing uses the copy once the server has the login.

After the fix, the sign-in page keeps only the small one-time check Google sign-in needs between leaving for Google and coming back. That check lives one hour at most and is deleted as soon as it is used. The login itself never touches the browser's storage. Nothing changes on screen.

Google sign-in has never been switched on in production (ruling 478), so no real browser holds an old copy: no clean-up is built. The Google button still shows while Google is off, and leads to an error page: named, not fixed.

## Rulings

- **477** (2026-11-06 ~16:55). The browser copy of a Google login is fixed in its own slice, before slice 8.
- **478** (~18:25). Google sign-in was never on in production: no clean-up of old copies.

The next free ruling number is **479**.

## Assumptions (mine; the operator reads them before the build)

1. **The check cookie lasts one hour** (`Max-Age=3600`), `Path=/`, `SameSite=Lax`, `Secure` on https. A Google round trip takes seconds; an hour leaves room for a slow account chooser. It cannot be `HttpOnly`: the page's script writes and reads it.
2. **The cookie names start with `mc-oauth`** (the client's `storageKey`): `mc-oauth-code-verifier`, `mc-oauth-flow-<id>-code-verifier` and `mc-oauth-flows-code-verifier` (auth-js 2.118 keeps one slot per sign-in plus an index, `helpers.js:297-340`). All end in `-code-verifier`. A hyphen, not `mc_`, so the name cannot be mistaken for one of our server's cookies.
3. **web-admin's check moves from `localStorage` to the same cookie**, for one adapter in both apps. Not because a cookie reaches further: a host-only cookie has the reach of `localStorage`. `d534e334` (2026-06-24) blamed `localStorage` for a lost verifier; the cold review's likelier cause is GoTrue falling back to `SITE_URL` on another host (`docker-compose.prod.yml:235-239`). The docblock says this, not the old reason.
4. **Each call builds a new client**, as web-admin already does; auth-js logs "Multiple GoTrueClient instances" on the second (`GoTrueClient.js:173-174`). Harmless; each opens a `BroadcastChannel('mc-oauth')` (`:270-272`): if a vitest worker hangs at teardown, close the client's channel in the test.
5. **The adapter lives in `@myclash/api-client`** (both apps depend on it; it already owns `renewLogin`). It imports nothing from Supabase: it has the `getItem/setItem/removeItem` shape `auth-js` accepts as `storage`. The two `createOAuthSupabaseClient()` stay in their apps, because each reads its own literal `process.env['NEXT_PUBLIC_…']` (Next inlines only literal reads in app code).
6. **No clean-up of old copies** (478). An old `sb-…-auth-token-code-verifier` cookie in a browser that clicked the Google button is a random string, not a login; nothing reads it after this fix.

## Global Constraints

- CLAUDE.md: no secrets in the repo; one concern per commit; a regex with a backslash goes through the Write/Edit tool.
- Every function under 50 lines, every file under 400.
- `pnpm install` after removing `@supabase/ssr`: diff `pnpm-workspace.yaml` afterwards (pnpm's release-age gate can append to `minimumReleaseAgeExclude`), and keep only the lockfile lines the removal explains.

## Review Focus

1. **The return from Google finds no check** (the 2026-06-24 failure, `AuthPKCECodeVerifierMissingError`): the app test starts the sign-in on one client and finishes it on a NEW one, as the callback page does (`auth/oauth/callback/page.tsx:117`, `OAuthCallback.tsx:82`).
2. **The login reaches storage under another key** (a future auth-js writes `-user`, `-session`, a chunked key): the adapter keeps by suffix and drops all else; the unit test writes several other keys and reads back nothing.
3. **A check cookie that lives 400 days** (`@supabase/ssr`'s default): the unit test reads `Max-Age=3600` off the written cookie.
4. **Server rendering**: the client is built only in event handlers and effects, but the adapter must not throw without `document`: unit test with no jar.
5. **The two apps drift** (one keeps `persistSession` or `localStorage`): both factories spread `oauthClientOptions()`, and each app has the round-trip test.

---

### Task 1: The storage adapter and the options (api-client)

**Files:**

- Create: `packages/api-client/src/oauth-storage.ts`, `packages/api-client/src/oauth-storage.test.ts`
- Modify: `packages/api-client/src/index.ts` — export `oauthVerifierStorage`, `oauthClientOptions`, `OAUTH_STORAGE_KEY`.

**Interfaces (produces):**

```ts
export const OAUTH_STORAGE_KEY = 'mc-oauth';
export interface CookieJar { read(): string; write(cookie: string): void; secure: boolean }
export function oauthVerifierStorage(jar?: CookieJar | null): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
// { auth: { storageKey: OAUTH_STORAGE_KEY, storage: oauthVerifierStorage(), persistSession: true,
//   autoRefreshToken: false, detectSessionInUrl: false, flowType: 'pkce',
//   experimental: { appendPkceFlowIdToRedirects: true } } }  — spread into createClient's options
export function oauthClientOptions(): { auth: { … } };
```

**Why the flow-id option (cold review B1):** auth-js writes three keys per sign-in (a slot `mc-oauth-flow-<id>-code-verifier`, the index `mc-oauth-flows-code-verifier`, and the fixed `mc-oauth-code-verifier`, `helpers.js:327-341`). Without a flow id in the return address, the exchange reads and deletes only the fixed key (`helpers.js:349-366`), so two cookies would stay their full hour. With `experimental.appendPkceFlowIdToRedirects` (`GoTrueClient.js:4838-4842`), `sb_flow_id` rides on `redirectTo`, both callback pages exchange before touching the URL (`callback/page.tsx:117`, `OAuthCallback.tsx:82`), and `removePKCEVerifier` deletes the slot, the index once empty, and the fixed key (`helpers.js:368-386`). The fixed key alone was the other option; it is a "deprecation-window dual write" (`helpers.js:337-340`) a later auth-js may drop. The redirect allow lists already accept query strings on these paths (`?mode=…&next=…` today; `/**` entries, `docker-compose.prod.yml:240`). UNVERIFIED end to end against GoTrue + Google: Google is off everywhere (478); the jsdom round trip is the proof.

The default jar (when `jar` is omitted) is `document.cookie` with `secure = location.protocol === 'https:'`; with no `document` it is `null` and every call is a no-op returning `null`.

- [ ] **Step 1: Write the failing tests** (`oauth-storage.test.ts`, node, a fake jar recording each written cookie string):
  - `keeps a code verifier in a one-hour cookie`: values as auth-js sends them, JSON text (`helpers.js:132-134`): `setItem('mc-oauth-flow-ab12cd34-code-verifier', '"v1"')` → one write starting `mc-oauth-flow-ab12cd34-code-verifier=` with `; Max-Age=3600; Path=/; SameSite=Lax`, plus `; Secure` when `jar.secure`; `getItem` of that key → `'"v1"'`. The index `'["ab12cd34"]'` round-trips too.
  - `reads a cookie by its exact name`: with `mc-oauth-flows-code-verifier` and `mc-oauth-code-verifier` both set, `getItem('mc-oauth-code-verifier')` returns its own value.
  - `a broken cookie reads as none`: a jar holding `mc-oauth-code-verifier=%E0%A4%A` → `getItem` returns `null`, no throw (`retrievePKCEVerifier` runs outside the exchange's `try`, `GoTrueClient.js:1622-1625`).
  - `writes nothing for the login or the user`: `setItem('mc-oauth', '{"access_token":"t"}')`, `setItem('mc-oauth-user', '{}')`, `setItem('mc-oauth-session', 'x')` → zero writes; `getItem('mc-oauth')` → `null`.
  - `keeps nothing under another storage key`: `setItem('sb-app-auth-token-code-verifier', 'v')` → zero writes.
  - `removing a verifier expires its cookie`: `removeItem(key)` → a write with `Max-Age=0`.
  - `a value is encoded`: a verifier with `;`, `=` and space round-trips through `getItem` (`encodeURIComponent` on write, decode on read).
  - `without a document it does nothing`: `oauthVerifierStorage(null)` — every call returns `null` / does not throw.
  - `oauthClientOptions().auth` holds `persistSession: true`, `autoRefreshToken: false`, `detectSessionInUrl: false`, `flowType: 'pkce'`, `storageKey: 'mc-oauth'`, `experimental.appendPkceFlowIdToRedirects: true`.
- [ ] **Step 2:** `pnpm --filter @myclash/api-client test oauth-storage` → FAIL (module missing).
- [ ] **Step 3:** Implement. Keep a key only when it starts with `${OAUTH_STORAGE_KEY}-` and ends with `-code-verifier`; split `document.cookie` on `; ` and match the name exactly; a value that fails `decodeURIComponent` reads as `null`.
- [ ] **Step 4:** Run → PASS; `pnpm --filter @myclash/api-client build`.

### Task 2: Both apps use it; web-public drops `@supabase/ssr`

**Files:**

- Modify: `apps/web-public/src/lib/oauth-supabase.ts` — `createClient(url, key, oauthClientOptions())` from `@supabase/supabase-js`; the docblock says why (the login stays out of the browser; the check survives the round trip in a cookie).
- Modify: `apps/web-admin/src/lib/oauth-supabase.ts` — the same.
- Modify: `apps/web-public/package.json` (drop `@supabase/ssr`), `pnpm-lock.yaml`.
- Create: `apps/web-public/src/lib/oauth-supabase.test.ts`, `apps/web-admin/src/lib/oauth-supabase.test.ts` (`// @vitest-environment jsdom`).

- [ ] **Step 1: Write the failing round-trip test** (same body in both apps): set the two `NEXT_PUBLIC_SUPABASE_*` env values; stub `globalThis.fetch` so `POST …/token?grant_type=pkce` answers a session JSON (`access_token: 'secret-access'`, `refresh_token: 'secret-refresh'`, a `user`) and records the body. `test('a google sign-in keeps only the check, and leaves no login behind')`:
  1. `const { data } = await createOAuthSupabaseClient().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/oauth/callback`, skipBrowserRedirect: true } })` (jsdom runs at `http://localhost:3000`; a `pushState` to another origin throws `SecurityError`).
  2. Read `redirect_to` from `data.url`; assert it carries `sb_flow_id=`. `history.pushState` to it plus `&code=abc`; snapshot `document.cookie` and `localStorage` as `beforeReturn`.
  3. On a NEW client: `exchangeCodeForSession('abc')` → `data.session.access_token === 'secret-access'`; the recorded token body carries a non-empty `code_verifier`.
  4. **First the defect:** `document.cookie` and every `localStorage` value contain neither `secret-access` nor `secret-refresh`.
  5. Then the shape: no cookie name ends in `-code-verifier`; `localStorage.length === 0`; `beforeReturn` held a cookie named `mc-oauth-flow-…-code-verifier` (the check lived in a cookie, not in `localStorage`).
     A comment says jsdom may lack `crypto.subtle`, so auth-js may fall back to the `plain` method; the test does not depend on it.
- [ ] **Step 2:** Run (`pnpm --filter @myclash/web-public exec vitest run oauth-supabase`; web-admin: `pnpm test oauth-supabase`) → FAIL at assertion 2 (no `sb_flow_id`: the option is off today). Then, to see the real defect red, temporarily add only the flow-id option to each old factory → FAIL at assertion 4 (web-public: the login cookie; web-admin: `localStorage`); revert.
- [ ] **Step 3:** Rewrite both factories. Remove `@supabase/ssr` from web-public, `pnpm install`, diff `pnpm-workspace.yaml` and the lockfile.
- [ ] **Step 4:** Run both → PASS. Falsify (each proven to change the file): the adapter keeps every key → RED (unit and both apps); `Max-Age=3600` → `34560000` → RED; web-admin factory without `oauthClientOptions()`; the flow-id option off → RED (assertion 2) → RED; `storageKey` `'mc-oauth'` → `'mc-x'` in the options → RED (unit).
- [ ] **Step 5:** `pnpm --filter @myclash/web-public typecheck && pnpm --filter @myclash/web-admin typecheck`; `pnpm perf:bundle` (one dependency fewer).

### Task 3: Proof, review, commit

- [ ] `gates.sh <absolute outdir>` → 33/33.
- [ ] Cold code review (opus); fix test-first.
- [ ] Commit `fix(auth): a google sign-in leaves no copy of the login in the browser`; `git fetch`, explicit stage list from `git status --short`, push, `watch-ci.sh <full sha>`. Pushable alone: it changes no policy text.
- [ ] Slice 8's plan: Task 2 adds the `mc-oauth-…-code-verifier` row (§9, "During a Google sign-in, links the return from Google to the browser that started it; deleted once used — 1 hour") and a `LIBRARY_COOKIES` entry (`source: packages/api-client/src/oauth-storage.ts`, must contain `OAUTH_STORAGE_KEY = 'mc-oauth'`).

## Named, not fixed

- The Google button shows on both sign-in pages while Google is off in production (`login/page.tsx:347-352`, `AuthPage.tsx:153`), and leads to GoTrue's error answer.

## Reviews (2026-11-06)

- Own axis pass: clean (no schema, no gate added, api-client built before the apps read it).
- **Cold plan-reviewer (opus)**: 1 BLOCKER, 2 MAJOR, 4 MINOR, 3 NIT, all checked in the installed auth-js before folding. BLOCKER — without `experimental.appendPkceFlowIdToRedirects` the exchange deletes only the fixed key, two check cookies stay an hour (`helpers.js:327-386`): option on, `sb_flow_id` asserted. MAJOR — a `pushState` to `http://localhost/` throws in jsdom (origin `:3000`): `window.location.origin`; the test went red before reaching the defect: the login-copy assertion now comes first, and Step 2 names both reds. MINOR — `decodeURIComponent` guard, exact-name read, JSON-shaped values, the 06-24 reasoning corrected (assumption 3). NIT — many-clients warning and `BroadcastChannel` (assumption 4); the cookie also reaches our own server on each request (same host); api-client ships to web-staff (~40 lines).

## As built (2026-11-06)

- Built as planned. Red order seen in both apps: assertion 2 (no `sb_flow_id`), then, with only the flow-id option on the old factory, the login-copy assertion.
- **The first test missed the defect on web-public.** `@supabase/ssr` writes the login as `base64-<base64url JSON>`, so a plain search for `secret-access` found nothing and the test went red only on its last line. The test now reads each cookie as a script would (URL-decoded, `base64-` decoded) and also requires that no cookie at all is left after the exchange.
- Falsified, each break proven in the file (and in `dist` for the app rows): the adapter keeps every key → RED unit (2) and both apps; `Max-Age` 400 days → RED unit (2); `storageKey` `'mc-x'` → RED unit; flow-id option off → RED unit and both apps at assertion 2; web-admin back on `localStorage` → RED admin. Collected counts unchanged (11, 1, 1).
- `pnpm-lock.yaml`: only the `@supabase/ssr` lines go; `pnpm-workspace.yaml` unchanged.
- **Cold code review (opus): 0 BLOCKER, 0 MAJOR**, 3 MINOR, 4 NIT. Fixed: the docblock said the login "never reaches a place a page script could read", but auth-js broadcasts it once to the site's other tabs and the callback page holds it in memory: now "never stored"; the real `location.protocol` decision had no test: an https/http case on a stand-in `document` (RED with `secure: false`); an abandoned sign-in's cookies live their hour: said in the docblock; `index.ts` exports only `oauthClientOptions`. Left: one `BroadcastChannel` per client, never closed (one per click). Open: the flow is unproven against real GoTrue and Google (478); run one real Google sign-in before Google is switched on.
