/**
 * Realtime owns its tenant (rulings 424, 504-506): the properties infra:review holds for the
 * supabase-realtime service of each compose file and for infra/realtime/start.sh.
 *
 * Realtime's management API (/api/tenants) takes ANY token signed with API_JWT_SECRET and never
 * reads its role. So that secret is Realtime's alone, the image's seed is off (it would give the
 * tenant API_JWT_SECRET as its socket secret), and our start script writes the tenant on every
 * start with the socket secret every browser token is signed with. Each check below names the
 * failure it stops; each is a property, so a new service, a new flag or a reworded line is held
 * too, not only today's text.
 */

import { SECRET_NAME } from './argv-secrets.mjs';

/** Reviewed against this image; a bump re-checks start.sh against its run.sh and seeds.exs. */
export const REALTIME_IMAGE = 'supabase/realtime:v2.124.1';

const ENTRYPOINT =
  "entrypoint: ['/usr/bin/tini', '-s', '-g', '--', '/bin/bash', '/myclash/realtime-start.sh']";
const COMMAND = "command: ['/app/bin/server']";
const MOUNT = [
  '- type: bind',
  'source: ./realtime/start.sh',
  'target: /myclash/realtime-start.sh',
  'read_only: true',
  'bind:',
  'create_host_path: false',
];

function envValue(serviceText, name) {
  return new RegExp(String.raw`^\s+${name}:\s*(.+?)\s*$`, 'mu').exec(serviceText)?.[1] ?? null;
}

