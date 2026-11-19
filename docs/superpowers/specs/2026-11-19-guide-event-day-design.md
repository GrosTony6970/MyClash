# Organiser guide, part 3: the event day — design

Status: approved by the operator on 2026-11-19.

Builds on the shipped organiser guide (`docs/superpowers/archive/specs/2026-11-18-organiser-guide-design.md`
and `…-guide-concepts-and-pad-design.md`): same site (`apps/web-marketing`, `/guide` FR and
`/en/guide` EN), same Markdown collection, same tests, same screenshot script.

## Intent

The test organisers can run a tournament from the guide. On the day they also hand tablets to
volunteers who are not the scorekeeper, put screens up at the venue, fix what goes wrong, and
answer their fighters' questions. The guide says nothing about any of these yet.

## Goals

- The third contents section, "Scoring pad", becomes **"Event day"** / **"Le jour J"**. It keeps
  the scorekeeper sheet (16) and the pad reference (17) and adds, in this order:
  1. **Welcome desk sheet** (18): one printed A4 page for the check-in volunteer.
  2. **Gear check sheet** (19): one printed A4 page for the gear check volunteer.
  3. **Screens at the venue** (20): the piste screen, the list of screens, the bout pop-up from
     the pad, the wall view of the whole Event, the Live page for phones; where each link is;
     what a Test or Draft Event needs.
  4. **When something goes wrong** (21): by symptom — a wrong score after the bout, a fighter who
     withdraws or is injured, a no-show, a missing referee, a lost tablet or PIN, a hit refused
     after offline scoring, running late, the wrong fighters or piste. Each: what to do, who can
     (role), what is refused.
  5. **For your fighters** (22): written to fighters, for the organiser to forward. It opens with
     what the organiser must do first (publish a Standard or Club Event — fighters see "not
     found" at a Test Event; enter each fighter's email, which the profile claim needs).
- Screenshots (operator choice: "Add screen shots"), English only, from the same script and the
  same Test Event.

## Constraints

Unchanged from parts 1 and 2: FR and EN for every page (hard rule 6); no real person in any
screenshot (hard rule 7); labels copied from `packages/i18n`; facts checked against the code,
never the docs alone; the screenshot Event is `test` kind and is deleted; ask the operator before
each run on the deployed stack; the `myclash-gates` chain before pushing. Each printed sheet fits
on one A4 page in both languages.

## Approaches

The approach of parts 1 and 2 stands. Rejected: a fourth section for the fighters page (the
operator kept it in "Event day").

## Left to the builder

Slugs, titles, the screenshot list and where each image sits, and the commit split.
