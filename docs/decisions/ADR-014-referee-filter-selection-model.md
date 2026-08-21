# ADR-014 — The referee workspace's two filter rows are deliberately different controls

**Date:** 2026-08-21
**Status:** Accepted

## Context

The Assignments tab of the referee workspace shows every scheduled unit of an event on one
timeline. Before this slice it could be narrowed by day and nothing else, so an event day carrying
four tournaments rendered one long undifferentiated list.

Adding a tournament filter put two filter rows side by side in the same card, and the obvious
instinct — make them look and behave alike — is wrong here. The two rows answer different
questions:

- **A day is where you are.** You are working Saturday, or you are looking at the whole event.
  These are mutually exclusive, and "the whole event" is a real, frequently-wanted view.
- **A tournament is what you care about within that day.** An organiser staffing Saturday morning
  wants Longsword _and_ Sabre but not the Rapier pools two pistes over. That is a subset, not a
  choice of one, and the useful default is everything.

The existing day row already had the shape a single-select needs: an "All days" sentinel chip plus
one chip per day.

## Decision

**The day row is single-select with an "All days" sentinel. The tournament row is multi-select,
every option on by default, with a leading "All" chip that re-selects them.** The two rows are not
harmonised.

Three consequences follow, each chosen on purpose:

- **Zero tournaments selected is a legal state.** The timeline goes empty and says so. A filter
  whose last chip refuses to switch off enforces a rule the operator cannot see, and the empty
  result is self-explanatory the moment it appears.
- **Picking a day resets the tournament selection** to everything that day has. A tournament hidden
  on Saturday must not open Sunday already hidden — a filter that silently remembers a choice made
  against a list you are no longer looking at is how someone ends up staring at a timeline missing
  a pool they never chose to hide. The reset lives in the day chip's click handler, not an effect,
  because `react-hooks/set-state-in-effect` is an error in this app.
- **The tournament row renders even when the day has one tournament.** Hiding it would make the
  card change height as the operator clicks through days.

**The selection state holds `null` for "untouched"**, which resolves to every tournament the
selected day offers. That is what makes the default and the reset need no effect at all: an
explicit array — including an empty one — means the operator chose.

## Consequences

- **Easy:** the common case is one click. Land on the tab and everything is shown; narrow to a day
  and the tournament row follows without a second thought.
- **Hard:** two controls that look similar behave differently, and a future contributor will read
  that as an inconsistency to tidy up. That is precisely why this file exists.
- **Committed to:** neither row persists. Both reset on reload, matching what the day filter always
  did. Adding persistence later means deciding what a stale tournament id means when the board has
  moved on, which is a question this slice deliberately does not open.

## Alternatives considered

- **Both rows single-select, mirroring the day row.** Rejected: it makes the common case — "these
  three tournaments, not that one" — impossible to express, and contradicts the useful default of
  showing everything.
- **Multi-select with the last chip locked.** Rejected: the locked chip is an invisible rule. The
  operator clicks, nothing happens, and there is nowhere to read why.
- **Carrying deselections across a day change.** Rejected as described above — it hides units
  without the operator having chosen to hide them on the day they are looking at.
- **A "Reset" link that appears only when something is deselected.** Rejected in favour of the
  leading "All" chip: a control that moves and disappears is harder to find than one that is always
  in the same place, and the chip's unlit state doubles as the signal that a filter is active.
