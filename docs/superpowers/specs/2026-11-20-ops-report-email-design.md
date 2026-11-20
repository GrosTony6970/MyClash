# The ops report email, in colour — design

Request A of the ops requests track (2026-11-20). The operator: "a more beautiful email for the
daily report, the one I'm receiving is quite raw, add some color, define sections".

## In plain words

Every morning the ops agent sends the operator one email. Today it is a wall of plain text: the
operator has to read to the third block to learn whether anything is wrong.

After this slice the same email opens on a coloured band: green "all good", red "1 problem", dark
red "platform unreachable". Below it, each of the twelve sections sits in its own block with its
name as a title. A problem line is red. Words such as `critical`, `warning` and `healthy` carry
their colour. The log lines show in a fixed-width font. The plain text still travels in the same
email, so a mail app that shows no HTML shows exactly what the operator gets today.

The agent writes the same text as before. The skill gains one sentence: each section starts with
its name alone on a line. If one morning the agent writes something the sender cannot split into
sections, the email still goes, with the band and the whole text in one block, and a grey line
says "The report's sections were not recognised".

## Rulings

- **910** (operator, 2026-11-20). Story: "at 7:00 the run finds web-public down and restarts it;
  the operator opens the email and wants red, 1 problem, at a glance". **The sender dresses the
  text**: the run keeps writing plain text with fixed section names, and `send-report.mjs` builds
  an HTML part from it and keeps the text part. Not a JSON report (more for the agent to get
  right each morning), not HTML written by the agent (log text inside markup).
- Language: **English, as now** — ruling 879 stands; no new ruling.

## Design

### Who owns what

- `.claude/skills/myclash-ops/report-html.mjs` (new): `renderReportHtml(subject, text)` → an HTML
  document string. Pure, no I/O, plain Node (the cloud runs a fresh clone with no `node_modules`
  and no built `dist`).
- `send-report.mjs`: posts `{ from, to, subject, text, html }`. The `html` comes from
  `renderReportHtml`. The text part stays exactly the file's text.
- **The escaper.** The platform's one HTML escaper is `escapeHtml` in `packages/types/src/html.ts`.
  The skill cannot import it: the cloud clone has no build, and Node's type stripping depends on
  the cloud's Node version (a failed import would cost the morning's email). So
  `report-html.mjs` holds its own five-character escaper, and a test runs both escapers on the same
  inputs and requires the same output. That test makes the copy a held mirror, not a second
  owner that can drift.
- **A renderer that throws never costs the email.** `send-report.mjs` catches it, sends the text
  part alone, and prints `sent <id> text-only` (still a `sent` line, exit 0, so §6 is unchanged).
  The trace is that line in the run log and the plain email the operator gets.
- SKILL.md §5 gains one sentence (the section names alone on a line). Nothing else in the skill
  changes. The ops track's live checks read SKILL.md from `main`: the operator is told.

### Parsing the text

- A **heading** is a line that, after trimming and after removing a leading `#`s, a leading
  `<n>.`, surrounding `**`, and a trailing `:`, equals one of the twelve section names of §5,
  ignoring case. `Problems` also matches `Problems (wait for you)`.
- `<name>: <rest>`, `**<name>:** <rest>` or `<name> — <rest>` on one line (an agent writes
  `VERDICT: all good`) is the heading plus a first row `<rest>` — **only when the text has no bare
  heading for that name**. A problem row reads `Certificates: 5 days left` and a health row
  `containers: critical`; when the agent wrote those sections' own headings, the row stays a row
  (found by the whole-slice review: it hid a problem). The separator is required, so
  `Run type daily` stays a row.
- A name opens a section only once, and only after the sections before it: the Logs section quotes
  log lines, and a line that reads `Problems` there stays a row.
- A line longer than 120 characters is never a heading (a heading is short, and the lazy match
  must not run on a long log line).
- A line made only of `-`, `=`, `_` or `*` (an underline under a heading) is dropped.
- Lines before the first heading go in an untitled first block.
- Zero headings → **fallback**: the whole text in one block, and the grey line above. This branch
  fires whenever the agent drifts, and its trace is the grey line in the email the operator reads.
