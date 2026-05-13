import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

const args = parseArgs(process.argv.slice(2));
const domain = args.domain ?? 'myclash.fr';
const minCertDays = Number(args['min-cert-days'] ?? 21);
const hosts = [
  domain,
  `www.${domain}`,
  `api.${domain}`,
  `app.${domain}`,
  `admin.${domain}`,
  `scoring.${domain}`,
];
const errors = [];

for (const host of hosts) {
  const redirect = await request({
    protocol: 'http:',
    host,
    path: '/',
    method: 'GET',
    timeoutMs: 10_000,
  });
  if (![301, 302, 307, 308].includes(redirect.statusCode ?? 0)) {
    errors.push(
      `http://${host}/ did not redirect to HTTPS; status=${redirect.statusCode ?? 'none'}`,
    );
  } else if (!String(redirect.headers.location ?? '').startsWith(`https://${host}`)) {
    errors.push(
      `http://${host}/ redirected to unexpected location: ${redirect.headers.location ?? 'none'}`,
    );
  }

  const httpsResult = await request({
    protocol: 'https:',
    host,
    path: '/',
    method: 'GET',
    timeoutMs: 10_000,
  });
  const hsts = String(httpsResult.headers['strict-transport-security'] ?? '');
  if (!/max-age=31536000/i.test(hsts) || !/includeSubDomains/i.test(hsts)) {
    errors.push(`https://${host}/ missing expected HSTS header; got "${hsts || 'none'}"`);
  }

  try {
    const cert = await certificate(host);
    const validTo = Date.parse(cert.valid_to);
    const daysLeft = Math.floor((validTo - Date.now()) / 86_400_000);
    if (!Number.isFinite(validTo) || daysLeft < minCertDays) {
      errors.push(`https://${host}/ certificate expires too soon: ${cert.valid_to}`);
    }
  } catch (error) {
    errors.push(`https://${host}/ certificate check failed: ${error.message}`);
  }
}

const health = await request({
  protocol: 'https:',
  host: `api.${domain}`,
  path: '/health',
  method: 'GET',
  timeoutMs: 10_000,
});
if (health.statusCode !== 200) {
  errors.push(`https://api.${domain}/health returned ${health.statusCode ?? 'no response'}`);
}

if (errors.length > 0) {
  console.error(`Edge/TLS review failed for ${domain}:`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`Edge/TLS review passed for ${domain}. Checked ${hosts.length} hosts.`);

function parseArgs(rawArgs) {
  const parsed = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith('--')) continue;
    const [key, inlineValue] = arg.slice(2).split('=', 2);
    parsed[key] = inlineValue ?? rawArgs[i + 1];
    if (!inlineValue) i += 1;
  }
  return parsed;
}

function request({ protocol, host, path, method, timeoutMs }) {
  const client = protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const req = client.request(
      {
        protocol,
        host,
        path,
        method,
        timeout: timeoutMs,
        rejectUnauthorized: true,
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers }));
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (error) => {
      resolve({ statusCode: null, headers: {}, error });
    });
    req.end();
  });
}

function certificate(host) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port: 443,
        servername: host,
        rejectUnauthorized: true,
        timeout: 10_000,
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve(cert);
      },
    );
    socket.on('error', reject);
    socket.on('timeout', () => {
      socket.destroy(new Error('timeout'));
    });
  });
}
