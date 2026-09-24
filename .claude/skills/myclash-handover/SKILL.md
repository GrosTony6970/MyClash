---
name: myclash-handover
description: Hand a MyClash session over to the next one — ground truth from git, gh and the pins, a dated READ FIRST section in the handoff, the slice's memory note and MEMORY.md line, then the prompt file and the prompt. Use when asked for a handover, a handoff or the prompt for a new session, and before ending a session that leaves work uncommitted.
---

# MyClash handover

The next session starts with none of this one's context. It reads `CLAUDE.md`, the handoff's READ
FIRST section, the memory notes the prompt names, and the prompt. Anything that lives only in this
chat is lost. A handover is therefore four writes to disk and one reply, in this order, and it ends
when the prompt in the chat is the prompt on disk.

Paths. The handoff is the file `MEMORY.md` names under "Product direction" — today
`C:\Users\Tony\.claude\plans\w3-remaining-work-handoff.md`; a new work track gets a new file and that
line moves. Memory lives in `C:\Users\Tony\.claude\projects\f--Github-Repo-MyClash\memory\`. The
prompt file is `C:\Users\Tony\.claude\plans\next-session-prompt.md`.

## 1. Ground truth

Read it from the environment, not from what the session remembers.

- `git fetch`, `git log --oneline -1`, `git status --short`. Other sessions push here, so HEAD is
  `origin/main` after the fetch. A dirty tree is the first fact of the handover: name every file, the
  state it is in (built, tests green, falsified, reviewed) and the next action. A patch parked in the
  scratchpad counts as dirty.
- Every commit pushed this session: `gh run list --commit <full sha> --workflow CI --json
status,conclusion,databaseId`, then `gh run view <id> --json jobs` for a failed run. Trivy
  web-marketing is the known red; every other red job is named. A run still in progress is reported
  as in progress.
- The pins: read the three lengths in `apps/api/src/common/auth/route-authz.test.ts` (UNDECIDED,
  DECIDED_ELSEWHERE, FALSE_PASSES).
- The last migration number in `packages/db/migrations`, when a migration landed or is next.
- This session's scratchpad path and the scripts the next session needs: the falsifiers, `gates.sh`,
  `tail_r.part`, the baseline ledger scripts.
- Background work: wait for a running gate chain or falsifier to finish. A stopped chain keeps
  writing its log folder and a falsifier edits files in place; a handover written over either lies.

Done when every SHA of the session has a CI verdict, and the tree is clean or every dirty file is
named with its state.

## 2. The handoff's READ FIRST section

Add at the top of the handoff:

```
## READ FIRST — <YYYY-MM-DD HH:MM> HANDOVER: <one line of state>; next = <the first thing to do>
```

and retitle the previous one `## (historical) …`. In order: the commits pushed (SHA, one line, breaks
and coverage), the pins, CI, the scratchpad and its scripts, the dirty tree, the next item with
whatever recon or plan already exists, the questions for the operator (unruled: do not build),
named-not-fixed findings each verified in code by a review, and the new traps.

A ruling given this session goes into the numbered rulings list with its date, the story it was asked
with, the ruling and `DONE <sha>`. Rulings live there and nowhere else, so the next session never
re-asks one.

Done when a reader of this section alone knows HEAD, CI, the pins, what is dirty, what is next and
what is open.

## 3. Memory

- The slice note (`project_<slice>.md`) gets each commit since its last update: SHA, what, breaks, and
  **what surprised us** — the hook a fresh session would fall into, not a summary of the diff.
- `MEMORY.md`: one line per slice under "Shipped slices — newest first", about five inline; the
  oldest moves to `project_shipped_slices_archive.md`. Measure the file: it stays under 17,100 bytes.
- `project_state.md` only when a fact of the environment changed: a login such as `gh`, a tool, a
  cadence.
- A lesson that binds every future session becomes its own `feedback_*` or `reference_*` note,
  linked with `[[name]]`.

Edit these as bytes (`read_bytes().decode()` / `write_bytes()`): `write_text` writes CRLF on Windows,
and `MEMORY.md` mixes line endings.

Done when `MEMORY.md` is under the cap and names every slice pushed this session.

## 4. The prompt file

Start from the previous prompt in `next-session-prompt.md`, change only what this session changed,
and overwrite the file. The sections, in order:

1. **Repo and reading order** — `CLAUDE.md`, then the handoff from its READ FIRST section down, then
   `MEMORY.md` and the notes this work needs, named.
2. **State** — HEAD, the CI verdict, the pins, `gh` is authenticated, the concurrent-sessions rule
   (fetch, log, status; never `git stash`).
3. **Scripts** — the scratchpad path, the scripts to copy and read first, how a new falsifier is built.
4. **Work, in order** — the next item first with its plan, then the rest of the queue, then the
   questions to ask the operator before building.
5. **Per-item process** — the steps every item goes through, from recon to report. Carried forward;
   edited only when the work changed it.
6. **Reuse, don't copy** — the shared pieces the next item must use.
7. **Lessons** — one line each, the trap in the reader's terms; the full list stays in the handoff.
8. **Out of scope unless I say "go"** — carried forward.
9. **Working rules** — carried forward, plus the tool rules that bit this session.

Dates absolute, SHAs short, paths and commands exact. Rulings live in the handoff, so the prompt
points at them and repeats none.

Done when every section is present and every SHA, path, pin and CI verdict in it comes from step 1.

## 5. The reply

One line of context, then the one thing that would surprise the reader — the wait-what — in
Simplified Technical English with the nouns of `docs/HIERARCHY.md`. Then the prompt in a fenced
block, byte-identical to the file.