function healthcheckBlock(serviceText) {
  const lines = serviceText.split('\n');
  const start = lines.findIndex((line) => /^ {4}healthcheck:\s*$/u.test(line));
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && /^ {4}\S/u.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

// ── The service: one check per property, each returning a reason or null ──────────────────────

function imageCheck(service) {
  const image = /^\s+image:\s*(\S+)/mu.exec(service)?.[1];
  if (image === REALTIME_IMAGE) return null;
  return (
    `image is ${image ?? 'missing'}, reviewed against ${REALTIME_IMAGE}. Re-check ` +
    'infra/realtime/start.sh against the new image (its /app/run.sh, priv/repo/seeds.exs body ' +
    'and /api/tenants), then update REALTIME_IMAGE in scripts/lib/realtime-tenant-review.mjs.'
  );
}

function seedCheck(service) {
  if (envValue(service, 'SEED_SELF_HOST') === "'false'") return null;
  return (
    "SEED_SELF_HOST must be 'false': the image's seed re-creates the tenant with API_JWT_SECRET " +
    'as its socket secret (ruling 424). infra/realtime/start.sh writes it.'
  );
}

function deskSecretCheck(service, services) {
  const api = envValue(service, 'API_JWT_SECRET');
  const apiVar = api && /^\$\{([A-Za-z_][A-Za-z0-9_]*)/u.exec(api)?.[1];
  if (!apiVar) return 'API_JWT_SECRET must come from its own .env variable.';
  const holders = [...services]
    .filter(([name, text]) => name !== 'supabase-realtime' && text.includes(`\${${apiVar}`))
    .map(([name]) => name);
  const inRealtime = service.split(`\${${apiVar}`).length - 1;
  if (holders.length === 0 && inRealtime === 1) return null;
  return (
    `API_JWT_SECRET's variable ${apiVar} must be Realtime's alone and used once ` +
    `(also in: ${holders.join(', ') || `${inRealtime} lines of supabase-realtime`}). The ` +
    'management API takes any token signed with it; a secret another service signs with ' +
    'makes that service a tenant manager (rulings 420, 424).'
  );
}

function socketSecretCheck(service, services) {
  const socket = envValue(service, 'MYCLASH_REALTIME_SOCKET_SECRET');
  const gotrue = envValue(services.get('supabase-auth') ?? '', 'GOTRUE_JWT_SECRET');
  if (socket && socket === gotrue) return null;
  return (
    `MYCLASH_REALTIME_SOCKET_SECRET (${socket ?? 'missing'}) must be exactly supabase-auth's ` +
    `GOTRUE_JWT_SECRET (${gotrue ?? 'missing'}): browser sockets carry tokens signed with ` +
    'it, so any other value refuses every live screen (401).'
  );
}

function deadJwtSecretCheck(service) {
  if (envValue(service, 'JWT_SECRET') === null) return null;
  return 'JWT_SECRET is read by nothing in the image (ruling 508); the socket secret is MYCLASH_REALTIME_SOCKET_SECRET.';
}

function entrypointCheck(service) {
  const entrypoints = service.match(/^\s+entrypoint:/gmu)?.length ?? 0;
  if (entrypoints === 1 && service.includes(`    ${ENTRYPOINT}`)) return null;
  return `must start through our script: \`${ENTRYPOINT}\`, and nothing else (no \`bash -x\`).`;
}

function commandCheck(service) {
  if (service.includes(`    ${COMMAND}`)) return null;
  return `needs \`${COMMAND}\`: setting the entrypoint clears the image's command.`;
}

function mountCheck(service) {
  const at = service.indexOf(MOUNT[0]);
  const lines = (at === -1 ? '' : service.slice(at)).split('\n').slice(0, MOUNT.length);
  if (lines.map((line) => line.trim()).join('\n') === MOUNT.join('\n')) return null;
  return (
    `must mount the start script read-only with create_host_path false (${MOUNT.join(' ')}): ` +
    'otherwise a missing file becomes an empty directory and Realtime restarts forever.'
  );
}

function healthcheckCheck(service) {
  const tenant = envValue(service, 'SELF_HOST_TENANT_NAME');
  const health = healthcheckBlock(service);
  if (
    health &&
    !health.includes('${') &&
    health.includes(`-H "Host: ${tenant}"`) &&
    health.includes('http://localhost:4000/api/ping')
  ) {
    return null;
  }
  return (
    `the healthcheck must ask http://localhost:4000/api/ping with -H "Host: ${tenant}" ` +
    '(SELF_HOST_TENANT_NAME) and carry no ${…}: ping answers 200 only when the tenant ' +
    "exists and needs no token (ruling 504); a token there is a secret on curl's command line."
  );
}

/**
 * Findings for one compose file's Realtime.
 * @param {{label: string, services: Map<string, string>}} input
 * @returns {string[]}
 */
export function realtimeServiceFindings({ label, services }) {
  const service = services.get('supabase-realtime');
  if (!service) return [`${label}: the supabase-realtime service is missing.`];
  return [
    imageCheck(service),
    seedCheck(service),
    deskSecretCheck(service, services),
    socketSecretCheck(service, services),
    deadJwtSecretCheck(service),
    entrypointCheck(service),
    commandCheck(service),
    mountCheck(service),
    healthcheckCheck(service),
  ]
    .filter(Boolean)
    .map((what) => `${label} supabase-realtime: ${what}`);
}

/**
 * restore.sh resolves the whole compose file before its first destructive compose call. Compose
 * checks a required `${X:?}` key only on `config` and `up`, never on `stop` or `exec`: without the
 * check, an .env missing a key let a restore stop the stack and replace the database, then fail
 * at its final `up -d` (ruling 510).
 * @param {string} text restore.sh
 * @returns {string[]}
 */
export function restoreGuardFindings(text) {
  // At the start of a line (not in a comment), and its block stops the restore.
  const guard = text.search(
    /^"\$\{COMPOSE\[@\]\}" config --quiet \|\| \{\n(?:[^\n}]*\n)*?\s*exit 1\n\}/mu,
  );
  const firstAction = text.search(/"\$\{COMPOSE\[@\]\}" (?:stop|exec|up|down|rm|run)\b/u);
  if (guard === -1 || firstAction === -1 || guard > firstAction) {
    return [
      'infra/scripts/restore.sh must run `"${COMPOSE[@]}" config --quiet || { …; exit 1; }` ' +
        'before its first stop/exec/up: compose enforces a missing ${X:?} key only there, so ' +
        'without it a restore replaces the database and then fails to start the stack (ruling 510).',
    ];
  }
  return [];
}

// ── The start script ──────────────────────────────────────────────────────────────────────────

/** Code lines with their numbers: comments dropped, the shebang kept. */
function codeLines(text) {
  return text
    .split(/\r?\n/u)
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line, n }) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('#') || (n === 1 && trimmed.startsWith('#!'));
    });
}

