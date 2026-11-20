/**
 * The ops agent's report email (`.claude/skills/myclash-ops/send-report.mjs`, the ops agent's
 * design §6): the run's one road to the operator's inbox. The door's half is
 * `ops-skill.test.mjs`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { renderReportHtml } from '../.claude/skills/myclash-ops/report-html.mjs';
import { sendReport } from '../.claude/skills/myclash-ops/send-report.mjs';
import { noProxyEnv } from './lib/no-proxy-env.mjs';

const SEND_REPORT = '.claude/skills/myclash-ops/send-report.mjs';
const MAIL_ENV = {
  REPORT_EMAIL_TO: 'operator@example.test',
  REPORT_EMAIL_FROM: 'MyClash ops <ops@example.test>',
};
const REPORT = { subject: 'MyClash ops · daily · all good', text: 'All good.' };

function fakeFetch(answer) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (answer instanceof Error) throw answer;
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.json };
  };
  return { calls, impl };
}

function runCli(env, script = SEND_REPORT) {
  const body = path.join(mkdtempSync(path.join(tmpdir(), 'report-')), 'r.txt');
  writeFileSync(body, 'All good.');
  return spawnSync(process.execPath, [script, 'subject', body], { env, encoding: 'utf8' });
}

/** The skill's sender beside a renderer that does not even parse. */
function skillWithBrokenRenderer() {
  const dir = mkdtempSync(path.join(tmpdir(), 'skill-'));
  for (const file of ['send-report.mjs', 'env-proxy.mjs']) {
    copyFileSync(path.join(path.dirname(SEND_REPORT), file), path.join(dir, file));
  }
  writeFileSync(path.join(dir, 'report-html.mjs'), 'export function (');
  return path.join(dir, 'send-report.mjs');
}

describe('the report email', () => {
  it("goes to Resend's API with no key of its own: the cloud proxy adds it", async () => {
    const fetch = fakeFetch({ status: 200, json: { id: 'em_1' } });
    const sent = await sendReport(REPORT, MAIL_ENV, fetch.impl);
    assert.deepEqual(sent, { ok: true, line: 'sent em_1' });
    assert.equal(fetch.calls.length, 1);
    const { url, init } = fetch.calls[0];
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(init.method, 'POST');
    assert.equal(
      Object.keys(init.headers).some((h) => h.toLowerCase() === 'authorization'),
      false,
    );
    const { html, ...rest } = JSON.parse(init.body);
    assert.deepEqual(rest, {
      from: MAIL_ENV.REPORT_EMAIL_FROM,
      to: [MAIL_ENV.REPORT_EMAIL_TO],
      subject: REPORT.subject,
      text: REPORT.text,
    });
    assert.equal(html, renderReportHtml(REPORT.subject, REPORT.text));
  });

  // Ruling 910: the HTML dresses the text; it must never cost the email.
  for (const [name, loader] of [
    [
      'a renderer that throws',
      async () => () => {
        throw new Error('bug');
      },
    ],
    [
      'a renderer that does not load',
      async () => {
        throw new Error('missing');
      },
    ],
  ]) {
    it(`${name}: the text goes alone, and the line says text-only`, async () => {
      const fetch = fakeFetch({ status: 200, json: { id: 'em_2' } });
      const sent = await sendReport(REPORT, MAIL_ENV, fetch.impl, loader);
      assert.deepEqual(sent, { ok: true, line: 'sent em_2 text-only' });
      const body = JSON.parse(fetch.calls[0].init.body);
      assert.equal(body.text, REPORT.text);
      assert.equal('html' in body, false);
    });
  }

  it("a refusal names Resend's error kind, never its message", async () => {
    const fetch = fakeFetch({
      status: 422,
      json: { name: 'validation_error', message: 'x@y.z is invalid' },
    });
    const sent = await sendReport(REPORT, MAIL_ENV, fetch.impl);
    assert.equal(sent.ok, false);
    assert.match(sent.line, /^not sent 422 validation_error$/);
  });

  it('no answer: not sent, unreachable', async () => {
    const fetch = fakeFetch(Object.assign(new Error('x'), { code: 'ECONNRESET' }));
    const sent = await sendReport(REPORT, MAIL_ENV, fetch.impl);
    assert.deepEqual(sent, { ok: false, line: 'not sent unreachable ECONNRESET' });
  });

  for (const [name, env, report] of [
    ['no recipient', { REPORT_EMAIL_FROM: MAIL_ENV.REPORT_EMAIL_FROM }, REPORT],
    ['no sender', { REPORT_EMAIL_TO: MAIL_ENV.REPORT_EMAIL_TO }, REPORT],
    ['an empty subject', MAIL_ENV, { ...REPORT, subject: ' ' }],
    ['an empty body', MAIL_ENV, { ...REPORT, text: '' }],
  ]) {
    it(`refuses ${name} before any call`, async () => {
      const fetch = fakeFetch({ status: 200, json: { id: 'x' } });
      await assert.rejects(sendReport(report, env, fetch.impl));
      assert.equal(fetch.calls.length, 0);
    });
  }
});

describe('the report script on the command line', () => {
  // The skill pushes when this exits anything but 0: a mail that did not leave must say so.
  it('through a proxy that refuses: exits 3, says not sent, prints no address', () => {
    const run = runCli(noProxyEnv({ ...MAIL_ENV, HTTPS_PROXY: 'http://127.0.0.1:1' }));
    assert.equal(run.status, 3);
    assert.match(run.stdout, /^not sent unreachable/);
    assert.equal(`${run.stdout}${run.stderr}`.includes(MAIL_ENV.REPORT_EMAIL_TO), false);
  });

  // Ruling 910: the renderer loads late, so one that does not parse still lets the text go.
  it('with a renderer that does not parse: still reaches the send', () => {
    const env = noProxyEnv({ ...MAIL_ENV, HTTPS_PROXY: 'http://127.0.0.1:1' });
    const run = runCli(env, skillWithBrokenRenderer());
    assert.equal(run.status, 3, run.stderr);
    assert.match(run.stdout, /^not sent unreachable/);
  });

  it('exits 2 without a recipient, and never prints the sender', () => {
    const env = noProxyEnv({ REPORT_EMAIL_FROM: 'marker-sender@example.test' });
    delete env.REPORT_EMAIL_TO;
    const run = runCli(env);
    assert.equal(run.status, 2);
    assert.equal(`${run.stdout}${run.stderr}`.includes('marker-sender'), false);
  });
});
