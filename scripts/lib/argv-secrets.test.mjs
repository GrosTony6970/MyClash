import assert from 'node:assert/strict';
import test from 'node:test';

import { argvSecretFindings } from './argv-secrets.mjs';

const lines = (text) => argvSecretFindings('x.sh', text).map((f) => f.line);

test('a secret-named flag given a variable is a finding', () => {
  assert.deepEqual(
    lines(
      'docker compose run \\\n  -e SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY}" \\\n  api',
    ),
    [2],
  );
  assert.deepEqual(lines('  -e SEED_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD" \\'), [1]);
  assert.deepEqual(lines('docker run --rm -e PGPASSWORD="$2" -e PGCONNECT_TIMEOUT=5 img'), [1]);
  assert.deepEqual(lines('docker run --env=API_TOKEN=$T img'), [1]);
  assert.deepEqual(lines('docker run --env "OPS_RUNNER_SECRET=$S" img'), [1]);
});

test('a flag built into an array, glued, or fed by a command substitution is a finding', () => {
  assert.deepEqual(lines('args+=(-e "PGPASSWORD=$POSTGRES_PASSWORD")'), [1]);
  assert.deepEqual(lines('docker run -ePGPASSWORD=$P img'), [1]);
  assert.deepEqual(lines('docker run -e PGPASSWORD="$(cat pw)" img'), [1]);
  assert.deepEqual(lines('docker run -e PGPASSWORD=`cat pw` img'), [1]);
  assert.deepEqual(lines('set -euo pipefail'), []);
});

test('env given a secret on its command line is a finding, a prefix is not', () => {
  assert.deepEqual(
    lines(
      '    env "TRAEFIK_DASHBOARD_AUTH=$dashboard_auth" "TRAEFIK_DASHBOARD_PASSWORD=$dashboard_password"',
    ),
    [1],
  );
  assert.deepEqual(lines('out=$(env -i API_TOKEN=$T node x.mjs)'), [1]);
  assert.deepEqual(lines('env NODE_ENV=production node x.mjs'), []);
  assert.deepEqual(lines('    TRAEFIK_DASHBOARD_PASSWORD="$dashboard_password" node x.mjs'), []);
});

test('a flag of any name that expands a secret-named variable is a finding', () => {
  assert.deepEqual(
    lines('psql -v ON_ERROR_STOP=1 \\\n    -v rest_pw="$AUTHENTICATOR_PASSWORD" \\'),
    [2],
  );
  assert.deepEqual(lines('psql --set=pw=${STORAGE_PASSWORD} -c x'), [1]);
  assert.deepEqual(lines('docker run -e URL="$DATABASE_URL" img'), [1]);
});

test('a workflow expression is an expansion: GitHub writes it into the command line', () => {
  assert.deepEqual(
    lines('        run: docker run --env API_TOKEN=${{ secrets.API_TOKEN }} img'),
    [1],
  );
  assert.deepEqual(lines('        run: docker run -e FOO=${{ secrets.ANYTHING }} img'), [1]);
  assert.deepEqual(lines('        run: docker run -e SHA=${{ github.sha }} img'), []);
});

test('a help text that escapes the variable or shows a placeholder is a finding', () => {
  assert.deepEqual(
    lines('    -e SUPABASE_SERVICE_ROLE_KEY="\\$SUPABASE_SERVICE_ROLE_KEY" \\\\'),
    [1],
  );
  assert.deepEqual(
    lines('    -e E2E_ADMIN_EMAIL=... -e E2E_ADMIN_PASSWORD=... -e E2E_ORG_SLUG=... \\\\'),
    [1],
  );
  assert.deepEqual(lines('    -e STUDIO_PASSWORD=<password>'), [1]);
});

test('a flag passed by name, a literal value, or a non-secret variable is not a finding', () => {
  assert.deepEqual(
    lines('  -e SEED_ADMIN_PASSWORD \\\n  -e DATABASE_URL \\\n  -e PGPASSWORD \\'),
    [],
  );
  assert.deepEqual(
    lines('  -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER="$PGUSER" -e POSTGRES_DB="$DB" \\'),
    [],
  );
  assert.deepEqual(lines('  -e SUPABASE_URL="http://supabase-auth:9999" \\'), []);
  assert.deepEqual(lines('  -e SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@${DOMAIN}}" \\'), []);
  assert.deepEqual(lines("  -e PGOPTIONS='-c statement_timeout=5000' \\"), []);
  assert.deepEqual(lines('PGPASSWORD="$2" docker run --rm -e PGPASSWORD img'), []);
  assert.deepEqual(lines('docker run -v "$PWD:/repo" -v db_data:/var/lib img'), []);
});

test('a comment line is not a finding', () => {
  assert.deepEqual(lines('  # never: -e PGPASSWORD="$POSTGRES_PASSWORD"'), []);
});

test('the generated-secrets JSON passed as an argument is a finding, as a prefix it is not', () => {
  assert.deepEqual(
    lines('KEYS=$(node -e "const r=JSON.parse(process.argv[1]); console.log(r)" "$ENV_RESULT")'),
    [1],
  );
  assert.deepEqual(lines('KEYS=$(node -e "x" "${ENV_RESULT}")'), [1]);
  assert.deepEqual(lines('printf "%s" "$ENV_RESULT" | node -e "x"'), [1]);
  assert.deepEqual(
    lines(
      'KEYS=$(ENV_RESULT="$ENV_RESULT" node -e "const r=JSON.parse(process.env.ENV_RESULT); console.log(r)")',
    ),
    [],
  );
  assert.deepEqual(lines('ENV_RESULT=$(node scripts/ensure-prod-env.mjs .env)'), []);
});

test('a finding names the file, the line and the variable', () => {
  assert.deepEqual(
    argvSecretFindings('infra/scripts/status.sh', 'a\n  -e PGPASSWORD="$POSTGRES_PASSWORD" \\'),
    [
      {
        file: 'infra/scripts/status.sh',
        line: 2,
        why: 'PGPASSWORD is given its value on the command line; pass it by name (-e PGPASSWORD) from the environment',
      },
    ],
  );
});