function tracingFindings(code) {
  return code
    .filter(
      ({ line, n }) =>
        (n === 1 && /^#!.*\s-[A-Za-z]*x/u.test(line)) ||
        // Any flag cluster holding x, or the word xtrace, anywhere on a `set` line.
        /\bset\b(?=.*(?:\s-[A-Za-z]*x|\bxtrace\b))/u.test(line) ||
        /\bbash\s+-[A-Za-z]*x/u.test(line) ||
        /BASH_XTRACEFD|\bshopt\b/u.test(line),
    )
    .map(
      ({ n }) =>
        `line ${n} turns on tracing, which prints the token and the database password into the container log.`,
    );
}

/** Where a value that must not reach a command line may be expanded. */
function safeExpansion(name, line) {
  if (/^\s*:(?:\s+"\$\{[A-Z_]+:\?\}")+\s*$/u.test(line)) return true; // the required-env check
  if (name === 'token') {
    return (
      /-K <\(printf 'header = "Authorization: Bearer %s"\\n' "\$token"\)/u.test(line) ||
      /^\s*\[\[ "\$token" =~/u.test(line)
    );
  }
  return name === 'body' && /<<<"\$body"\)/u.test(line);
}

function commandLineFindings(code) {
  const findings = [];
  for (const { line, n } of code) {
    for (const [, name] of line.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/gu)) {
      if ((SECRET_NAME.test(name) || name === 'body') && !safeExpansion(name, line)) {
        findings.push(
          `line ${n} expands $${name} outside its one safe place (the required-env check, the ` +
            'printf feeding curl -K, the here-string): on a command line it is readable by ' +
            'every user of the host (ruling 425).',
        );
      }
    }
  }
  return findings;
}

function mintFindings(text) {
  const evalArg = /\/app\/bin\/realtime eval '([^']*)'/u.exec(text)?.[1];
  if (
    evalArg !== undefined &&
    !evalArg.includes('$') &&
    evalArg.includes('System.fetch_env!("API_JWT_SECRET")')
  ) {
    return [];
  }
  return [
    'the token is minted by `/app/bin/realtime eval \'…\'` reading System.fetch_env!("API_JWT_SECRET") ' +
      'with no $ in its argument: a shell value there is on the command line (ruling 506).',
  ];
}

const REQUIRED_TEXT = [
  ['/app/run.sh "$@" &', "starts the image's own entrypoint script"],
  ['"$base/api/tenants/$SELF_HOST_TENANT_NAME"', 'writes the tenant the sockets resolve'],
  ['jwt_secret: env.MYCLASH_REALTIME_SOCKET_SECRET', 'gives the tenant the socket secret'],
  ['db_password: env.DB_PASSWORD', 'reads the password from the environment, not argv'],
];

/**
 * Findings for infra/realtime/start.sh.
 * @param {string} text
 * @returns {string[]}
 */
export function startScriptFindings(text) {
  const code = codeLines(text);
  return [
    ...tracingFindings(code),
    ...commandLineFindings(code),
    ...mintFindings(text),
    ...REQUIRED_TEXT.filter(([needle]) => !text.includes(needle)).map(
      ([needle, why]) => `must contain \`${needle}\` (it ${why}).`,
    ),
  ].map((what) => `infra/realtime/start.sh: ${what}`);
}
