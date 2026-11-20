/**
 * The one way a cloud run of the ops agent sends its report (the ops agent's design §6).
 *
 *   node .claude/skills/myclash-ops/send-report.mjs "<subject>" <body-file>
 *
 * It posts to Resend's API with no key: the cloud environment holds the Resend key as a network
 * secret, and its proxy adds it to calls for api.resend.com, so the key never enters the session.
 * The addresses come from the environment (`REPORT_EMAIL_TO`, `REPORT_EMAIL_FROM`) and are never
 * printed. A refusal prints Resend's error kind, never its message (it can quote an address).
 *
 * The email carries the text as written and an HTML part dressed from it (`report-html.mjs`,
 * ruling 910).
 *
 * Exit codes: 0 sent, 3 not sent, 2 usage error.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { relaunchThroughProxy } from './env-proxy.mjs';

const RESEND_EMAILS = 'https://api.resend.com/emails';

/** Loaded when the email is built, not at start: a broken renderer must not stop the script. */
async function loadRenderer() {
  return (await import('./report-html.mjs')).renderReportHtml;
}

/**
 * The HTML part (ruling 910), or undefined when the renderer fails to load or throws: the HTML
 * only dresses the text, and must never cost the email. The `sent … text-only` line says so.
 */
async function htmlPart(subject, text, load) {
  try {
    return (await load())(subject, text);
  } catch {
    return undefined;
  }
}

/** Sends one report. Throws before any call when an address, the subject or the body is missing. */
export async function sendReport({ subject, text }, env, fetchImpl = fetch, load = loadRenderer) {
  const to = env.REPORT_EMAIL_TO;
  const from = env.REPORT_EMAIL_FROM;
  if (!to || !from) throw new Error('REPORT_EMAIL_TO and REPORT_EMAIL_FROM must both be set');
  if (!subject?.trim() || !text?.trim())
    throw new Error('the subject and the body must not be empty');
  const html = await htmlPart(subject, text, load);
  let res;
  try {
    res = await fetchImpl(RESEND_EMAILS, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, ...(html ? { html } : {}) }),
    });
  } catch (err) {
    return {
      ok: false,
      line: `not sent unreachable ${err?.code ?? err?.cause?.code ?? err?.name ?? 'error'}`,
    };
  }
  const answer = await res.json().catch(() => ({}));
  if (res.ok) {
    return { ok: true, line: `sent ${answer.id ?? ''}${html ? '' : ' text-only'}`.trim() };
  }
  return { ok: false, line: `not sent ${res.status} ${answer.name ?? ''}`.trim() };
}

async function main([subject, bodyFile]) {
  if (!subject || !bodyFile) {
    console.error('usage: node send-report.mjs "<subject>" <body-file>');
    return 2;
  }
  let sent;
  try {
    sent = await sendReport({ subject, text: await readFile(bodyFile, 'utf8') }, process.env);
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  console.log(sent.line);
  return sent.ok ? 0 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = relaunchThroughProxy() ?? (await main(process.argv.slice(2)));
}
