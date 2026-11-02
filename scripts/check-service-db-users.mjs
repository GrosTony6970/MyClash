/**
 * The HTTP half of scripts/check-service-db-users.sh (CI, Deploy migration run; rulings 390-399).
 * Runs inside the api image on the compose network `myclash`, mounted read-only: `node:` imports
 * only. It drives GoTrue, PostgREST and Storage through every path that changes when each logs
 * in as its own database user, and prints one line per check. Exit 1 when any check fails.
 *
 * This traffic is not the proof of WHO logged in (it passes on the superuser too); the shell
 * half reads that from the database after this has run.
 */
import { createHmac, randomUUID } from 'node:crypto';

const SECRET = process.env['SUPABASE_JWT_SECRET'];
if (!SECRET) throw new Error('SUPABASE_JWT_SECRET is not set');
const AUTH = 'http://supabase-auth:9999';
const REST = 'http://supabase-rest:3000';
const STORAGE = 'http://supabase-storage:5000';

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(role) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ role, iss: 'ci-check', exp: Math.floor(Date.now() / 1000) + 600 });
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
const service = token('service_role');
const anon = token('anon');
const headers = (jwt, type = 'application/json') => ({
  authorization: `Bearer ${jwt}`,
  apikey: jwt,
  'content-type': type,
});

let failed = 0;
async function check(label, request, accept) {
  try {
    const res = await request();
    const text = await res.text();
    const pass = accept(res.status, text);
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok ' : 'RED'} ${label}: ${res.status} ${text.slice(0, 160)}`);
    return pass ? text : null; // a failed check hands nothing on to the next one
  } catch (error) {
    failed += 1;
    console.log(`RED ${label}: ${error.cause?.code ?? error.message}`);
    return null;
  }
}

// Services come up in any order: wait for each to answer before judging it.
async function waitFor(label, url) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { headers: headers(service) });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  failed += 1;
  console.log(`RED ${label} did not answer within 120 s`);
}
await waitFor('GoTrue', `${AUTH}/health`);
await waitFor('PostgREST', `${REST}/`);
await waitFor('Storage', `${STORAGE}/status`);

// GoTrue: create a user, give it a public row that cascades, delete it, the row is gone.
const email = `ci-${randomUUID()}@example.com`;
const created = await check(
  'GoTrue admin creates a user',
  () =>
    fetch(`${AUTH}/admin/users`, {
      method: 'POST',
      headers: headers(service),
      body: JSON.stringify({ email, password: 'Ci-Check-Password-1!', email_confirm: true }),
    }),
  (status, text) => status === 200 && text.includes(email),
);
const userId = created ? JSON.parse(created).id : randomUUID();
await check(
  'PostgREST inserts a row that references the user (service_role)',
  () =>
    fetch(`${REST}/directory_groups`, {
      method: 'POST',
      headers: { ...headers(service), prefer: 'return=minimal' },
      body: JSON.stringify({ owner_user_id: userId, name: 'ci-check' }),
    }),
  (status) => status === 201,
);
await check(
  'GoTrue admin deletes the referenced user',
  () => fetch(`${AUTH}/admin/users/${userId}`, { method: 'DELETE', headers: headers(service) }),
  (status) => status === 200,
);
await check(
  'the row went with the user (ON DELETE CASCADE)',
  () =>
    fetch(`${REST}/directory_groups?owner_user_id=eq.${userId}&select=id`, {
      headers: headers(service),
    }),
  (status, text) => status === 200 && text.trim() === '[]',
);

// PostgREST: a read as each request role, and one RPC the api calls.
await check(
  'PostgREST reads as service_role',
  () => fetch(`${REST}/events?select=id&limit=1`, { headers: headers(service) }),
  (status) => status === 200,
);
await check(
  'PostgREST reads as anon',
  () => fetch(`${REST}/events?select=id&limit=1`, { headers: headers(anon) }),
  (status) => status === 200,
);
await check(
  'PostgREST runs an RPC as service_role (account_emails)',
  () =>
    fetch(`${REST}/rpc/account_emails`, {
      method: 'POST',
      headers: headers(service),
      body: JSON.stringify({ p_user_ids: [] }),
    }),
  (status) => status === 200,
);

// Storage: a public bucket, an upload, an anonymous public read, a service download.
const bucket = `ci-${randomUUID().slice(0, 8)}`;
await check(
  'Storage creates a public bucket',
  () =>
    fetch(`${STORAGE}/bucket`, {
      method: 'POST',
      headers: headers(service),
      body: JSON.stringify({ id: bucket, name: bucket, public: true }),
    }),
  (status) => status === 200,
);
await check(
  'Storage takes an upload',
  () =>
    fetch(`${STORAGE}/object/${bucket}/check.txt`, {
      method: 'POST',
      headers: headers(service, 'text/plain'),
      body: 'service users',
    }),
  (status) => status === 200,
);
await check(
  'Storage serves the public object to anyone',
  () => fetch(`${STORAGE}/object/public/${bucket}/check.txt`),
  (status, text) => status === 200 && text === 'service users',
);
await check(
  'Storage serves the object to service_role',
  () => fetch(`${STORAGE}/object/authenticated/${bucket}/check.txt`, { headers: headers(service) }),
  (status, text) => status === 200 && text === 'service users',
);

console.log(failed === 0 ? 'HTTP CHECKS: GREEN' : `HTTP CHECKS: RED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
