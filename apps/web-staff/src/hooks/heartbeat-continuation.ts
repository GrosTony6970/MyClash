/**
 * Should the tablet keep beating after this response?
 *
 * ── Why this is a module and not three lines inside the hook ────────────────
 * `apps/web-staff/vitest.config.ts` runs `environment: 'node'` and collects
 * `.test.ts` only — no `.tsx`, no DOM — and the repo has no
 * @testing-library. A rule living inside a hook is a rule nothing can assert,
 * which is the same reason `staff-session-decision.ts` and `resume-guard.ts`
 * are modules. This one is worth asserting: it is the fix for a bug that took
 * a venue off the air.
 *
 * ── What went wrong ─────────────────────────────────────────────────────────
 * `HeartbeatRunner` sits in the ROOT layout, so the beat runs on every page of
 * this app, `/login` included. `useHeartbeat` swallowed every error by design
 * and never looked at the response, so a tablet with no staff session POSTed
 * `/api/v1/staff/heartbeat` every 20 s and collected a 401 every time, for as
 * long as the tab stayed open.
 *
 * The Traefik `-staff` jail on the staff API router counted 401 and 403 —
 * 60 in 10 minutes earned the SOURCE IP a 15-minute ban, and a venue shares one
 * NAT'd address. Two tabs left on the login screen reach that on their own.
 * The jail is being taken off that router in the same slice; this is the other
 * half, because a client that hammers a route it cannot use is wrong whether or
 * not anything is counting.
 *
 * ── Why only 401 and 403 stop it ────────────────────────────────────────────
 * They are the two answers that mean "not your session", and no amount of
 * retrying changes them. Everything else keeps beating: a 502 from a restarting
 * API, a 503 from the service worker while offline, a 500 — those are all
 * temporary, and a heartbeat that gave up on them would leave the organiser's
 * Live board blind to a tablet that is working fine.
 */
export function shouldKeepBeating(status: number): boolean {
  return status !== 401 && status !== 403;
}
