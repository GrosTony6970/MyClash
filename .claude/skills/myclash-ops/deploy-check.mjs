/**
 * A `deploy` run's commit check (ops agent slice 6, ruling 908), after the round:
 *
 *   node .claude/skills/myclash-ops/deploy-check.mjs /tmp/myclash-ops <commit=…> <kind=…> [services=…]
 *
 * The words are the payload's, as deploy.sh or redeploy.sh sent them. The deploy record
 * (`versions.deploy.deployedCommit`) is written by deploy.sh BEFORE it builds, so it says what
 * was announced, not what runs; `versions.runningCommit` is the `GIT_COMMIT` compose gave the API
 * container. A redeploy that did not name `api` recreated only the named services (`--no-deps`),
 * so the API's commit is not compared then.
 *
 * It reads `<dir>/versions.json` only: no network, no key. It prints one line:
 *
 *   commit ok                                   (exit 0)
 *   commit ok (the API was not redeployed)      (exit 0)
 *   commit changed <8>                          (exit 3: a later deploy or a rollback ran; a note)
 *   commit mismatch announced=<8> manifest=<8> running=<8|unknown>   (exit 3: a problem)
 *   commit unread                               (exit 3: a problem)
 *
 * The payload is text from whoever holds the start token, and the run copies its words into a
 * shell command: a word of any other shape than `commit=`, `kind=` or `services=` over
 * `[a-z0-9,-]` makes the line `commit unread`. Exit 2: usage error.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORD = /^(commit|kind|services)=([a-z0-9,-]+)$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const UNREAD = 'commit unread';

const short = (commit) => (COMMIT.test(commit) ? commit.slice(0, 8) : 'unknown');

/** The check's one line, from the round's `versions.json` (parsed, or null) and the payload's words. */
export function deployCommitLine(versions, words) {
  const fields = {};
  for (const word of words) {
    const match = WORD.exec(word);
    if (!match) return UNREAD;
    fields[match[1]] = match[2];
  }
  const { commit: announced, kind, services = '' } = fields;
  if (!versions || !COMMIT.test(announced ?? '') || (kind !== 'deploy' && kind !== 'redeploy')) {
    return UNREAD;
  }
  const manifest = String(versions.deploy?.deployedCommit ?? 'unknown');
  const running = String(versions.runningCommit ?? 'unknown');
  if (manifest !== announced) {
    if (COMMIT.test(manifest)) return `commit changed ${short(manifest)}`;
  } else {
    const apiRebuilt = kind === 'deploy' || services.split(',').includes('api');
    if (!apiRebuilt) return 'commit ok (the API was not redeployed)';
    if (running === announced) return 'commit ok';
  }
  return `commit mismatch announced=${short(announced)} manifest=${short(manifest)} running=${short(running)}`;
}

function readVersions(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, 'versions.json'), 'utf8'));
  } catch {
    return null;
  }
}

function main([dir, ...words]) {
  if (!dir) {
    console.error(
      'usage: node deploy-check.mjs <dir> commit=<sha> kind=<deploy|redeploy> [services=<a,b>]',
    );
    return 2;
  }
  const line = deployCommitLine(readVersions(dir), words);
  console.log(line);
  return line.startsWith('commit ok') ? 0 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
