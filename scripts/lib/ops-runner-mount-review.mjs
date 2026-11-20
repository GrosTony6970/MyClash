/**
 * The ops runner runs `docker compose` (restore.sh, backup.sh, its container actions) through the
 * host's Docker socket. Compose resolves the compose file's relative bind sources in the runner's
 * filesystem and hands them to the host's daemon, which reads them as host paths. So the runner
 * must see the repo at the host's own path, or every container that mounts a repo file looks
 * changed from inside it.
 *
 * Incident 2026-11-20: the runner saw the repo at /srv/myclash while the VPS keeps it elsewhere. A
 * console restore's final `up -d` re-created db, traefik and the runner itself; re-creating the
 * runner killed the restore mid-way and left the site down.
 */

/** The one value the ops runner's mount, working dir and env take; lib/compose.sh exports it. */
export const ROOT_DIR_VALUE =
  '${MYCLASH_ROOT_DIR:?set by infra/scripts/lib/compose.sh - run compose through infra/scripts}';

const trimmedLines = (text) => text.split(/\r?\n/u).map((line) => line.trim());

/**
 * @param {string} service the ops-runner service block of the prod compose file
 * @returns {string[]}
 */
export function opsRunnerMountFindings(service) {
  const lines = trimmedLines(service);
  const findings = [
    `working_dir: ${ROOT_DIR_VALUE}`,
    `MYCLASH_ROOT_DIR: ${ROOT_DIR_VALUE}`,
    `- ../:${ROOT_DIR_VALUE}`,
  ]
    .filter((expected) => lines.filter((line) => line === expected).length !== 1)
    .map((expected) => `ops-runner must have the line \`${expected}\` once`);
  if (service.includes('/srv/myclash')) {
    findings.push('ops-runner must not name /srv/myclash: it sees the repo at the host path');
  }
  return findings.map(
    (what) =>
      `${what}. Compose run inside the runner hands bind paths to the host's Docker daemon, so the ` +
      'runner mounts the repo where the host keeps it (incident 2026-11-20).',
  );
}

/**
 * A restore only stopped containers: its restart starts them again and never re-creates one. A
 * re-created ops runner ends the restore that runs inside it, whatever made the settings differ.
 * @param {string} text restore.sh
 * @returns {string[]}
 */
export function restoreRestartFindings(text) {
  const code = trimmedLines(text).filter((line) => !line.startsWith('#'));
  if (!code.some((line) => /^RESTART=\(/u.test(line))) {
    return ['infra/scripts/restore.sh must set RESTART'];
  }
  // Every `up` the restore runs: its RESTART arrays, and any direct `"${COMPOSE[@]}" up`.
  return code
    .filter((line) => /^RESTART=\(/u.test(line) || /"\$\{COMPOSE\[@\]\}"\s+up\b/u.test(line))
    .filter((line) => !/\bup -d --no-recreate\b/u.test(line))
    .map(
      (line) =>
        `infra/scripts/restore.sh: \`${line}\` must use \`up -d --no-recreate\`: the restore runs ` +
        'inside the ops runner, and re-creating the runner ends the restore (incident 2026-11-20).',
    );
}

/**
 * MYCLASH_ROOT_DIR is never a line of .env: the scripts load .env after lib/compose.sh exported
 * the value (deploy.sh, status.sh), and an empty line there would empty it.
 * @param {string} text .env.example
 * @returns {string[]}
 */
export function envExampleRootDirFindings(text) {
  return trimmedLines(text).some((line) => /^(export\s+)?MYCLASH_ROOT_DIR=/u.test(line))
    ? [
        '.env.example must not hold MYCLASH_ROOT_DIR: lib/compose.sh exports it from the folder ' +
          'the script runs in, and a later load of .env would empty it.',
      ]
    : [];
}
