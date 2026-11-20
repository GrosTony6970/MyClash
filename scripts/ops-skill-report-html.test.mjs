/**
 * The ops report's HTML part (`.claude/skills/myclash-ops/report-html.mjs`, ruling 910): the
 * sender dresses the agent's plain text. The send itself is `ops-skill-report.test.mjs`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeHtml as platformEscape } from '../packages/types/src/html.ts';
import { escapeHtml, renderReportHtml } from '../.claude/skills/myclash-ops/report-html.mjs';

const SECTIONS = [
  'Run',
  'Running',
  'Verdict',
  'Problems (wait for you)',
  'Notes',
  'Health',
  'Containers',
  'Backups',
  'Certificates',
  'Host',
  'Logs',
  'Done by Claude',
];
const SUBJECT = 'MyClash ops · daily · all good';
const RED = '#be2121';
const GREEN = '#137337';
const AMBER = '#a24b08';
const DARK_RED = '#991b1b';
const GREY = '#64748b';
const NOT_RECOGNISED = 'The sections of this report were not recognised';

/** The band is the first element that carries the band's marker attribute. */
function band(html) {
  return html.match(/<td data-band[^>]*>/)?.[0] ?? '';
}

function sectionTitles(html) {
  return [...html.matchAll(/data-section-title[^>]*>([^<]*)</g)].map((m) => m[1]);
}

describe('the band, from the subject', () => {
  for (const [ending, colour] of [
    ['all good', GREEN],
    ['2 problem(s)', RED],
    ['platform unreachable', DARK_RED],
    ['something new', GREY],
  ]) {
    it(`"${ending}" is ${colour}`, () => {
      const html = renderReportHtml(`MyClash ops · daily · ${ending}`, 'Run\ndaily');
      assert.match(band(html), new RegExp(`background:${colour}`));
      assert.match(band(html), new RegExp(`bgcolor="${colour}"`), 'Outlook reads the attribute');
      assert.ok(html.includes(`>${escapeHtml(`daily · ${ending}`)}<`), 'the run type and verdict');
    });
  }
});

describe('the sections', () => {
  it('each of the twelve names opens its own titled block', () => {
    const text = SECTIONS.map((name) => `${name}\nline of ${name}`).join('\n\n');
    const html = renderReportHtml(SUBJECT, text);
    assert.deepEqual(
      sectionTitles(html),
      SECTIONS.map((name) => escapeHtml(name)),
    );
    assert.equal(html.includes(NOT_RECOGNISED), false);
  });

  it('reads the shapes an agent writes: upper case, a number, bold, a colon, a short name', () => {
    const text = [
      'RUN',
      'daily',
      '## 2. Running',
      'abc1234',
      '**3. Verdict**',
      '1 problem',
      '4. **Problems (wait for you):**',
      '- web-public exited 1',
      '**Notes**:',
      'old backup',
      '**health**',
      'ok',
    ].join('\n');
    const html = renderReportHtml(SUBJECT, text);
    assert.deepEqual(sectionTitles(html), [
      'Run',
      'Running',
      'Verdict',
      escapeHtml('Problems (wait for you)'),
      'Notes',
      'Health',
    ]);
    assert.ok(html.includes('>web-public exited 1<'), 'the bullet is removed');
    assert.equal(html.includes('- web-public'), false);
  });

  for (const line of [
    'VERDICT: all good',
    '**Verdict** — all good',
    'Verdict - all good',
    '**Verdict:** all good',
  ]) {
    it(`"${line}" on one line is the heading and its first row`, () => {
      const html = renderReportHtml(SUBJECT, `Run\ndaily\n${line}`);
      assert.deepEqual(sectionTitles(html), ['Run', 'Verdict']);
      assert.ok(html.includes('>all good<'));
    });
  }

  it('a section name comes once, in order: a quoted log line cannot open a block', () => {
    const html = renderReportHtml(SUBJECT, 'Logs\n- Problems\nNotes\nDone by Claude\nNothing');
    assert.deepEqual(sectionTitles(html), ['Logs', escapeHtml('Done by Claude')]);
    assert.ok(html.includes('>Problems<'));
    assert.ok(html.includes('>Notes<'));
  });

  it('a row that starts "<later section>:" stays a row when that section has its own heading', () => {
    const text = [
      'Problems (wait for you)',
      'Certificates: myclash.fr has 5 days left',
      'Notes',
      'old image',
      'Health',
      'containers: critical',
      'Containers',
      '15 of 16 run',
      'Certificates',
      'myclash.fr 5 days',
    ].join('\n');
    const html = renderReportHtml(SUBJECT, text);
    assert.deepEqual(sectionTitles(html), [
      escapeHtml('Problems (wait for you)'),
      'Notes',
      'Health',
      'Containers',
      'Certificates',
    ]);
    assert.match(html, new RegExp(`color:${RED};font-weight:bold[^>]*>Certificates: myclash`));
  });

  it('a heading-shaped long line is a row: a log line never becomes a section', () => {
    const html = renderReportHtml(SUBJECT, `Run\ndaily\nVerdict: ${'x '.repeat(80)}`);
    assert.deepEqual(sectionTitles(html), ['Run']);
  });

  it('names the sections it did not find', () => {
    const html = renderReportHtml(SUBJECT, 'Run\ndaily\nVerdict\nall good');
    assert.ok(html.includes('Sections not found: Running, Problems (wait for you), Notes,'));
    const full = renderReportHtml(SUBJECT, SECTIONS.map((n) => `${n}\nx`).join('\n'));
    assert.equal(full.includes('Sections not found'), false);
  });

  it('a name without a colon inside a line stays a row', () => {
    const html = renderReportHtml(SUBJECT, 'Run\nRun type daily');
    assert.deepEqual(sectionTitles(html), ['Run']);
    assert.ok(html.includes('>Run type daily<'));
  });

  it('drops an underline and empty lines, keeps lines before the first heading', () => {
    const html = renderReportHtml(SUBJECT, 'preface\nRun\n-----\n\n\ndaily');
    assert.equal(html.includes('-----'), false);
    assert.deepEqual(sectionTitles(html), ['Run']);
    assert.ok(html.indexOf('>preface<') > 0);
    assert.ok(html.indexOf('>preface<') < html.indexOf('>Run<'));
    assert.ok(html.includes('>daily<'));
  });
});

