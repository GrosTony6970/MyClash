# Organiser guide, part 4: more than a tournament — design

Status: approved by the operator on 2026-11-19, with rulings 888-890
(`docs/notes/quick-wins-2026-10-08.md`): bugs 1-3 below are fixed first, one commit each (bug 4
is the house rule, kept: every member sees the setting and the server refuses); a
regenerated recap leaves the published one live; French says **Atelier** and **Instructeur**. The
pages then describe the fixed app. Shipped 2026-11-19.

What the build found against this spec:

- **No AI settings picture.** The deploy seeds an AI key into the E2E club, and that page lists the
  club's keys with their spend. The script checked for a key, found one and stopped; the shot is
  gone, and the AI page is text only.
- **No workshop schedule picture.** Its grid needs a workshop venue, which belongs to the club and
  would outlive the test Event.
- **The form and roster windows were first shot while fading in.** The script now waits for the
  window's content and for every animation to end, then shoots the window alone.
- **Reported, not changed:** the built-in FFAMHE compensation plan's description is French
  ("Plan de compensation officiel FFAMHE…") on the English screen. It is seed data, not an i18n
  key (hard rule 6).

Builds on the shipped organiser guide (`docs/superpowers/archive/specs/2026-11-18-organiser-guide-design.md`,
`…-guide-concepts-and-pad-design.md`, `2026-11-19-guide-event-day-design.md`): same site
(`apps/web-marketing`, `/guide` FR and `/en/guide` EN), same Markdown collection, same tests, same
screenshot script.

## Intent

Part 1 left out Workshops, Leagues, referee compensation and the AI features ("each can get its own
page later"). A test organiser who runs classes, belongs to a league, pays referees or adds an AI key
finds nothing in the guide about it today. Part 5 ("After the event": debrief, print pack, photos,
notifications for organisers) comes after this one.

## Goals

A fourth contents section, **"More than a tournament"** / **"Au-delà du tournoi"** (`section: beyond`,
orders 23-26), with four pages:

1. **Workshops** (23). Create a workshop, its sessions, its instructors (tag them on the
   Participants page first), publish it. Sign-ups: who can book, the waitlist and its automatic
   seat, one place per workshop, no payment. The roster window: add, promote, remove, present,
   message. What is refused (delete with bookings, an instructor booking their own class). The
   link with refereeing (teaching at the same time is a hard block; attending is a switchable
   discouragement). Who may do what (`workshop_lead` and above; a workshop's own instructor).
2. **Leagues** (24). What a league is; only the MyClash team creates one; join a league; attach a
   Tournament (request, then a league manager accepts); manage it if your club is a league admin
   (basics, ruleset, groups, tournaments, requests, admins); publish. When standings update and
   when they do not (never when a bout ends on a running Event). Only Standard Events and
   published Tournaments count. Where the public sees standings.
3. **Paying referees** (25). Points per completed bout, by referee role and phase; the tiers turn
   the Event total into an amount in EUR; minimum and cap; the report, CSV and PDF; "Paid" is a
   record only. The built-in FFAMHE plan in a table. Plans belong to the club, not the Event. A
   total that falls between two tiers pays 0.
4. **AI features** (26). The org's own key (Anthropic, OpenAI, Mistral, Google) and the switches;
   the four tools (setup assistant, chatbot, tournament recap, event description); nothing is
   written without a person confirming; what each tool sends to the AI provider, names included;
   budgets; chat conversations are shared with every admin of the club.

Screenshots, English only, from the same script and Test Event, where a Test Event can show them:
the workshop form, the workshop schedule and the roster; the club's Leagues page; the compensation
plan and report (only if the script's bouts carry referee assignments); the AI settings page as it
looks with no key. No league standings shot (a Test Event never counts). No AI output shot (the E2E
club has no key, and the script must not add one).

## Facts the code holds (checked; organisers would guess these wrong)

- A workshop can have **several sessions** (migration 0257, ruling 515). Capacity belongs to the
  workshop and repeats in each session. The admin form starts it at 20 and offers no "unlimited".
- Instructors appear in the form only once they are tagged on the Participants page, and a tag
  needs a global profile.
- A waitlist promotion is notified even at a Test Event, but only to a person with an account.
- Leaving a league does not take back points already counted (see Bug 1).
- Reopening a finalized league season does not recompute it.
- Compensation is worked out again on each page load, so it moves while bouts finish.
- The form assistant sees only the Event name and your prompt, so pool, schedule and referee drafts
  often fail. The chatbot sees lists, counts and referee names.

## Bugs found while checking (each its own fix, outside this slice)

1. **Points stay after a Tournament leaves a league.** The organiser's **Withdraw** / **Leave**
   (`leagues.service.ts:1228-1247`) sets the link to `removed` but keeps its results. The league
   manager's review path clears them and re-ranks (`:1137-1142`), and its comment names this exact
   failure. Fix: the same clearing on both paths.
2. **The chatbot can change a completed Event.** **Confirm & apply**
   (`organizer-chat.controller.ts:157`) calls the same `applyDraft` as the form assistant, but has
   no `@BlockOnCompletedEvent()`, which the form's **Apply** has (rulings 283, 283a). Fix: add it.
3. **The Recompute hint is wrong.** It says rankings recompute "when an event changes status"
   (`packages/i18n/src/messages/en/admin.ts:143`). Only completion and a change of kind do.
4. **A workshop lead sees the self-join switch but cannot save it** (needs `admin`). Not a bug:
   the house rule, as Branding, the menu card and photo mode. Kept; the Workshops page says so.

Two calls for the operator, not bugs yet:

- Regenerating a published recap saves it back as a draft (`generated-content.service.ts:180-183`),
  so the public loses it until someone publishes again.
- French names one thing two ways: **Stages** (sidebar) and **Ateliers** (page); **Intervenant**
  (workshop form) and **Instructeur** (Participants page).

## Constraints

Unchanged from parts 1-3: FR and EN for every page (hard rule 6); no real person in any screenshot
(hard rule 7); labels copied from `packages/i18n`; facts checked against the code, never the docs
alone; the screenshot Event is `test` kind and is deleted; ask the operator before each run on the
deployed stack; the `myclash-gates` chain before pushing. The guide describes the code as it is when
the page ships.

## Approach

The approach of parts 1-3 stands. The new `section` value goes in `src/content.config.ts` and its
title in `CHROME` (`src/i18n/ui.ts`).

## Left to the builder

Slugs, titles, the screenshot list and where each image sits, and the commit split.
