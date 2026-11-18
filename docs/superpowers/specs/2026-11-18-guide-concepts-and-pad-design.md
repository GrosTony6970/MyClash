# Organiser guide, part 2: concepts and the scoring pad — design

Status: approved by the operator on 2026-11-18. Not built yet.

Builds on the shipped organiser guide
(`docs/superpowers/archive/specs/2026-11-18-organiser-guide-design.md`): same site
(`apps/web-marketing`, `/guide` FR and `/en/guide` EN), same Markdown collection, same tests, same
screenshot script.

## Intent

The test organisers have a step-by-step walkthrough. They also need to understand the platform
(its words, its formats, what it does by itself), to set up rulesets and staff access, and to
prepare the people who hold the scoring tablets. Scorekeepers are volunteers on the day: they need
one printable page. The organiser needs the full reference of the pad, to train them and to fix
what goes wrong.

## Goals

- Group the contents list in three titled sections: **Step by step** (the 11 existing pages),
  **Understand MyClash**, **Scoring pad**.
- **Understand MyClash**, five pages:
  1. How MyClash works: the vocabulary of `docs/HIERARCHY.md` (Event, Tournament, Workshop, Pool,
     Match, Exchange); the three apps (organiser workspace, scoring tablets, public app); who sees
     what; the score is always calculated from the exchanges by the ruleset; offline scoring.
  2. Formats: Pools, single elimination, double elimination, Swiss. What each does, when to pick
     it, and the settings that matter (qualifiers, bronze match, second chance / repechage).
  3. What is automatic: what MyClash does by itself (pool draw with its constraints, schedule
     proposal, referee auto-assign, bracket filling from standings, winners advancing, standings,
     notifications, the start-of-day check) and what stays the organiser's decision.
  4. Rulesets: the built-in ones; creating a scoring ruleset and a penalty ruleset.
  5. Staff access: organisation members and their roles; event staff accounts (scoring, check-in,
     gear check, photos); pistes per account; the sign-in link.
- **Scoring pad**, two pages:
  1. Scorekeeper sheet: one printed page (A4): sign in, open a bout, start and pause, score,
     double and no exchange, undo, penalties, end the bout, the wifi drops, who to call. A print
     stylesheet hides the site chrome.
  2. Pad reference: every control and when it is available (clock idle, running, paused, ended),
     what it allows, keyboard shortcuts, penalties and cards, protests, corrections, reset and
     reopen, rounds (best-of), extra time and sudden death, offline rules, locks.
- About 10 more English screenshots from the same script: the pad in several states, the
  corrections drawer, the offline bar, the rulesets page, a double-elimination bracket, a Swiss
  round.

## Decisions (operator)

- Both audiences for the pad: a short printable sheet and a full reference.
- The screenshot script switches to **Link all suggested** on import, so a run reuses the
  invented profiles earlier runs created instead of making 18 new ones. Accepted risk: an
  invented name matching a real person's profile, unlikely with these names.
- Another run on prod is approved in principle; ask before running, as before.

## Constraints

Unchanged from part 1: FR and EN for every page (hard rule 6); no real person in any screenshot
(hard rule 7); labels copied from `packages/i18n`; facts checked against the code, never the
docs alone; the screenshot Event is `test` kind and is deleted; one concern per commit; the
`myclash-gates` chain before pushing.

## Approaches

The approach of part 1 stands (Markdown pages in the existing collection). The only choice:
section grouping by a `section` frontmatter field, rendered as headed groups in the contents
list. Rejected: separate collections or URL prefixes per section (more routes and tests for no
reader benefit).

## Left to the builder

The exact page slugs and titles, the screenshot list, the print stylesheet details, and how the
"Next step" chain crosses sections (it follows `order` across the whole guide).