describe('the rows', () => {
  it('a problem row is red and bold; a note row is not', () => {
    const html = renderReportHtml(SUBJECT, 'Problems\nweb-public down\nNotes\nbackup old');
    assert.match(html, new RegExp(`color:${RED};font-weight:bold[^>]*>web-public down<`));
    assert.doesNotMatch(html, new RegExp(`color:${RED}[^>]*>backup old<`));
  });

  it('"None" under Problems is not red: an all-good morning shows no red row', () => {
    for (const none of ['None', 'Nothing.', 'No problems', 'None today', 'Nothing to report']) {
      const html = renderReportHtml(SUBJECT, `Problems\n${none}`);
      assert.doesNotMatch(html, new RegExp(`color:${RED}[^>]*>${none}<`), none);
    }
  });

  it('a log row is monospace and breaks long words; a host row is not', () => {
    const html = renderReportHtml(SUBJECT, 'Host\n40 GB free\nLogs\napi: Error x');
    assert.match(html, /font-family:monospace;word-break:break-all[^>]*>api: Error x</);
    assert.doesNotMatch(html, /monospace[^>]*>40 GB free</);
  });

  it('the layout holds 600 px in Outlook, which ignores max-width', () => {
    assert.match(renderReportHtml(SUBJECT, 'Run\nx'), /<table [^>]*width="600"/);
  });

  it('status words carry their colour, whole words only', () => {
    const html = renderReportHtml(
      SUBJECT,
      'Health\noverall warning, disk healthy, redis critical, backup failed, x-unhealthyness, not-a-healthy',
    );
    assert.ok(html.includes(`<span style="color:${AMBER};font-weight:bold">warning</span>`));
    assert.ok(html.includes(`<span style="color:${GREEN};font-weight:bold">healthy</span>`));
    assert.ok(html.includes(`<span style="color:${RED};font-weight:bold">critical</span>`));
    assert.ok(html.includes(`<span style="color:${RED};font-weight:bold">failed</span>`));
    assert.ok(html.includes('x-unhealthyness'), 'a word inside a longer word stays plain');
    assert.ok(html.includes('not-a-healthy'), 'a word joined by a hyphen stays plain');
  });

  it('a green word after "not" stays plain: a failed repair never shows green', () => {
    const html = renderReportHtml(SUBJECT, 'Done by Claude\nstart web-public: not healed');
    assert.ok(html.includes('not healed'));
    assert.equal(html.includes(`color:${GREEN};font-weight:bold">healed`), false);
  });
});

describe('a text the sender cannot split', () => {
  it('goes in one block under the band, with a grey line that says so', () => {
    const html = renderReportHtml(SUBJECT, 'All fine today.\nNothing to say.');
    assert.deepEqual(sectionTitles(html), []);
    assert.ok(html.includes(NOT_RECOGNISED));
    assert.ok(html.includes('>All fine today.<'));
    assert.ok(html.includes('>Nothing to say.<'));
  });
});

describe('escaping', () => {
  it('no raw markup, quote or ampersand from the subject or a line reaches the HTML', () => {
    const evil = `<script>alert("x")</script> & 'y'`;
    const html = renderReportHtml(`MyClash ops · daily · ${evil}`, `Logs\n${evil}\nNotes\n${evil}`);
    assert.equal(html.includes('<script>'), false);
    assert.equal(html.includes(`"x"`), false);
    assert.equal(html.includes(`'y'`), false);
    assert.equal(html.includes(' & '), false);
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it("the skill's escaper is the platform's escapeHtml, character for character", () => {
    // The skill cannot import @myclash/types: the cloud clone has no build. This holds the copy.
    for (const input of ['', 'plain', `<a href="x">&'</a>`, '&amp;', '«é»', '\u0000<>']) {
      assert.equal(escapeHtml(input), platformEscape(input), JSON.stringify(input));
    }
  });
});
