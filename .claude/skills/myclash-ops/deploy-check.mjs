/**
 * A `deploy` run's commit check (ops agent slice 6, ruling 908), after the round:
 *
 *   node .claude/skills/myclash-ops/deploy-check.mjs /tmp/myclash-ops
 *
 * It reads two files of that folder: `versions.json`, which the round wrote, and `payload.txt`,
 * which the run wrote with its Write tool after the round: the text of the routine-fire-payload
 * block, as deploy.sh or redeploy.sh sent it (`deploy commit=<sha> kind=deploy|redeploy[
 * services=a,b]`). The payload never goes on a command line: the shell would run a word like
 * `services=x;cmd` before any check here could see it. No network, no key.
 *
 * The deploy record (`versions.deploy.deployedCommit`) is written by deploy.sh before it builds,
 * so it says what was announced; `versions.runningCommit` is the `GIT_COMMIT` compose gave the API
 * container. A redeploy that did not name `api` recreated only the named services (`--no-deps`),
 * so the API's commit is not compared then. It prints one line:
 *
 *   commit ok                                   (exit 0)
 *   commit ok (the API was not redeployed)      (exit 0)
 *   commit ok, the deploy record names <8>      (exit 0, a note: a later redeploy moved the
 *                                                record, or it was not written)
 *   commit changed <8>                          (exit 0, a note: a later deploy or a rollback ran)
 *   commit mismatch announced=<8> manifest=<8> running=<8|unknown>   (exit 3: a problem)
 *   commit unread                               (exit 3: a problem)
 *
 * A payload word of another shape than `commit=`, `kind=` or `services=` over `[a-z0-9,-]` makes
 * the line `commit unread`. Exit 2: usage error.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORD = /^(commit|kind|services)=([a-z0-9,-]+)$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const UNREAD = 'commit unread';

const short = (commit) => (COMMIT.test(commit) ? commit.slice(0, 8) : 'unknown');

/** The payload's fields, or null when any word has another shape. */
function payloadFields(text) {
  const [type, ...words] = String(text ?? '')
    .trim()
    .split(/\s+/u);
  if (type !== 'deploy') return null;
  const fields = {};
  for (const word of words) {
    const match = WORD.exec(word);
    if (!match) return null;
    fields[match[1]] = match[2];
  }
  return fields;
}

/**
 * The check's one line, from the round's `versions.json` (parsed, or null) and the payload's text
 * (or null).
 */
export function deployCommitLine(versions, payload) {
  const fields = payloadFields(payload);
  if (!versions || !fields) return UNREAD;
  const { commit: announced = '', kind, services = '' } = fields;
  if (!COMMIT.test(announced) || (kind !== 'deploy' && kind !== 'redeploy')) return UNREAD;
  const manifest = String(versions.deploy?.deployedCommit ?? 'unknown');
  const running = String(versions.runningCommit ?? 'unknown');
  const apiRebuilt = kind === 'deploy' || services.split(',').includes('api');
  if (manifest === announced) {
    if (!apiRebuilt) return 'commit ok (the API was not redeployed)';
    if (running === announced) return 'commit ok';
  } else if (apiRebuilt && running === announced) {
    return `commit ok, the deploy record names ${short(manifest)}`;
  } else if (COMMIT.test(manifest)) {
    return `commit changed ${short(manifest)}`;
  }
  return `commit mismatch announced=${short(announced)} manifest=${short(manifest)} running=${short(running)}`;
}

function readOrNull(file, parse) {
  try {
    return parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function main([dir]) {
  if (!dir) {
    console.error(
      'usage: node deploy-check.mjs <dir>  (reads <dir>/versions.json and <dir>/payload.txt)',
    );
    return 2;
  }
  const versions = readOrNull(path.join(dir, 'versions.json'), JSON.parse);
  const payload = readOrNull(path.join(dir, 'payload.txt'), (text) => text);
  const line = deployCommitLine(versions, payload);
  console.log(line);
  return line.startsWith('commit ok') || line.startsWith('commit changed') ? 0 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
