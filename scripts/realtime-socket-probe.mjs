/**
 * The socket half of scripts/check-realtime-socket.sh (CI, Deploy migration run; rulings 424,
 * 504-507). Runs inside the api image on the compose network `myclash`, mounted read-only:
 * `node:` imports only. Realtime answers as `app.ci` (a host entry the shell half adds), so the
 * Host is the tenant's, as the edge forwards it in prod. Prints one line per check; exit 1 when any check fails.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { request } from 'node:http';

const SECRET = process.env['SUPABASE_JWT_SECRET'];
if (!SECRET) throw new Error('SUPABASE_JWT_SECRET is not set');
const REALTIME = 'app.ci';
const REST = 'http://supabase-rest:3000';

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(role) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ role, iss: 'ci-check', exp: Math.floor(Date.now() / 1000) + 600 });
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
const anon = token('anon');
const service = token('service_role');

let failed = 0;
function report(pass, label, detail) {
  if (!pass) failed += 1;
  console.log(`${pass ? 'ok ' : 'RED'} ${label}: ${detail}`);
}

/** The HTTP status of a websocket upgrade (101 when accepted). */
function upgradeStatus(jwt) {
  return new Promise((resolve) => {
    const req = request({
      host: REALTIME,
      port: 4000,
      path: `/socket/websocket?apikey=${encodeURIComponent(jwt)}&vsn=1.0.0`,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'x3JJHMbDL1EzLkh9GBhXDw==',
      },
      timeout: 5000,
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode);
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => resolve(error.message));
    req.end();
  });
}

/** One INSERT through PostgREST with the service key; its status, or why it failed. */
async function insert(marker) {
  try {
    const res = await fetch(`${REST}/ci_realtime_probe`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${service}`,
        apikey: service,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify({ v: marker }),
      signal: AbortSignal.timeout(5000),
    });
    return res.status;
  } catch (error) {
    return error.message;
  }
}

/**
 * Join with postgres_changes, insert through PostgREST, wait for the change. Nothing that may be
 * merely not ready yet is a verdict before the deadline: a non-ok status of the change feed is
 * recorded and waited out (whether Realtime retries it is not measured), and the INSERT repeats
 * every 2 s until the change arrives (measured: a refused INSERT, then 201, then the change).
 */
function joinAndReceive(jwt) {
  const run = { marker: randomUUID(), steps: [], inserting: null, done: false };
  return new Promise((resolve) => {
    const ws = new WebSocket(
      `ws://${REALTIME}:4000/socket/websocket?apikey=${encodeURIComponent(jwt)}&vsn=1.0.0`,
    );
    run.finish = (pass) => {
      if (run.done) return;
      run.done = true;
      clearTimeout(timer);
      clearInterval(run.inserting);
      ws.close();
      resolve({ pass, detail: run.steps.join(' | ') });
    };
    const timer = setTimeout(() => run.finish(false), 60_000);
    ws.addEventListener('error', (event) => run.steps.push(`socket error ${event.message ?? ''}`));
    ws.addEventListener('close', (event) => {
      if (run.done) return;
      run.steps.push(`socket closed ${event.code}`);
      run.finish(false);
    });
    ws.addEventListener('open', () => {
      run.steps.push('open');
      ws.send(joinMessage(jwt));
    });
    ws.addEventListener('message', (event) => onMessage(run, JSON.parse(String(event.data))));
  });
}

/** The channel join: postgres_changes on the probe table, authorised by the token. */
function joinMessage(jwt) {
  return JSON.stringify({
    topic: 'realtime:ci',
    event: 'phx_join',
    ref: '1',
    payload: {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: '' },
        postgres_changes: [{ event: 'INSERT', schema: 'public', table: 'ci_realtime_probe' }],
        private: false,
      },
      access_token: jwt,
    },
  });
}

/** INSERT now and every 2 s after, recording each new status, until the run finishes. */
function startInserting(run) {
  if (run.inserting) return;
  const once = async () => {
    const status = await insert(run.marker);
    if (run.steps.at(-1) !== `insert ${status}`) run.steps.push(`insert ${status}`);
  };
  void once();
  run.inserting = setInterval(() => void once(), 2000);
}

function onMessage(run, message) {
  if (message.event === 'phx_reply' && message.ref === '1') {
    run.steps.push(`join ${message.payload.status}`);
    if (message.payload.status !== 'ok') run.finish(false);
  } else if (message.event === 'system' && message.payload.extension === 'postgres_changes') {
    const { status, message: text } = message.payload;
    run.steps.push(
      status === 'ok' ? 'changes ok' : `changes ${status}: ${String(text).slice(0, 80)}`,
    );
    if (status === 'ok') startInserting(run);
  } else if (message.event === 'postgres_changes') {
    const value = message.payload?.data?.record?.v;
    run.steps.push(value === run.marker ? 'change received' : `other change ${value}`);
    if (value === run.marker) run.finish(true);
  }
}

for (const [label, jwt] of [
  ['anon key', anon],
  ['service key', service],
]) {
  const status = await fetch(`http://${REALTIME}:4000/api/tenants`, {
    headers: { authorization: `Bearer ${jwt}` },
    signal: AbortSignal.timeout(5000),
  }).then(
    (res) => res.status,
    (error) => error.message,
  );
  report(status === 403, `the management API refuses the ${label}`, status);
}
const garbage = await upgradeStatus('garbage.token.here');
report(garbage === 401, 'a garbage token is refused at the upgrade', garbage);
const accepted = await upgradeStatus(anon);
report(accepted === 101, 'the anon key upgrades', accepted);
const joined = await joinAndReceive(anon);
report(joined.pass, 'an anon socket receives a database change', joined.detail);

process.exit(failed === 0 ? 0 : 1);