- Some headings, not all twelve → a grey line "Sections not found: …" names the missing ones.
- A leading `- `, `* ` or `• ` is a bullet: it is removed and the line becomes a list row.
- Empty lines are dropped.

### The look

Inline styles only, table layout, max width 600 px, the platform emails' conventions
(`apps/api/src/modules/mail/mail-templates.ts`). No logo image: the image would be fetched from
the production host, which serves a staging certificate a mail client refuses; the wordmark stays
text ("MyClash · ops report").

- **Band** from the subject's last part (after the last `·`): `all good` → green;
  `^\d+ problems?(\(s\))?$` → red; `platform unreachable` → dark red; anything else → grey. The
  band's text is the subject after `MyClash ops · ` (`daily · 1 problem(s)`), escaped. The colour
  is also a `bgcolor` attribute, for Outlook desktop.
- **Sections**: a small upper-case grey title, then the rows. Problems rows are red and bold,
  except a row that starts `None`, `Nothing` or `No problem` (not `None of`): an all-good morning
  shows no red row. Logs rows use a monospace font and break long words (Outlook ignores
  `word-break`: a very long token can widen the email there).
- The outer table carries `width="600"`: Outlook ignores `max-width`.
- **Status words**, whole word, case-insensitive, after escaping: `healthy`, `success`, `healed` →
  green; `warning` → amber; `critical`, `unavailable`, `unhealthy`, `failed`, `unreachable` → red.
  A green word right after the word `not` (`not healed`, `not healthy`) stays uncoloured: a failed
  repair must never show green.
- **Colours** are the light theme's values in `packages/ui/src/theme.css` (email cannot read a
  token, as `mail-templates.ts:25` says): success `#137337`, warning `#a24b08`, danger `#be2121`,
  dark red `#991b1b` (`--color-danger-hover`), muted `#64748b`.
- **Footer**: "Sent by the MyClash ops agent. The plain-text part of this email holds the same
  report."

### Safety

Every value that reaches the HTML (subject, every line) is escaped before any markup is added. The
status-word colouring runs on escaped text and only wraps whole words of a fixed list. A test feeds
`<script>`, `"`, `'` and `&` through the subject and the body and finds none of them raw.

## Tests (each seen red first)

`scripts/ops-skill-report.test.mjs` (the email) and a new `scripts/ops-skill-report-html.test.mjs`
(the renderer):

1. The send posts `html`, and `text` is still the file's text byte for byte.
2. The band: green / red / dark red / grey, one case each.
3. Sections: the twelve names become twelve titled blocks; `4. **Problems (wait for you):**`
   is a heading; `- x` becomes a row `x`.
4. Problems rows red; Logs rows monospace; status words coloured; `not-a-healthy` style substrings
   are not.
5. Fallback: a text with no heading → one block and the grey line.
   5b. `VERDICT: all good` is a heading with a row; `-----` is dropped; `not healed` is not green.
   5c. A renderer that throws: the post carries `text` and no `html`, the line is `sent <id> text-only`.
6. Escaping: no raw `<script>`, quote or ampersand from the subject or body.
7. Escaper parity with `@myclash/types` `escapeHtml` over a fixed list of inputs.
8. `report-html.mjs` is carried to the cloud (`ops-skill.test.mjs`'s not-ignored list).
9. The skill names the new §5 sentence (`ops-skill.test.mjs`'s pin list).
10. The real loading path: the sender copied beside a renderer that does not parse still reaches
    the send (a static import of the renderer turns it red).
11. The fix pass: a `Certificates:` problem row stays red under Problems; a health row
    `containers: critical` stays in Health; `**Verdict:** all good`; a 160-character
    heading-shaped line is a row; `None today` is plain.

## Live proof

The throwaway routine `trig_016FNfhEmgCbkfowUvVg8sDf`: a prompt that runs the read-only round,
writes a report, and sends it. The operator confirms the email looks right in their mail app.
